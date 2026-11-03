// Muse's uploads as tasks (MUSE-PROTOCOL.md): the songs its signed `register` calls add
// (areas/music/upload.ts) gather into one `muse.upload_batch`, the Worker's own record, never queued
// or claimed, and the tick closes it as done 30 minutes after the last upload. It says nothing in the
// chat: the menu's Tasks show it, and the Briefing counts the songs.

import { type MuseResult, WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { uuidv7 } from '../../lib/ids';
import { DAY, MINUTE } from '../../lib/time';
import type { Writer } from '../../objects/commit';
import * as store from './store';

const changed = (w: Writer, id: string) => w.change('work', `work:${id}`);
const reread = (w: Writer, id: string) => store.order(w.db, id) as store.OrderRow;

const GAP = WORK_LIMITS.batch_gap_min * MINUTE;

/** Songs Muse registered through its signed upload route (areas/music/upload.ts): added to the
 * open upload batch, or a new one. `artists` are short hashes of the artists' names, kept only to
 * count them; no name is stored here. */
export function uploaded(w: Writer, ids: string[], artists: string[]): void {
  if (!ids.length) return;
  let o = store.openBatch(w.db);
  if (!o) {
    const id = uuidv7(w.at);
    store.insertOrder(w.db, {
      id,
      kind: 'muse.upload_batch',
      title: 'Songs Muse uploaded',
      spec: { v: 1, words: 'Songs Muse uploaded through its own upload route.', artists: [] },
      deadline_at: w.at + WORK_LIMITS.deadline_days * DAY,
      created_by: 'muse',
      at: w.at,
      status: 'claimed',
    });
    o = reread(w, id);
  }
  const spec = JSON.parse(o.spec_json) as { artists?: string[] };
  const seenArtists = new Set(spec.artists ?? []);
  for (const a of artists) if (seenArtists.size < 500) seenArtists.add(a);
  const prev = o.result_json ? (JSON.parse(o.result_json) as MuseResult) : null;
  const result: MuseResult = {
    added: { songs: (prev?.added.songs ?? 0) + ids.length, artists: seenArtists.size },
    ids: [...(prev?.ids ?? []), ...ids].slice(0, 50),
    note: '',
    open: { app: 'music', path: '/music/' },
  };
  store.setStatus(w.db, o.id, {
    status: 'claimed',
    spec_json: JSON.stringify({ ...spec, artists: [...seenArtists] }),
    result_json: JSON.stringify(result),
    heartbeat_at: w.at,
    heartbeat_note: `${result.added.songs} so far`,
  });
  changed(w, o.id);
}

/** The tick's part: a batch quiet for 30 minutes (or past its deadline) is done. */
export function closeBatch(w: Writer, o: store.OrderRow): void {
  if ((o.heartbeat_at ?? 0) + GAP > w.at && o.deadline_at > w.at) return;
  store.setStatus(w.db, o.id, {
    status: 'done',
    result_valid: 1,
    heartbeat_note: null,
    finished_at: Math.min(w.at, (o.heartbeat_at ?? w.at) + GAP),
  });
  changed(w, o.id);
}
