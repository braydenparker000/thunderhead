// The day's plate for the Ink and Lamp look: the picture and the verse that open a day's
// conversation and head the Briefing. Sundays take the Resurrection plates, Fridays the cross, the
// other days the rest, each kind in turn by the calendar alone, so a given day shows the same plate
// every time and on every device and nothing is stored. Day (Ink) shows the engravings, night
// (Lamp) the paintings. The list is plates.json beside this file; the pictures and the record of
// where each came from are in /look/pictures/ (outside the look's hashed folder: each picture's
// name carries the hash of its own bytes, so it is fetched once and kept for good).
//
//   const p = await plateFor();                  // today's, for the theme now showing
//   const p = await plateFor(new Date(2026, 3, 5), 'lamp');
//   p → { src, alt, title, artist, year, verse, ref, day: 'sunday' | 'friday' | 'any' }
//   p.src is a site path to a 900 x 656 picture already cropped for the header and, for Ink,
//   already printed on the Ink ground: show it with object-fit: cover and no blending.
let list;

/** The whole list, fetched once. */
export const plates = () => list ??= fetch(new URL('./plates.json', import.meta.url))
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error('plates'))))
  .catch((e) => { list = undefined; throw e; });

/** 'lamp' when the night theme shows, else 'ink'. */
export const setNow = () => (document.documentElement.dataset.theme === 'dark' ? 'lamp' : 'ink');

/** The plate of `all` for the local day of `date` in `set`; undefined when the set has none. */
export function pick(all, date, set) {
  const dow = date.getDay();
  const n = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  const week = Math.floor((n + 4) / 7); // weeks begin on Sunday; 1970-01-04 was one
  const day = dow === 0 ? 'sunday' : dow === 5 ? 'friday' : 'any';
  const of = all.filter((p) => p.set === set && p.day === day);
  const turn = day === 'any' ? week * 5 + [0, 0, 1, 2, 3, 0, 4][dow] : week;
  return of[turn % of.length];
}

/** The plate for `date` (today) in `set` (the theme showing), or null when the list cannot be had. */
export async function plateFor(date = new Date(), set = setNow()) {
  try {
    const p = pick(await plates(), date, set);
    return p ? { ...p, src: `/look/pictures/${p.file}`, alt: `${p.title}, ${p.artist}` } : null;
  } catch { return null; }
}
