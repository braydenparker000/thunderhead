// @ts-check
// The owner's settings kept on this phone, read where they are used (shared/contract/
// settings-phone.ts; Settings writes them as `th.s.<key>` and only while not at the default).
// Reading costs one localStorage lookup, so callers read at the moment of use and a change in
// Settings takes effect without a reload.

/** The stored words of a phone setting, or null at its default. @param {string} key */
export const pref = (key) => {
  try {
    return localStorage.getItem(`th.s.${key}`);
  } catch {
    return null;
  }
};
/** A switch: `fallback` (its default) unless the owner flipped it. @param {string} key @param {boolean} [fallback] */
export const prefOn = (key, fallback = true) => {
  const v = pref(key);
  return v === null ? fallback : v === 'true';
};
/** A range's number, or its default. @param {string} key @param {number} fallback */
export const prefNum = (key, fallback) => {
  const v = pref(key);
  return v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback;
};
/** `14:05`, or `2:05 pm` with the owner's 12-hour clock (Settings → Appearance → Clock). @param {number} ms */
export const clock = (ms) => {
  const d = new Date(ms), h = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
  return pref('appearance.clock') === '12' ? `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}` : `${String(h).padStart(2, '0')}:${mm}`;
};
