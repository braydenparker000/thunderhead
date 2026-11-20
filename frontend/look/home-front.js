// @ts-check
// Ink and Lamp's frontispiece (approved screens R-Grey / R-Dark): each day's conversation opens with
// that day's plate, full width from the very top of the page, under it the verse, its reference and
// the plate's legend, and then `j.j.`. It is the conversation's first child, so it scrolls with it.
// Today's conversation shows the plate of its own day (the Worker's day, which rolls at 04:00, so a
// conversation running past midnight keeps its plate); an older one opened from the menu shows the
// plate of its day; the theme picks the set (Ink's engravings, Lamp's paintings). The plates come
// from the lead's picker (look/plates.js).
import { plateFor } from './plates.js';

const ROMAN = [['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]];
/** @param {number} n */
const roman = (n) => { let s = ''; for (const [r, v] of ROMAN) while (n >= +v) { s += r; n -= +v; } return s; };
/** "doré", "rembrandt", "van leyden", "del piombo": the name an artist is known by. @param {string} name */
export function known(name) {
  const w = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (w[0] === 'rembrandt' || w.length < 2) return w[0] ?? '';
  const at = w.findIndex((x, i) => i > 0 && /^(van|von|del|de|da|di|der)$/.test(x));
  return at > 0 ? w.slice(at).join(' ') : w.at(-1) ?? '';
}
/** "plate v · doré 1866" @param {{ file?: string, artist: string, year?: string }} p */
export function legend(p) {
  const n = Number(/(?:^|\/)(\d+)-/.exec(p.file ?? '')?.[1]) || 0;
  return [n ? `plate ${roman(n)}` : '', [known(p.artist), p.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}
/** A day `YYYY-MM-DD` as a local date, or null. @param {unknown} day */
const local = (day) => {
  const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
/** The time in a v7 uuid, or 0. @param {string | undefined} id */
const v7 = (id) => (id && /^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(id) ? parseInt(id.replace(/-/g, '').slice(0, 12), 16) : 0);

const HTML = '<figure class="lk-fig"><img alt="" decoding="async"></figure>'
  + '<div class="lk-verse"><p class="lk-vtext" lang="en"></p><span class="lk-ref"></span></div><p class="lk-legend"></p>'
  + '<p class="lk-jj"><abbr title="Jesu juva">j.j.</abbr></p>';

export function front() {
  const convo = document.getElementById('convo');
  const home = document.getElementById('home');
  if (!convo || !home) return;
  const box = document.createElement('div');
  box.className = 'lk-front lk-bare';
  box.innerHTML = HTML;
  convo.prepend(box);
  const img = /** @type {HTMLImageElement} */ (box.querySelector('img'));
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (box.querySelector(s));

  /** Today's conversation's day (th/chat's, once it has loaded), and an older one's while it shows. */
  /** @type {{ today: { day?: string } | null } | null} */
  let chat = null;
  /** The thread last opened from the menu (its row's id), to find its day. */
  let opened = '';
  /** @type {Map<string, { day: string }> | null} */
  let threads = null;
  const dayNow = () => {
    if (home.classList.contains('pastview')) {
      const t = threads?.get(opened);
      const own = local(document.getElementById('past')?.dataset.day) ?? local(t?.day);
      if (own) return own;
      const first = /** @type {HTMLElement | null} */ (document.querySelector('#past [data-id]'));
      const at = v7(first?.dataset.id);
      if (at) return new Date(at);
    }
    return local(chat?.today?.day) ?? new Date();
  };

  let shown = '';
  let alive = true;
  const draw = async () => {
    const date = dayNow();
    const key = `${date.toDateString()}|${document.documentElement.dataset.theme}`;
    if (key === shown) return;
    shown = key;
    const p = await plateFor(date);
    if (!alive || shown !== key) return;
    box.classList.toggle('lk-bare', !p);
    if (!p) return;
    img.alt = p.alt;
    if (img.getAttribute('src') !== p.src) img.src = p.src;
    $('.lk-vtext').textContent = p.verse;
    $('.lk-ref').textContent = p.ref;
    $('.lk-legend').textContent = legend(p);
  };
  draw();

  if (document.documentElement.hasAttribute('data-signed-in')) {
    // (its day comes with its first load: looked for until then, for 20 s at most)
    let tries = 0;
    const loaded = () => { if (!alive) return; if (chat?.today?.day || tries++ > 80) draw(); else setTimeout(loaded, 250); };
    import('/th/chat/index.js').then((m) => { chat = m.current; loaded(); }, () => {});
  }
  const past = new MutationObserver(() => void draw());
  const changed = () => {
    const log = document.getElementById('past');
    past.disconnect();
    if (log) past.observe(log, { childList: true, attributes: true, attributeFilter: ['data-day'] });
    draw();
  };
  const pick = (/** @type {Event} */ e) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.('#convos [data-id], #sidescroll [data-id]'));
    if (!row) return;
    opened = row.dataset.id ?? '';
    import('/th/convos/data.js').then((d) => { threads = d.list.threads; draw(); }, () => {});
  };
  document.addEventListener('click', pick, true);
  document.addEventListener('th:changed', changed);
  document.addEventListener('visibilitychange', changed);
  const watch = new MutationObserver(changed);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-signed-in'] });
  watch.observe(home, { attributes: true, attributeFilter: ['class'] });
  watch.observe(convo, { childList: true });

  return () => {
    alive = false;
    watch.disconnect();
    past.disconnect();
    document.removeEventListener('click', pick, true);
    document.removeEventListener('th:changed', changed);
    document.removeEventListener('visibilitychange', changed);
    box.remove();
  };
}
