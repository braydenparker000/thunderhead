// The catalog writer's edits (the old repo's backend/music-catalog.js, ported; ./writer.ts has
// the registrations): a track's tags, path, waveform or cover changed in place; new audio under
// the same id; waveforms in bulk; tracks out of the catalog; and the audit of the bucket against
// the catalog. Each change is logged with what it replaced. No object is ever deleted.
import { SONG_ID } from './shapes';
import * as store from './store';
import { metadata } from './validate';
import {
  BATCH_MAX,
  changed,
  check,
  fail,
  kindOrFail,
  type Obj,
  type Op,
  one,
  put,
  record,
  validName,
  verifiedAudio,
  verifiedCover,
  WAVE_BATCH_MAX,
  waveOrFail,
  withKind,
} from './writer';

const AUDIT_SAMPLES = 100;

export const EDIT_OPS: Record<string, Op> = {
  /** A track's tags, path or folder, waveform or cover, changed in place. */
  async patch(c, body) {
    one(c, body?.id);
    const cover =
      body.cover === undefined ? undefined : body.cover === null ? null : await verifiedCover(c, body.cover);
    const waveform = body.waveform === undefined ? undefined : waveOrFail(body.waveform);
    const kind = kindOrFail(body.waveformKind);
    return c.tx(() => {
      const current = one(c, body.id);
      const before = record(current);
      let next = structuredClone(before) as Obj & { metadata: Obj };
      if (waveform !== undefined) next = withKind(next, waveform, kind) as typeof next;
      if (body.metadata !== undefined) {
        if (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata))
          fail(422, 'metadata is an object of changes');
        const merged: Obj = { ...next.metadata };
        for (const [k, v] of Object.entries(body.metadata as Obj)) {
          if (k === 'audioAnalysis' || k === 'waveform') fail(422, `Change ${k} with its own operation`);
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        try {
          next.metadata = metadata(merged);
        } catch {
          fail(422, 'Invalid track metadata');
        }
      }
      for (const k of ['path', 'folder'] as const)
        if (body[k] !== undefined) {
          const v = body[k];
          // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
          if (typeof v !== 'string' || !v || v.length > (k === 'path' ? 1024 : 4096) || /[\x00-\x1f\x7f]/.test(v))
            fail(422, `Invalid ${k}`);
          next[k] = v;
        }
      if (cover !== undefined) {
        for (const k of ['coverKey', 'coverSha256', 'coverSize', 'coverMimeType', 'coverIdentity', 'coverURL'])
          delete next[k];
        if (cover) Object.assign(next, cover);
      }
      check(next);
      put(c, next, waveform === undefined ? current.waveform : waveform);
      store.logOp(c.db, c.now, 'patch', next.id as string, before);
      changed(c);
      return { patched: true, id: next.id, count: c.tracks() };
    });
  },
  /** New audio for a track, keeping its id. The old audio stays in the bucket. */
  async 'replace-audio'(c, body) {
    one(c, body?.id);
    const audio = await verifiedAudio(c, body.sha256, body.size);
    if (body.name !== undefined && !validName(body.name)) fail(422, 'Invalid file name');
    const waveform = body.waveform === undefined ? null : waveOrFail(body.waveform);
    const kind = kindOrFail(body.waveformKind);
    return c.tx(() => {
      const current = one(c, body.id);
      const before = record(current);
      const other = store.byContent(c.db, audio.sha256 as string, audio.size as number, body.id as string);
      if (other) fail(409, 'That audio is already another track', { id: other });
      const next = withKind({ ...structuredClone(before), ...audio }, waveform, kind) as Obj & { metadata: Obj };
      delete next.md5;
      // The old analysis describes the old audio.
      delete next.metadata.audioAnalysis;
      if (body.name) {
        const path = String(next.path);
        next.path = path.includes('/') ? path.replace(/[^/]*$/, String(body.name)) : body.name;
      }
      check(next);
      put(c, next, waveform);
      store.logOp(c.db, c.now, 'replace-audio', next.id as string, before);
      changed(c);
      return {
        replaced: true,
        id: next.id,
        oldAudioKey: before.audioKey,
        deletedObjects: [],
        count: c.tracks(),
      };
    });
  },
  /** Waveforms for many tracks at once (a backfill): items [{id, waveform, kind}]. */
  async waveforms(c, body) {
    const items = body?.items;
    if (!Array.isArray(items) || !items.length || items.length > WAVE_BATCH_MAX)
      fail(422, `items is 1 to ${WAVE_BATCH_MAX} waveforms`);
    const checked = (items as Obj[]).map((item, i) => {
      if (!item || !SONG_ID.test(String(item.id)) || item.kind === undefined)
        fail(422, `items[${i}] needs id, waveform and kind`);
      return { id: String(item.id), waveform: waveOrFail(item.waveform), kind: kindOrFail(item.kind) };
    });
    return c.tx(() => {
      const notFound: string[] = [];
      let updated = 0;
      for (const { id, waveform, kind } of checked) {
        const row = store.trackRow(c.db, id);
        if (!row) {
          notFound.push(id);
          continue;
        }
        const before = record(row);
        put(c, withKind(before, waveform, kind), waveform);
        store.logOp(c.db, c.now, 'waveform', id, { waveform: row.waveform, waveformKind: before.waveformKind ?? null });
        updated++;
      }
      if (updated) changed(c);
      return { updated, notFound, count: c.tracks() };
    });
  },
  /** Tracks out of the catalog (logged, with their waveform, for undo). Their objects stay. */
  async delete(c, body) {
    const ids = body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > BATCH_MAX || !ids.every((id) => SONG_ID.test(String(id))))
      fail(422, `ids is 1 to ${BATCH_MAX} track ids`);
    return c.tx(() => {
      const deleted: string[] = [];
      for (const id of new Set(ids as string[])) {
        const row = store.trackRow(c.db, id);
        if (!row) continue;
        store.deleteTrack(c.db, id);
        c.counted(-1);
        store.logOp(c.db, c.now, 'delete', id, { ...record(row), waveform: row.waveform });
        deleted.push(id);
      }
      if (deleted.length) changed(c);
      return {
        deleted,
        notFound: (ids as string[]).filter((id) => !deleted.includes(id)),
        deletedObjects: [],
        count: c.tracks(),
      };
    });
  },
  /** The bucket against the catalog: keys whose objects are missing, objects no track uses. */
  async audit(c) {
    const referenced = new Map<string, { id: string; size?: number }>();
    // One pass over the tracks (2026-10-31: the audit counted them five times, 112k rows a call).
    let withoutWaveform = 0;
    for (const r of store.referencedKeys(c.db)) {
      if (!r.w) withoutWaveform++;
      referenced.set(r.audio_key, { id: r.id, size: r.size });
      if (r.cover_key) referenced.set(r.cover_key, { id: r.id });
    }
    const seen = new Map<string, number>();
    for (const prefix of ['native/audio/', 'native/art/', 'audio/']) {
      let cursor: string | undefined;
      do {
        const page = await c.media.list({ prefix, cursor, limit: 1000 });
        for (const o of page.objects) seen.set(o.key, o.size);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    const missing: Obj[] = [];
    const wrongSize: Obj[] = [];
    const orphans: string[] = [];
    for (const [key, ref] of referenced) {
      if (!seen.has(key)) missing.push({ id: ref.id, key });
      else if (ref.size && seen.get(key) !== ref.size) wrongSize.push({ id: ref.id, key });
    }
    for (const key of seen.keys()) if (!referenced.has(key)) orphans.push(key);
    const summary = {
      at: new Date(c.now).toISOString(),
      tracks: c.tracks(),
      objects: seen.size,
      missing: missing.length,
      wrongSize: wrongSize.length,
      orphans: orphans.length,
      withoutWaveform,
    };
    return {
      ...summary,
      samples: {
        missing: missing.slice(0, AUDIT_SAMPLES),
        wrongSize: wrongSize.slice(0, AUDIT_SAMPLES),
        orphans: orphans.slice(0, AUDIT_SAMPLES),
      },
    };
  },
};
