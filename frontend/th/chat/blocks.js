// @ts-check
// What is better shown than told (HOME.md §4.3): the blocks a reply may carry under its words
// (`meta.blocks`): prose, stats, chart, comparison, timeline, perspectives, agenda, quote, callout
// and explanation, in Inter (they are not the Thunderhead's voice). Every string is set with
// textContent. Loaded only when a reply has blocks (th/chat/view.js).
import { el } from '../ui.js';

const SVG = 'http://www.w3.org/2000/svg';

/** @param {string} tag @param {Record<string, string | number>} attrs */
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const txt = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : []);

/** Numbered marks for the sources a block cites. @param {unknown} cites @param {any[]} sources */
function marks(cites, sources) {
  const ns = list(cites).filter((n) => Number.isInteger(n) && sources[n]);
  if (!ns.length) return [];
  return [el('sup', { class: 'bcite', text: ns.map((n) => `[${n + 1}]`).join('') })];
}

/** One block of a reply's `meta.blocks`. @param {any} b @param {any[]} sources */
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
      for (const [i, v] of vs.entries()) if (typeof v === 'number') g.append(svg('circle', { cx: (i + 0.5) * step, cy: y(v), r: 3.5, class: `s${si}`, 'data-i': i }));
    } else {
      const bw = (step * 0.7) / series.length;
      for (const [i, v] of vs.entries())
        if (typeof v === 'number') g.append(svg('rect', { x: i * step + step * 0.15 + si * bw, y: Math.min(y(v), y(0)), width: bw, height: Math.abs(y(0) - y(v)), class: `s${si}`, 'data-i': i }));
    }
  }
  const legend = el('figcaption', {}, [
    el('span', { text: [labels[0], labels.at(-1)].filter(Boolean).join(' → ') }),
    el('span', { text: `${min}–${max}${txt(b.unit) ? ` ${b.unit}` : ''}` }),
    ...series.map((s, si) => el('span', { class: `lg s${si}`, text: txt(s.name) })),
  ]);
  // A tap reads out the column under the finger and marks it; the figure's label has every value.
  const read = el('p', { class: 'bread', 'aria-live': 'polite' });
  g.addEventListener('click', (e) => {
    const box = g.getBoundingClientRect();
    const i = Math.min(labels.length - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * labels.length)));
    const unit = txt(b.unit) ? ` ${b.unit}` : '';
    read.textContent = `${labels[i]}: ${series.map((s) => `${list(s.values)[i] ?? '–'}${unit}${series.length > 1 ? ` ${txt(s.name)}` : ''}`).join(' · ')}`;
    for (const m of g.querySelectorAll('[data-i]')) m.classList.toggle('on', Number(m.getAttribute('data-i')) === i);
    g.classList.add('picked');
  });
  fig.append(g, read, legend);
  return fig;
}
