// @ts-check
// A long or imported reply in the past view, as readable text (HOME.md §4.9): the old Chats wrote
// in Markdown, so headings, bullet and numbered lists, **bold**, `code`, fenced code, tables and
// https links become their elements. Everything else stays plain text: nodes are built and text is
// set with textContent, never parsed as markup.

/** Replies at least this long read as text even without Markdown. */
export const LONG = 280;
const MARKS = /^(#{1,6}\s|[-*•–]\s|\d+[.)]\s|```|\|)|\*\*[^*]+\*\*|`[^`]+`/m;
const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|(https:\/\/[^\s<>"]*[^\s<>".,;:!?)'\]])/g;

/** Whether a mind reply reads better as text than in the voice. @param {string} body @param {boolean} imported */
export const isProse = (body, imported) => imported || body.length >= LONG || MARKS.test(body);

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [cls] */
function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

/** **bold**, `code` and https links inside one line. @param {HTMLElement} host @param {string} text */
function inline(host, text) {
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) host.append(text.slice(at, m.index));
    if (m[1] !== undefined) host.append(Object.assign(el('b'), { textContent: m[1] }));
    else if (m[2] !== undefined) host.append(Object.assign(el('code'), { textContent: m[2] }));
    else {
      const a = el('a');
      a.href = m[3];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = m[3].replace(/^https:\/\/(www\.)?/, '');
      host.append(a);
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) host.append(text.slice(at));
}

/** The cells of a table row "| a | b |". @param {string} line */
const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** The reply as blocks. @param {string} text @returns {DocumentFragment} */
export function prose(text) {
  const out = document.createDocumentFragment();
  /** @type {HTMLElement | null} */
  let list = null;
  /** @type {HTMLElement | null} */
  let code = null;
  /** @type {HTMLTableSectionElement | null} */
  let table = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (code) {
      if (line.startsWith('```')) code = null;
      else code.textContent += `${code.textContent ? '\n' : ''}${raw}`;
      continue;
    }
    if (line.startsWith('|') && line.length > 1) {
      list = null;
      if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')) continue;
      const head = !table;
      if (!table) {
        const wrap = el('div', 'tbl');
        const t = el('table');
        table = t.createTBody();
        wrap.append(t);
        out.append(wrap);
      }
      const tr = table.insertRow();
      for (const c of cells(line)) {
        const td = el(head ? 'th' : 'td');
        inline(td, c);
        tr.append(td);
      }
      continue;
    }
    table = null;
    if (line.startsWith('```')) {
      list = null;
      code = el('pre');
      out.append(code);
      continue;
    }
    if (!line) {
      list = null;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      list = null;
      out.append(el('hr'));
      continue;
    }
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    const li = h ? null : /^(?:[-*•–]|(\d+)[.)])\s+(.+)$/.exec(line);
    if (li) {
      const tag = li[1] ? 'ol' : 'ul';
      if (!list || /** @type {HTMLElement} */ (list).tagName.toLowerCase() !== tag) {
        list = el(tag);
        if (li[1] && li[1] !== '1') list.setAttribute('start', li[1]);
        out.append(list);
      }
      const item = el('li');
      inline(item, li[2]);
      list.append(item);
      continue;
    }
    list = null;
    const p = el('p', h ? 'h' : '');
    inline(p, h ? h[1].replace(/\*\*/g, '') : line);
    out.append(p);
  }
  return out;
}
