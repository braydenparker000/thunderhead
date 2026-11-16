// @ts-check
// The editor's own sheet for a name (a look kept as Mine): glass like the Import sheet, over the photo, with a field,
// Cancel and Save. It stands where the browser's own prompt box was, the one place the browser's own grey box showed
// through, with the site's address on it (AUDIT.md 8.10). Enter saves, Escape or a tap outside cancels.

/** Asks for a name: resolves with it (trimmed, at most `max` characters), or '' when cancelled.
 * @param {string} title @param {string} start the name offered @param {number} [max] */
export function askName(title, start, max = 40) {
  const host = /** @type {HTMLElement} */ (document.querySelector('#stage') || document.body);
  return new Promise((done) => {
    const veil = document.createElement('div'), sheet = document.createElement('form'), head = document.createElement('div'), field = document.createElement('input');
    const keys = document.createElement('div'), no = document.createElement('button'), yes = document.createElement('button');
    veil.style.cssText = 'position: absolute; inset: 0; z-index: 30; background: rgba(0,0,0,0.35); display: flex; align-items: flex-start; justify-content: center';
    sheet.className = 'glass'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', title);
    sheet.style.cssText = 'margin-top: 120px; width: 352px; padding: 16px; box-sizing: border-box; border-radius: 20px; animation: enter 220ms cubic-bezier(0.2,0.85,0.2,1) both; font: 13px Inter, system-ui, sans-serif; color: #eceff4';
    head.textContent = title; head.style.cssText = 'font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #a6b0bc; margin-bottom: 10px';
    field.value = start; field.maxLength = max; field.setAttribute('aria-label', title); field.autocomplete = 'off'; field.spellcheck = false; field.enterKeyHint = 'done';
    field.style.cssText = 'width: 100%; box-sizing: border-box; height: 40px; padding: 0 12px; border-radius: 12px; border: 1px solid #26282c; background: #0d0e10; color: #eceff4; font: 15px Inter, system-ui, sans-serif; outline: none';
    keys.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px';
    for (const [b, text, kind] of /** @type {const} */ ([[no, 'CANCEL', 'button'], [yes, 'SAVE', 'submit']])) {
      b.type = kind; b.textContent = text; b.className = 'key';
      b.style.cssText = `height: 40px; padding: 0 18px; border-radius: 12px; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; color: ${b === yes ? '#fff' : '#dedbd4'}${b === yes ? '; background: #e8202a' : ''}`;
    }
    keys.append(no, yes); sheet.append(head, field, keys); veil.append(sheet); host.append(veil);
    const end = (/** @type {string} */ v) => { veil.remove(); done(v.trim().slice(0, max)); };
    sheet.addEventListener('submit', (e) => { e.preventDefault(); end(field.value); });
    no.addEventListener('click', () => end(''));
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) end(''); });
    field.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(''); });
    field.focus(); field.select();
  });
}
