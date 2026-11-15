// Times and inline markup shared by the SRT, WebVTT and ASS readers.

// h:mm:ss,mmm. Hours may pass 99 or be missing (WebVTT); so may the fraction
// ("00:00:01 --> 00:00:02" is written by some tools).
export const STAMP = String.raw`(?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?`;
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/;

export function parseTime(value) {
  const m = TIME.exec(value);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+(m[4] || '').padEnd(3, '0')) / 1000;
}

export function pushText(spans, text, style) {
  if (!text) return;
  const last = spans[spans.length - 1];
  if (last && last.i === style.i && last.b === style.b && last.u === style.u && last.color === style.color) last.text += text;
  else spans.push({text, i: style.i, b: style.b, u: style.u, color: style.color});
}

/** The old SSA alignment number (1-3 bottom, +4 top, +8 middle) as a numpad position. */
export function legacyAlign(a) { const col = a & 3 || 2; return a & 4 ? 6 + col : a & 8 ? 3 + col : col; }

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏'};
// A number that is no character ("&#99999999;") stays as written rather than stopping the file.
const character = n => n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : null;
const decodeEntities = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => e[0] === '#'
  ? character(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) ?? all
  : ENTITIES[e.toLowerCase()] ?? all);

// What counts as a tag, so that "if a<b and c>d" stays text: a bare name
// (<i>, </b>, <c.yellow>, <br/>), a name with attributes (<font color=red>)
// or WebVTT's <v Speaker> and <lang en>. The other two shapes are WebVTT's
// inline times (<00:00:01.500>) and ASS overrides ({\an8}, {\i1}, {\pos(1,2)}).
const MARKUP = /<(\/?)([a-z][a-z0-9]*)([^<>]*)>|<\d[\d:.]*>|\{\\[^{}]*\}/gi;
const BARE = /^(?:\.[^\s<>]*)?\s*\/?$/, ATTRIBUTES = /^\s+[a-z][\w:-]*\s*=/i, SPOKEN = /^(?:v|lang)$/;
const STYLED = {i: 'i', em: 'i', b: 'b', strong: 'b', u: 'u'};
const PLAIN = {i: false, b: false, u: false, color: null};

/** SRT/WebVTT inline markup: <i>, <b>, <u>, <font color> and {\i1} {\b1} {\u1}; other tags are dropped. */
export function markupSpans(text) {
  const spans = [], stack = [];
  let style = {...PLAIN};
  let last = 0, m;
  MARKUP.lastIndex = 0;
  while ((m = MARKUP.exec(text))) {
    const tag = m[2]?.toLowerCase();
    if (tag && !(BARE.test(m[3]) || ATTRIBUTES.test(m[3]) || (SPOKEN.test(tag) && /^[.\s]/.test(m[3])))) continue; // not a tag: it stays in the text
    pushText(spans, decodeEntities(text.slice(last, m.index)), style);
    last = MARKUP.lastIndex;
    if (m[0][0] === '{') { // where the cue sits (\an) is read by the caller; position, colour and the rest are dropped
      for (const t of m[0].slice(2, -1).split('\\')) { const o = /^([ibu])(\d+)$/.exec(t); if (o) style = {...style, [o[1]]: o[2] !== '0'}; }
      continue;
    }
    if (!tag || !(STYLED[tag] || tag === 'font')) continue;
    if (m[1]) { style = stack.pop() || {...PLAIN}; continue; }
    stack.push(style);
    style = {...style};
    if (tag === 'font') { const c = /color\s*=\s*["']?([#\w]+)/i.exec(m[3]); if (c) style.color = c[1]; }
    else style[STYLED[tag]] = true;
  }
  pushText(spans, decodeEntities(text.slice(last)), style);
  return spans;
}

/** Where an SRT cue asks to sit: {\an8} (numpad) or the old {\a6}; bottom centre otherwise. */
export function srtAlign(text) {
  const m = /\{\\(?:[^{}]*\\)?an([1-9])/.exec(text);
  if (m) return +m[1];
  const old = /\{\\(?:[^{}]*\\)?a(\d+)[\\}]/.exec(text);
  return old ? legacyAlign(+old[1]) : 2;
}
