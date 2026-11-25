// The catalog writer's `analysis` (the old repo's backend/music-catalog.js, ported; ./writer.ts has
// the registrations, ./writer-edit.ts the edits): an audio analysis of exactly a track's audio, bound
// to the object's identity in the bucket and to the analysis it replaces, so a stale one is refused.
import { SONG_ID } from './shapes';
import * as store from './store';
import { HEX, validateAnalysis } from './validate';
import { changed, check, fail, type Obj, type Op, put, record, verifiedBlob } from './writer';

const sameIdentity = (o: R2Object | null, p: { size?: number; etag?: string; lastModified?: string } | undefined) =>
  !!o &&
  o.size === p?.size &&
  o.etag === p?.etag &&
  Math.floor(o.uploaded.getTime() / 1000) === Math.floor(Date.parse(String(p?.lastModified)) / 1000);

export const ANALYSIS_OPS: Record<string, Op> = {
  async analysis(c, body) {
    const prev = body.previousAnalysisSha256;
    if (
      !SONG_ID.test(String(body.id)) ||
      !HEX.test(String(body.sha256)) ||
      !Number.isSafeInteger(body.size) ||
      !(prev === null || HEX.test(String(prev)) || (prev === undefined && Object.hasOwn(body, 'previousAnalysis')))
    )
      fail(422, 'Invalid analysis identity');
    let analysis: Obj;
    try {
      analysis = validateAnalysis(body.audioAnalysis, body.sha256 as string, body.size as number);
    } catch {
      return fail(422, 'Invalid audio analysis');
    }
    const row = store.trackRow(c.db, body.id as string);
    const existing = row && record(row);
    const id = existing?.r2Identity as { size: number; etag: string; lastModified: string } | undefined;
    const claimed = body.r2Identity as { size?: number; etag?: string; lastModified?: string } | undefined;
    const proofMatches =
      existing &&
      existing.sha256 === body.sha256 &&
      existing.size === body.size &&
      claimed?.size === id?.size &&
      claimed?.etag === id?.etag &&
      Math.floor(Date.parse(String(claimed?.lastModified)) / 1000) ===
        Math.floor(Date.parse(String(id?.lastModified)) / 1000);
    if (!existing || !proofMatches) return fail(409, 'Analysis object identity conflict');
    const object = await c.media.head(existing.audioKey as string);
    const native = (existing.audioKey as string).startsWith('native/');
    const verified = native
      ? verifiedBlob(object, existing.sha256 as string, existing.size as number)
      : object?.customMetadata?.['source-sha256'] === existing.sha256 &&
        object?.customMetadata?.['source-size'] === String(existing.size);
    if (!sameIdentity(object, id) || !verified) fail(409, 'Verified audio is unavailable');
    const old = existing.metadata.audioAnalysis;
    const revision = old ? await hashOf(old) : null;
    if (JSON.stringify(old) === JSON.stringify(analysis))
      return { registered: true, analysisUpdated: false, id: existing.id, count: c.tracks() };
    const expected = prev === undefined ? (body.previousAnalysis ? await hashOf(body.previousAnalysis) : null) : prev;
    if (revision !== expected) fail(409, 'Analysis changed concurrently; review before retry');
    return c.tx(() => {
      const current = store.trackRow(c.db, body.id as string);
      if (!current || current.record_json !== row.record_json)
        fail(409, 'Analysis changed concurrently; review before retry');
      const next = record(current as store.TrackRow);
      next.metadata.audioAnalysis = analysis;
      check(next);
      put(c, next, (current as store.TrackRow).waveform);
      store.logOp(c.db, c.now, 'analysis', next.id as string, record(current as store.TrackRow));
      changed(c);
      return { registered: true, analysisUpdated: true, id: next.id, count: c.tracks() };
    });
  },
};

async function hashOf(v: unknown): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v)));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
