// @ts-check
// Study's words (STUDY.md §3.2, §4; COPY.md): a book's line under its cover, page numbers as the
// owner reads them, and the reader's "Go to page" grammar. Pure, so a node test checks them.

/** @typedef {import('../../../shared/contract/library.ts').Book} Book */

const n = (/** @type {number} */ x) => x.toLocaleString('en-US');

/** The line under a cover for a book's state; '' when there is nothing to say. @param {Book} b */
export function stateLine(b) {
  const of = b.read_pages !== undefined && b.pdf_pages ? ` ${n(b.read_pages)} of ${n(b.pdf_pages)} pages` : '';
  switch (b.state) {
    case 'uploading':
      return 'Adding…';
    case 'stored':
    case 'queued':
      return 'Waiting to be read';
    case 'extracting':
      return `Reading…${of}`;
    case 'ocr':
      return `Reading scanned pages…${of}`;
    case 'indexing':
      return b.paused ? 'Indexing… (continues tonight)' : 'Indexing…';
    case 'failed':
      return "Couldn't read this book.";
    case 'duplicate':
      return 'Already in your library';
    default:
      return '';
  }
}

/** "p. 212", or "PDF p. 230" when the page has no printed number.
 * @param {number} pdfPage @param {string | null | undefined} label */
export const pageName = (pdfPage, label) => (label ? `p. ${label}` : `PDF p. ${n(pdfPage)}`);

/** The details line: "Page 212 · PDF page 230 of 512". @param {number} pdfPage @param {string | null | undefined} label @param {number} total */
export const pageDetail = (pdfPage, label, total) =>
  `${label ? `Page ${label} · ` : ''}PDF page ${n(pdfPage)} of ${n(total)}`;

/**
 * "Go to page": a printed label ("212", "xiv") or "pdf 230". Returns the PDF pages it names (a label
 * printed twice names both, first first), or [] for nothing.
 * @param {string} typed @param {(string | null)[]} labels the label of each PDF page (index 0 = page 1)
 * @returns {number[]}
 */
export function goTo(typed, labels) {
  const raw = typed.trim().toLowerCase();
  const pdf = /^pdf\s*(?:p\.?\s*)?(\d{1,6})$/.exec(raw);
  if (pdf) {
    const p = Number(pdf[1]);
    return p >= 1 && p <= labels.length ? [p] : [];
  }
  // "p. 212" and "p 212" are the printed page 212.
  const t = raw.replace(/^p(?:\.\s*|\s+)/, '');
  if (!t) return [];
  const hits = [];
  labels.forEach((l, i) => {
    if (l !== null && l.toLowerCase() === t) hits.push(i + 1);
  });
  // A book with no printed labels: a bare number is the PDF page.
  if (!hits.length && /^\d{1,6}$/.test(t) && labels.every((l) => l === null)) {
    const p = Number(t);
    if (p >= 1 && p <= labels.length) hits.push(p);
  }
  return hits;
}

/** Books for the Continue row: the last 3 opened, newest first. @param {Book[]} books */
export const continueRow = (books) =>
  books
    .filter((b) => b.position && b.state !== 'uploading')
    .sort((a, b) => (b.position?.at ?? 0) - (a.position?.at ?? 0))
    .slice(0, 3);

/** All books: last opened first, then by title. @param {Book[]} books */
export const shelfOrder = (books) =>
  [...books].sort(
    (a, b) => (b.position?.at ?? 0) - (a.position?.at ?? 0) || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
  );

/** How far into a book a place is, 0–1. @param {Book} b */
export const progress = (b) => (b.position && b.pdf_pages ? Math.min(1, b.position.pdf_page / b.pdf_pages) : 0);

/** The search snippet as plain pieces: text, and the words to mark. The Worker sends escaped HTML
 * with `<mark>` only; it is never put in the page as HTML. @param {string} html
 * @returns {{ text: string, mark: boolean }[]} */
export function snippetParts(html) {
  const un = (/** @type {string} */ s) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return html
    .split(/(<mark>[\s\S]*?<\/mark>)/)
    .filter(Boolean)
    .map((p) => (p.startsWith('<mark>') ? { text: un(p.slice(6, -7)), mark: true } : { text: un(p), mark: false }));
}
