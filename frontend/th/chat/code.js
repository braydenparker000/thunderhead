// @ts-check
// A code block in a reply (th/chat/rich.js): a quiet box, its language over it and a Copy button that
// copies the block's text exactly. The words on the head are drawn by CSS (apps/home/chat.css), so the
// reply's text, said once to a screen reader, stays the reply's own. DOM calls only, never markup.

const SVG = 'http://www.w3.org/2000/svg';
const SHOWN_MS = 1600;

/** @param {string} text @param {string} [lang] @returns {HTMLElement} */
export function codeBlock(text, lang) {
  const box = document.createElement('div');
  box.className = 'codeblock';
  const head = document.createElement('div');
  head.className = 'codehead';
  if (lang) head.dataset.lang = lang;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy';
  btn.setAttribute('aria-label', 'Copy code');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '/ui/icons.svg#copy');
  svg.append(use);
  btn.append(svg);
  const pre = document.createElement('pre');
  pre.textContent = text;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  btn.addEventListener('click', async () => {
    const done = (await copy(text)) || select(pre);
    btn.classList.toggle('done', done === true);
    btn.classList.toggle('picked', done === 'selected');
    btn.setAttribute('aria-label', done === true ? 'Copied' : 'Code selected');
    use.setAttribute('href', `/ui/icons.svg#${done === true ? 'check' : 'copy'}`);
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.classList.remove('done', 'picked');
      btn.setAttribute('aria-label', 'Copy code');
      use.setAttribute('href', '/ui/icons.svg#copy');
    }, SHOWN_MS);
  });
  head.append(btn);
  box.append(head, pre);
  return box;
}

/** The clipboard, else the older copy command over a selection of the text. @param {string} text */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'copyfrom';
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  area.remove();
  return ok;
}

/** When copying is refused, the code is selected so the system's own Copy can take it.
 * @param {HTMLElement} pre @returns {'selected'} */
function select(pre) {
  const r = document.createRange();
  r.selectNodeContents(pre);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(r);
  return 'selected';
}
