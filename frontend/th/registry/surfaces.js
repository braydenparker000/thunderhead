// @ts-check
// Surface renderers (EXTENDING.md rule 3, API.md §11.12): how this phone shows each surface kind
// and version of the contract. A kind or version without a renderer becomes the generic card with
// the surface's `why`, so a new kind can reach the Worker before any phone draws it.

/** @typedef {import('../../../shared/contract/api.ts').Surface} Surface */
/** @typedef {{ place: 'line', order: number, text: string, lang: string | null, at: number, id: string } | { place: 'card', order: number, text: string, kind: string }} Placed */

/** @type {Record<string, Record<number, (s: Surface) => Placed | null>>} */
export const RENDERERS = {
  // A home line is a card in today's chat at the time it was placed (HOME.md §2.1; owner,
  // 2026-10-31: no standing voice line).
  line: {
    1: (s) =>
      s.app === 'home'
        ? { place: 'line', order: Number(s.slot.split('.')[1]) || 9, text: String(s.payload.text ?? ''), lang: typeof s.payload.lang === 'string' ? s.payload.lang : null, at: s.written_at, id: `${s.slot}@${s.seq}` }
        : null,
  },
  // A Briefing tile is drawn by the Briefing page from GET /v1/briefing (th/briefing/page.js), never on home.
  tile: {
    1: () => null,
  },
};

/** @param {string} kind @param {number} schema */
export const hasRenderer = (kind, schema) => Boolean(RENDERERS[kind]?.[schema]);

/** @param {Surface} s @returns {Placed | null} */
export function place(s) {
  const r = RENDERERS[s.kind]?.[s.schema];
  return r ? r(s) : { place: 'card', order: 0, text: s.why, kind: s.kind };
}

/** The home lines to show in today's chat: those placed since the day began (04:00 on the
 * thread's day). The night's are one card, held until the quiet hours end (Law 13: nothing before
 * 06:30, or the owner's later end) and shown as of then; a line placed later is its own card.
 * @param {Surface[]} items @param {{ day: string, now: number, quietEnd?: string }} o
 * @returns {{ id: string, lines: { text: string, lang: string | null }[], at: number, night: boolean }[]} */
export function homeLines(items, { day, now, quietEnd = '06:30' }) {
  const start = new Date(`${day}T04:00`).getTime();
  const end = new Date(`${day}T${/^\d\d:\d\d$/.test(quietEnd) && quietEnd >= '06:30' ? quietEnd : '06:30'}`).getTime();
  const placed = items
    .map(place)
    .filter((p) => p?.place === 'line' && p.text && p.at >= start)
    .map((p) => /** @type {Extract<Placed, { place: 'line' }>} */ (p))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const night = placed.filter((p) => p.at < end);
  /** @type {{ id: string, lines: { text: string, lang: string | null }[], at: number, night: boolean }[]} */
  const out = [];
  if (night.length && now >= end) out.push({ id: `night:${day}`, lines: night.sort((a, b) => a.order - b.order).map((p) => ({ text: p.text, lang: p.lang })), at: end, night: true });
  for (const p of placed) if (p.at >= end) out.push({ id: p.id, lines: [{ text: p.text, lang: p.lang }], at: p.at, night: false });
  return out;
}
/** Surfaces this phone cannot draw, shown as generic cards. @param {Surface[]} items */
export const fallbackCards = (items) => items.map(place).filter((p) => p?.place === 'card');
