// @ts-check
// The Board reader (BRIEFING.md §5): one day's edition, full screen over the Briefing, one history
// entry (Back returns). The cover (date, title, summary, thesis), "In 30 seconds" (each story's
// dek), then the stories in order: label, title, dek, why it matters, the blocks of the v2 format
// (prose, stats, chart, comparison, timeline, perspectives, agenda, quote, callout, explanation),
// what's next, the competing reading, and numbered sources. It is Muse's work, labelled so, in
// Inter only. Every string is set with textContent and every link must be https: the Worker
// checked the edition against its schema, and the page checks links again.
import { api, signedIn } from '../client.js';
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import { el } from '../ui.js';

const SVG = 'http://www.w3.org/2000/svg';
const THEMES = new Set(['ink', 'ember', 'tide', 'moss', 'dusk', 'gold']);

/** @param {string} tag @param {Record<string, string | number>} attrs */
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const txt = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : []);
const https = (/** @type {unknown} */ u) => {
  try {
    return typeof u === 'string' && new URL(u).protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
};

let open = /** @type {HTMLElement | null} */ (null);

/** Opens the edition of `day`. @param {string} day */
export async function openBoard(day) {
  open?.remove();
  const back = el('button', { type: 'button', class: 'sback', text: '‹ Briefing' });
  const body = el('div', { class: 'brd' }, [el('p', { class: 'shelp', text: 'Loading the Board…' })]);
  const page = el('section', { class: 'spage boardr', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'The Board' }, [back, body]);
  document.querySelector('#app')?.append(page);
  open = page;
  requestAnimationFrame(() => page.classList.add('in'));
  history.pushState({ th: 'board' }, '');
  const close = (fromPop = false) => {
    page.classList.remove('in');
    setTimeout(() => page.remove(), 320);
    if (open === page) open = null;
    removeEventListener('popstate', onPop);
    if (!fromPop && history.state?.th === 'board') history.back();
  };
  const onPop = () => close(true);
  addEventListener('popstate', onPop);
  back.addEventListener('click', () => close());
  page.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  back.focus({ preventScroll: true });
  try {
    /** @type {{ day: string, edition: any }} */
    const r = await signedIn((t) => api.call(`/v1/board/editions/${encodeURIComponent(day)}`, { token: t }));
    body.replaceChildren(...edition(r.edition, r.day, close));
  } catch (e) {
    body.replaceChildren(el('p', { class: 'line', role: 'status', text: navigator.onLine ? lineFor(failure(e)) : "You're offline. The Board shows once you're back." }));
  }
}

/** @param {any} e @param {string} day @param {() => void} close @returns {HTMLElement[]} */
function edition(e, day, close) {
  const theme = THEMES.has(e?.edition?.theme) ? e.edition.theme : 'ink';
  const when = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const cover = el('header', { class: `bcover t-${theme}` }, [
    el('p', { class: 'bfrom', text: `${when} · from Muse` }),
    el('h1', { text: txt(e.title) }),
    ...(txt(e.summary) ? [el('p', { class: 'bsum', text: e.summary })] : []),
    ...(txt(e?.edition?.thesis) ? [el('p', { class: 'bthesis', text: e.edition.thesis })] : []),
  ]);
  const stories = list(e.stories);
  const quick = el('section', { class: 'bquick', 'aria-label': 'In 30 seconds' }, [
    el('h2', { text: 'In 30 seconds' }),
    el('ol', {}, stories.map((s, i) => {
      const a = el('a', { href: `#story-${i}`, text: txt(s.dek) || txt(s.title) });
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        document.getElementById(`story-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return el('li', {}, [a]);
    })),
  ]);
  return [cover, quick, ...stories.map((s, i) => story(s, i, close))];
}

/** @param {any} s @param {number} i @param {() => void} close */
function story(s, i, close) {
  const sources = list(s.sources);
  const node = el('article', { class: `bstory c-${txt(s.composition) || 'feature'}`, id: `story-${i}` }, [
    ...(txt(s.label) ? [el('p', { class: 'blabel', text: s.label })] : []),
    el('h2', { text: txt(s.title) }),
    el('p', { class: 'bdek', text: txt(s.dek) }),
    ...(txt(s.whyItMatters) ? [el('div', { class: 'bwhy' }, [el('strong', { text: 'Why it matters' }), el('p', { text: s.whyItMatters })])] : []),
    ...list(s.blocks).map((b) => block(b, sources)),
    ...(txt(s.whatsNext) ? [el('div', { class: 'bnext' }, [el('strong', { text: "What's next" }), el('p', { text: s.whatsNext })])] : []),
    ...(txt(s?.disagreement?.text)
      ? [el('div', { class: 'bdis' }, [el('strong', { text: txt(s.disagreement.label) || 'Another reading' }), el('p', { text: s.disagreement.text })])]
      : []),
    sourceList(sources),
  ]);
  const ask = el('button', { type: 'button', class: 'bask', text: 'Ask about this' });
  ask.addEventListener('click', () => {
    const q = /** @type {HTMLTextAreaElement | null} */ (document.querySelector('#q'));
    close();
    document.dispatchEvent(new CustomEvent('th:go', { detail: 'home' }));
    if (q) {
      q.value = `About the Board story “${txt(s.title)}”: `;
      setTimeout(() => q.focus(), 400);
    }
  });
  node.append(ask);
  return node;
}

/** Numbered marks for the sources a block cites. @param {unknown} cites @param {any[]} sources */
function marks(cites, sources) {
  const ns = list(cites).filter((n) => Number.isInteger(n) && sources[n]);
  if (!ns.length) return [];
  return [el('sup', { class: 'bcite', text: ns.map((n) => `[${n + 1}]`).join('') })];
}

/** One block of the v2 format; also a reply's `meta.blocks` (th/chat/view.js). @param {any} b @param {any[]} sources */
export function block(b, sources) {
  const t = txt(b?.type);
  const wrap = el('div', { class: `bb b-${t}` });
  const head = txt(b.title) || (t !== 'prose' && t !== 'quote' && t !== 'callout' ? txt(b.text) : '');
  if (t === 'prose') wrap.append(el('p', { text: txt(b.text) }), ...marks(b.cites, sources));
  else if (t === 'quote') wrap.append(el('blockquote', { text: `“${txt(b.text)}”` }), el('p', { class: 'bwho', text: [txt(b.speaker), txt(b.role)].filter(Boolean).join(', ') }), ...marks(b.cites, sources));
  else if (t === 'callout') wrap.append(el('strong', { text: txt(b.title) || ({ unknown: 'Not known yet', context: 'Context', correction: 'Correction', watch: 'Worth watching' })[txt(b.kind)] || 'Note' }), el('p', { text: txt(b.text) }), ...marks(b.cites, sources));
  else {
    if (head) wrap.append(el('h3', { text: head }));
    if (t === 'stats') wrap.append(el('div', { class: 'bstats' }, list(b.items).map((x) => el('div', { class: `bstat ${txt(x.tone)}` }, [
      el('span', { class: 'bsv', text: txt(x.value) }),
      el('span', { class: 'bsl', text: txt(x.label) }),
      ...(txt(x.change) ? [el('span', { class: `bsc ${txt(x.direction)}`, text: `${({ up: '▲ ', down: '▼ ', flat: '' })[txt(x.direction)] ?? ''}${x.change}` })] : []),
      ...(txt(x.asOf) ? [el('span', { class: 'bsa', text: `as of ${x.asOf}` })] : []),
    ]))));
    else if (t === 'chart') wrap.append(chart(b));
    else if (t === 'comparison') wrap.append(el('div', { class: 'bcmp' }, list(b.items).map((x) => el('div', {}, [el('strong', { text: txt(x.label) }), el('p', { text: txt(x.text) })]))));
    else if (t === 'timeline') wrap.append(el('ol', { class: 'btime' }, list(b.items).map((x) => el('li', { class: txt(x.state) }, [el('span', { class: 'btd', text: txt(x.date) || txt(x.label) }), el('p', { text: [txt(x.date) ? txt(x.label) : '', txt(x.text)].filter(Boolean).join(': ') })]))));
    else if (t === 'perspectives') wrap.append(tabs(list(b.tabs)));
    else if (t === 'agenda') wrap.append(el('ul', { class: 'bagenda' }, list(b.items).map((x) => {
      const d = new Date(txt(x.at));
      const when = Number.isNaN(d.getTime()) ? txt(x.at) : d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      return el('li', {}, [el('span', { class: 'btd', text: when }), el('p', { text: [txt(x.label), txt(x.place), txt(x.text)].filter(Boolean).join(' · ') })]);
    })));
    else if (t === 'explanation') wrap.append(el('ol', { class: 'bsteps' }, list(b.steps).map((x) => el('li', { text: txt(x) }))));
    if (txt(b.note)) wrap.append(el('p', { class: 'bnote2', text: b.note }));
    wrap.append(...marks(b.cites, sources));
  }
  return wrap;
}

/** Tabs for "perspectives": one question seen a few ways. @param {any[]} items */
function tabs(items) {
  const bar = el('div', { class: 'btabs', role: 'tablist' });
  const panel = el('p', { class: 'btabp', role: 'tabpanel' });
  const show = (/** @type {number} */ i) => {
    panel.textContent = txt(items[i]?.text);
    for (const [j, b] of [...bar.children].entries()) b.setAttribute('aria-selected', String(i === j));
  };
  for (const [i, x] of items.entries()) {
    const b = el('button', { type: 'button', role: 'tab', text: txt(x.label) });
    b.addEventListener('click', () => show(i));
    bar.append(b);
  }
  show(0);
  return el('div', {}, [bar, panel]);
}

/** A small chart: line (a trend), column or bar (a comparison), as SVG with its numbers as text. @param {any} b */
function chart(b) {
  const labels = list(b.labels).map(txt);
  const series = list(b.series).slice(0, 3);
  const values = series.flatMap((s) => list(s.values)).filter((v) => typeof v === 'number');
  const fig = el('figure', { class: 'bchart' });
  if (!values.length || !labels.length) return fig;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const W = 320;
  const H = 150;
  const y = (/** @type {number} */ v) => H - 14 - ((v - min) / (max - min || 1)) * (H - 28);
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${txt(b.text)}: ${labels.map((l, i) => `${l} ${series.map((s) => list(s.values)[i] ?? '–').join('/')}`).join(', ')}${txt(b.unit) ? ` (${b.unit})` : ''}` });
  g.append(svg('line', { x1: 0, x2: W, y1: y(0), y2: y(0), class: 'axis' }));
  const step = W / labels.length;
  for (const [si, s] of series.entries()) {
    const vs = list(s.values);
    if (txt(b.kind) === 'line') {
      const pts = vs.map((v, i) => (typeof v === 'number' ? `${(i + 0.5) * step},${y(v)}` : null)).filter(Boolean).join(' ');
      g.append(svg('polyline', { points: pts, class: `s${si}`, fill: 'none' }));
    } else {
      const bw = (step * 0.7) / series.length;
      for (const [i, v] of vs.entries())
        if (typeof v === 'number') g.append(svg('rect', { x: i * step + step * 0.15 + si * bw, y: Math.min(y(v), y(0)), width: bw, height: Math.abs(y(0) - y(v)), class: `s${si}` }));
    }
  }
  const legend = el('figcaption', {}, [
    el('span', { text: [labels[0], labels.at(-1)].filter(Boolean).join(' → ') }),
    el('span', { text: `${min}–${max}${txt(b.unit) ? ` ${b.unit}` : ''}` }),
    ...series.map((s, si) => el('span', { class: `lg s${si}`, text: txt(s.name) })),
  ]);
  fig.append(g, legend);
  return fig;
}

/** The story's sources, numbered as the marks are. @param {any[]} sources */
function sourceList(sources) {
  return el('details', { class: 'bsrc' }, [
    el('summary', { text: `Sources (${sources.length})` }),
    el('ol', {}, sources.map((s) => {
      const href = https(s.url);
      const name = [txt(s.publisher), txt(s.title)].filter(Boolean).join(': ');
      const link = href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: name }) : el('span', { text: name });
      return el('li', {}, [link, ...(txt(s.note) ? [el('span', { class: 'bsn', text: ` ${s.note}` })] : [])]);
    })),
  ]);
}
