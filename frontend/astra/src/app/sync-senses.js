// Progress that arrives from another phone is not watching done on this one. The Thunderhead's senses
// reader (frontend/th/senses/watch.js, loaded on Astra's page when signed in) tells the mind what was
// watched by comparing `astra.v2.progress` with its last look, kept in `th.p.senses.watch` as
// {look, spots: {ref: {t, d, done, at}}}. Left alone, a merge that brings another phone's film would
// read as that film watched here (`media.watch`), finished here (`media.finish`), or, for an entry
// another phone removed, dropped here (`media.drop`). So when a merge writes progress, the same refs are
// written into that last look as the merge leaves them: the next look finds them unchanged and says
// nothing of them, while everything this phone watched itself is compared as before. Refs and numbers
// only, as the reader keeps them; nothing is sent from here.

const SEEN = 'th.p.senses.watch';
// The reader's own rules for a ref (watch.js `astraSpots`), kept the same here.
const ID = /^[A-Za-z0-9._:/-]{1,150}$/;
const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;

/** Astra's progress as the reader sees it: ref → {t, d, done, at}. */
export function spotsOf(progress) {
  const out = {};
  if (!progress || typeof progress !== 'object') return out;
  for (const e of Object.values(progress)) {
    if (!e || typeof e !== 'object' || typeof e.type !== 'string' || e.id == null) continue;
    const ep = Number.isInteger(e.season) && Number.isInteger(e.episode) ? `:${e.season}:${e.episode}` : '';
    const id = `${e.type}:${e.id}${ep}`;
    if (ID.test(id)) out[`astra:${id}`] = {t: num(e.time) * 1000, d: num(e.duration) * 1000, done: e.completed === true, at: num(e.updated)};
  }
  return out;
}

/** Writes into the reader's last look every ref the merge changed (`before` → `after`), as `after` has
 * it. No last look yet: nothing to do (the reader's first look only remembers). */
export function hideFromSenses(before, after, storage) {
  let seen;
  try { seen = JSON.parse(storage?.getItem(SEEN) || 'null'); } catch { return; }
  if (!seen || typeof seen.spots !== 'object' || !seen.spots) return;
  const was = spotsOf(before), now = spotsOf(after);
  let changed = false;
  for (const ref of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[ref]) === JSON.stringify(now[ref])) continue;
    if (now[ref]) seen.spots[ref] = now[ref]; else delete seen.spots[ref];
    changed = true;
  }
  if (changed) try { storage.setItem(SEEN, JSON.stringify(seen)); } catch {}
}
