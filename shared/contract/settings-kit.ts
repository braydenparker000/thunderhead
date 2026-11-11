// Small builders for the settings catalogue (settings.ts, settings-phone.ts).

/** Options from `value:Label` pairs. */
export const o = (...pairs: string[]) =>
  pairs.map((p) => ({ value: p.slice(0, p.indexOf(':')), label: p.slice(p.indexOf(':') + 1) }));
/** A range's stops, each labelled with its unit (`160 ms`, `1 day`, `3 days`). */
export const stops = (unit: string, ...ns: number[]) =>
  ns.map((n) => ({ value: n, label: `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}` }));
/** Hours on the clock, `07:00`, as both value and label. */
export const hours = (...hs: number[]) => hs.map((h) => `${String(h).padStart(2, '0')}:00`).map((v) => ({ value: v, label: v }));
