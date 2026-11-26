// The library's snapshot on the phone (IndexedDB `state`): the catalog as last fetched, for a fast start.
// It used to be one record (`r2:index`, every song with its inline waveform): on a phone with 15,000
// songs reading it was one structured clone of ~30 MB, a freeze of about a second at every start, and
// writing it blocked half a second. Now (form 2):
//   r2:snap              the head: {v: 2, id, generatedAt, savedAt, count, parts}
//   r2:p:<id>:<nnnn>     part nnnn of snapshot <id>: up to PART songs, in the library's sorted order (so
//                        the start's sort finds them in order), without waveforms; `waveB64: true` marks a
//                        song whose index waveform is kept apart
//   r2:w:<song id>       that waveform (its base64 text, or an array), read when the song loads or is
//                        next (Library.loadWave)
// Each part is its own request, so no read or write holds the main thread long; parts are read in order
// with a pause between. A new snapshot is written beside the old one (a new id) and the head moves to it
// in one put, so a write cut off (the app closed, the phone out of power) leaves the old snapshot whole;
// old parts, waveforms no song has any more, and the old single record go only after the head moved.
// Writes run one at a time. The first start with this code reads `r2:index` once (readSnapshot: `old`),
// and the library writes form 2 from it (saveSnapshot) once its songs are sorted. Keys under `r2:` are
// the phone's own cache (never exported: import/phone-data.js).

export const HEAD = 'r2:snap', OLD = 'r2:index', PART = 500, WAVE = 'r2:w:';
const BATCH = 250;
const partKey = (id, i) => `r2:p:${id}:${String(i).padStart(4, '0')}`;
const pause = () => new Promise(r => setTimeout(r, 0));

let chain = Promise.resolve();
/** One write at a time (a refresh's write never deletes the parts of one under way). */
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

/**
 * A song's index waveform as the index gave it (base64 text, or an older index's array: a song with no
 * waveform file), or null; true: kept apart already. A waveform fetched for a song (`waveUrl`) is the
 * song's own data (`u:<id>`, Library.withUserData), not the snapshot's.
 */
const waveOf = t => (typeof t.waveB64 === 'string' || t.waveB64 === true ? t.waveB64 : Array.isArray(t.wave) && !t.waveUrl ? t.wave : null);

/**
 * The stored snapshot: {generatedAt, savedAt, tracks, old}, or null; eachPart(songs) is called on each
 * part as it is read (form 2 only). Form 2's songs come without
 * waveforms (`waveB64: true` on those with one kept apart); `old` (the single record of before) has
 * them inline: saveSnapshot moves it to form 2, keeping them.
 */
export async function readSnapshot(db, eachPart = null) {
  const head = await db.getState(HEAD).catch(() => null);
  if (head?.v === 2) {
    const tracks = await readParts(db, head, eachPart);
    if (tracks) {
      // A move to form 2 cut off after the head was written: the old record goes now.
      db.deleteState(OLD).catch(() => {});
      return {generatedAt: head.generatedAt, savedAt: head.savedAt ?? 0, tracks, old: false};
    }
  }
  const old = await db.getState(OLD).catch(() => null);
  if (!Array.isArray(old?.tracks)) return null;
  return {generatedAt: old.generatedAt, savedAt: old.savedAt ?? 0, tracks: old.tracks, old: true};
}

async function readParts(db, head, eachPart) {
  const out = [];
  for (let i = 0; i < head.parts; i++) {
    if (i) await pause();
    const part = await db.getState(partKey(head.id, i)).catch(() => null);
    if (!Array.isArray(part)) return null;
    // (What the library does to each song, done a part at a time too.)
    eachPart?.(part);
    for (const t of part) out.push(t);
  }
  return out.length === head.count ? out : null;
}

/** A song as the snapshot keeps it: no images, no waveform (a song with an index waveform: `waveB64: true`). */
function stored(t) {
  const {art, thumb, wave, waveB64, ...r} = t;
  return waveOf(t) ? {...r, waveB64: true} : r;
}

/**
 * Writes a snapshot of tracks (in the order to keep: the library's sorted order), their index waveforms
 * apart (those given inline: base64 text or an index's array), in parts with a pause between; then moves
 * the head to it and deletes the old snapshot's parts, the waveforms no song has now, and the old record.
 * Resolves once done; a failure leaves the snapshot before whole (and rejects).
 */
export function saveSnapshot(db, {generatedAt, savedAt, tracks}) {
  const list = tracks.slice();
  return serial(async () => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const parts = Math.ceil(list.length / PART);
    for (let i = 0; i < parts; i++) {
      await pause();
      await db.setState(partKey(id, i), list.slice(i * PART, (i + 1) * PART).map(stored));
    }
    const keep = new Set(), waves = [];
    for (const t of list) {
      const w = waveOf(t);
      if (!w) continue;
      keep.add(WAVE + t.id);
      if (w !== true) waves.push([WAVE + t.id, w]);
    }
    for (let i = 0; i < waves.length; i += BATCH) {
      await pause();
      await db.putStates(waves.slice(i, i + BATCH));
    }
    await db.setState(HEAD, {v: 2, id, generatedAt, savedAt, count: list.length, parts});
    const gone = (await db.stateKeys('r2:p:').catch(() => [])).filter(k => !k.startsWith(`r2:p:${id}:`));
    gone.push(...(await db.stateKeys(WAVE).catch(() => [])).filter(k => !keep.has(k)));
    for (let i = 0; i < gone.length; i += BATCH) await db.deleteStates(gone.slice(i, i + BATCH)).catch(() => {});
    await db.deleteState(OLD).catch(() => {});
  });
}

/** The head's savedAt moved on (an unchanged catalog revalidated): one small record, not the snapshot. */
export function touchSnapshot(db, savedAt) {
  return serial(async () => {
    const head = await db.getState(HEAD).catch(() => null);
    if (head?.v === 2) await db.setState(HEAD, {...head, savedAt});
  });
}

/** A song's index waveform kept apart (base64 text or an array), or null. */
export function readWave(db, id) {
  return db.getState(WAVE + id).then(w => w ?? null, () => null);
}
