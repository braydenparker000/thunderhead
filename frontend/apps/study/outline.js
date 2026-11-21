// @ts-check
// "Contents" in the reader's menu (STUDY.md §5.1): the PDF's own outline, each entry going to its
// page; a book without one shows its pages as small pictures, ten at a time.
import { el } from '/th/ui.js';
import { pageName } from './words.js';

const THUMB = 96;

/** The page an outline entry goes to, or null. @param {any} doc @param {any} dest */
async function pageOf(doc, dest) {
  try {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d)) return null;
    return typeof d[0] === 'number' ? d[0] + 1 : (await doc.getPageIndex(d[0])) + 1;
  } catch {
    return null;
  }
}

/**
 * @param {(title: string, fill: (box: HTMLElement, close: () => void) => void) => void} sheet
 * @param {any} doc @param {number} total @param {(string | null)[]} labels @param {(n: number) => void} to
 */
export async function contentsSheet(sheet, doc, total, labels, to) {
  /** @type {{ title: string, dest: any, items: any[] }[]} */
  const outline = (await doc.getOutline().catch(() => null)) ?? [];
  sheet(outline.length ? 'Contents' : 'Pages', (box, close) => {
    const go = (/** @type {number} */ n) => {
      close();
      to(n);
    };
    if (outline.length) {
      const list = el('div', { class: 'toc' });
      const add = (/** @type {typeof outline} */ items, /** @type {number} */ depth) => {
        for (const it of items) {
          const row = el('button', { type: 'button', class: 'tocrow', style: `padding-left:${12 + Math.min(depth, 3) * 16}px` }, [String(it.title ?? '').trim() || '…']);
          row.addEventListener('click', async () => {
            const n = await pageOf(doc, it.dest);
            if (n) go(n);
          });
          list.append(row);
          if (it.items?.length) add(it.items, depth + 1);
        }
      };
      add(outline, 0);
      box.append(list);
      return;
    }
    const grid = el('div', { class: 'thumbs' });
    const more = el('button', { type: 'button', class: 'btn soft' });
    let shown = 0;
    const next = () => {
      const upto = Math.min(total, shown + 10);
      for (let n = shown + 1; n <= upto; n++) {
        const canvas = el('canvas');
        const t = el('button', { type: 'button', class: 'thumb', 'aria-label': pageName(n, labels[n - 1]) }, [canvas, el('small', { text: pageName(n, labels[n - 1]) })]);
        t.addEventListener('click', () => go(n));
        grid.append(t);
        doc
          .getPage(n)
          .then((/** @type {any} */ page) => {
            const viewport = page.getViewport({ scale: THUMB / page.getViewport({ scale: 1 }).width });
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            return page.render({ canvas, viewport }).promise;
          })
          .catch(() => {});
      }
      shown = upto;
      if (shown >= total) more.remove();
      else more.textContent = `Pages ${shown + 1} to ${Math.min(total, shown + 10)}`;
    };
    more.addEventListener('click', next);
    box.append(grid, more);
    next();
  });
}
