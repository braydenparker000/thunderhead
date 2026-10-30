// @ts-check
// The Thunderhead's replies as rich text (HOME.md §4.3): Markdown's everyday marks, https links,
// and cited blocks of the owner's books as numbered taps into Study (STUDY.md §8). `parse` is plain
// data (tested in node); `rich` builds nodes and sets text, never markup.
import { citeHref, label } from './model.js';

const LIST_AFTER = /(?<=[.!?:])\s+(?=– )/;
const LINK = /https:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]*_]/;
const CITE = /\[\[book:(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})#p(?<pg>\d{1,5})\.b(?<bk>\d{1,4})\]\]/;
const INLINE = new RegExp(
  `\\*\\*(?<b>[^*]+)\\*\\*|(?<![\\w*])\\*(?<i>[^*\\s](?:[^*]*[^*\\s])?)\\*(?![\\w*])|(?<![\\w_])_(?<u>[^_\\s](?:[^_]*[^_\\s])?)_(?![\\w_])|\`(?<c>[^\`]+)\`|(?<a>${LINK.source})|${CITE.source}`,
  'g',
);

/** @typedef {{ text: string } | { b: string } | { i: string } | { code: string } | { href: string, label: string, cite?: true }} Part */
/** @typedef {{ t: 'p', lines: Part[][] } | { t: 'h', parts: Part[] } | { t: 'q', parts: Part[] } | { t: 'ul', start: number, items: Part[][] } | { t: 'ol', start: number, items: Part[][] } | { t: 'pre', text: string } | { t: 'table', rows: Part[][][] } | { t: 'hr' }} Block */

/** The text as blocks. @param {string} text @returns {Block[]} */
export function parse(text) {
  /** @type {string[]} */
  const cited = [];
  /** @param {string} s @returns {Part[]} */
  const inline = (s) => {
    /** @type {Part[]} */
    const parts = [];
    let at = 0;
    for (const m of s.matchAll(INLINE)) {
      const g = /** @type {Record<string, string | undefined>} */ (m.groups);
      if (m.index > at) parts.push({ text: s.slice(at, m.index) });
      if (g.b !== undefined) parts.push({ b: g.b });
      else if (g.i !== undefined || g.u !== undefined) parts.push({ i: /** @type {string} */ (g.i ?? g.u) });
      else if (g.c !== undefined) parts.push({ code: g.c });
      else if (g.a !== undefined) parts.push({ href: g.a, label: label(g.a) });
      else {
        const ref = `book:${g.id}#p${g.pg}.b${g.bk}`;
        if (!cited.includes(ref)) cited.push(ref);
        parts.push({ href: /** @type {string} */ (citeHref(ref)), label: String(cited.indexOf(ref) + 1), cite: true });
      }
      at = m.index + m[0].length;
    }
    if (at < s.length) parts.push({ text: s.slice(at) });
    // No space before a cite mark: it reads as a superscript.
    for (const [k, p] of parts.entries()) if ('cite' in p && k > 0 && 'text' in parts[k - 1]) parts[k - 1] = { text: /** @type {{ text: string }} */ (parts[k - 1]).text.replace(/[ \t]+$/, '') };
    return parts;
  };
  /** @type {Block[]} */
  const out = [];
  /** @type {Block | null} */
  let open = null;
  let fence = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      if (raw.trim().startsWith('```')) fence = false;
      else {
        const pre = /** @type {{ t: 'pre', text: string }} */ (out[out.length - 1]);
        pre.text += `${pre.text ? '\n' : ''}${raw}`;
      }
      continue;
    }
    for (const piece of raw.split(LIST_AFTER)) {
      const line = piece.trim();
      if (line.startsWith('```')) {
        out.push({ t: 'pre', text: '' });
        fence = true;
        open = null;
        continue;
      }
      if (!line) {
        open = null;
        continue;
      }
      if (line.startsWith('|') && line.length > 1) {
        if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')) continue;
        if (open?.t !== 'table') out.push((open = { t: 'table', rows: [] }));
        open.rows.push(line.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
        out.push({ t: 'hr' });
        open = null;
        continue;
      }
      const h = /^#{1,6}\s+(.+)$/.exec(line);
      const q = /^>\s?(.*)$/.exec(line);
      const li = /^(?:[-*•–]|(\d+)[.)])\s+(.+)$/.exec(line);
      if (h || q) {
        out.push({ t: h ? 'h' : 'q', parts: inline(h ? h[1].replace(/\*\*/g, '') : /** @type {RegExpExecArray} */ (q)[1]) });
        open = null;
      } else if (li) {
        const t = li[1] ? 'ol' : 'ul';
        if (open?.t !== t) out.push((open = /** @type {Block} */ ({ t, start: Number(li[1] ?? 1), items: [] })));
        /** @type {{ items: Part[][] }} */ (open).items.push(inline(li[2]));
      } else {
        if (open?.t !== 'p') out.push((open = { t: 'p', lines: [] }));
        open.lines.push(inline(line));
      }
    }
  }
  return out;
}

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [text] */
function el(tag, text) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
}

/** @param {HTMLElement} host @param {Part[]} parts */
function fill(host, parts) {
  for (const p of parts) {
    if ('text' in p) host.append(p.text);
    else if ('b' in p) host.append(el('b', p.b));
    else if ('i' in p) host.append(el('i', p.i));
    else if ('code' in p) host.append(el('code', p.code));
    else {
      const a = el('a', p.label);
      a.href = p.href;
      if (p.cite) {
        // A cited block opens Study at its page, in this tab (STUDY.md §8.1).
        a.className = 'cite';
        a.setAttribute('aria-label', `Source ${p.label}`);
      } else {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      host.append(a);
    }
  }
  return host;
}

/** The reply as nodes. @param {string} text @returns {DocumentFragment} */
export function rich(text) {
  const frag = document.createDocumentFragment();
  for (const b of parse(text)) {
    if (b.t === 'p') {
      const p = el('p');
      for (const [k, line] of b.lines.entries()) {
        if (k) p.append(el('br'));
        fill(p, line);
      }
      frag.append(p);
    } else if (b.t === 'h') frag.append(fill(el('h3'), b.parts));
    else if (b.t === 'q') frag.append(fill(el('blockquote'), b.parts));
    else if (b.t === 'ul' || b.t === 'ol') {
      const list = el(b.t);
      if (b.t === 'ol' && b.start !== 1) list.setAttribute('start', String(b.start));
      for (const item of b.items) list.append(fill(el('li'), item));
      frag.append(list);
    } else if (b.t === 'pre') frag.append(el('pre', b.text));
    else if (b.t === 'hr') frag.append(el('hr'));
    else {
      const wrap = el('div');
      wrap.className = 'tbl';
      const table = el('table');
      for (const [r, row] of b.rows.entries()) {
        const tr = el('tr');
        for (const cell of row) tr.append(fill(el(r ? 'td' : 'th'), cell));
        table.append(tr);
      }
      wrap.append(table);
      frag.append(wrap);
    }
  }
  return frag;
}
