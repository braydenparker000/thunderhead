// Shared menu and Settings anatomy. All presentation lives in ui/forms.css.
import { el, tooSoon } from '/th/ui.js';
import { animator, restTime, springs } from '/th/motion.js';

/** @param {string} name */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i row-icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', `/ui/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

/** @param {{title:string,detail?:string,icon?:string,value?:string,open?:boolean,danger?:boolean,onClick?:()=>unknown}} options */
export function row({ title, detail, icon: symbol, value, open = false, danger = false, onClick }) {
  const copy = el('span', { class: 'row-copy t' }, [el('span', { class: 'row-title', text: title })]);
  if (detail) copy.append(el('span', { class: 'row-detail', text: detail }));
  const button = el('button', { type: 'button', class: `row${danger ? ' danger' : ''}` }, [...(symbol ? [icon(symbol)] : []), copy]);
  if (value !== undefined) button.append(el('span', { class: 'row-value', text: value }));
  if (open && !danger) {
    const caret = icon('caret-right');
    caret.setAttribute('class', 'i row-caret');
    button.append(caret);
  }
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

/** @param {string} title @param {(Node|string)[]} children */
export function group(title, children) {
  return el('section', { class: 'group-section' }, [
    el('h2', { class: 'group-title', text: title }), el('div', { class: 'group' }, children),
  ]);
}

/** @param {string} title @param {string} symbol @param {boolean} on @param {(on:boolean)=>unknown} change */
export function switchRow(title, symbol, on, change) {
  const button = row({ title, icon: symbol });
  button.classList.add('switch');
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(on));
  button.append(el('span', { class: 'switch-track', 'aria-hidden': 'true' }));
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    change(next);
  });
  return button;
}

/** @param {string} label @param {[string,string][]} options @param {string} value @param {(value:string)=>unknown} pick */
export function choice(label, options, value, pick) {
  const track = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label, 'data-count': String(options.length) });
  track.append(el('span', { class: 'seg-thumb', 'aria-hidden': 'true' }));
  const show = (/** @type {string} */ next) => {
    track.dataset.index = String(Math.max(0, options.findIndex(([v]) => v === next)));
    for (const b of track.querySelectorAll('button')) {
      const on = b.dataset.v === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  for (const [v, name] of options) {
    const button = el('button', { type: 'button', class: 'seg-option', role: 'radio', 'data-v': v, text: name });
    button.addEventListener('click', () => { show(v); pick(v); });
    track.append(button);
  }
  track.addEventListener('keydown', (e) => {
    const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const buttons = [...track.querySelectorAll('button')];
    const next = buttons[(buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement)) + d + buttons.length) % buttons.length];
    next.click(); next.focus();
  });
  show(value);
  return el('div', { class: 'seg-field sfield' }, [el('div', { class: 'seg-label', text: label }), track]);
}

/** A bottom sheet shares the page spring with the shell. Dragging the grabber keeps velocity.
 * @param {{title:string,children:(Node|string)[],onClose?:()=>unknown,cancel?:string}} options */
export function sheet({ title, children, onClose, cancel = 'Cancel' }) {
  const before = /** @type {HTMLElement|null} */ (document.activeElement);
  const dim = el('div', { class: 'sheet-dim cdim' });
  const handle = el('div', { class: 'sheet-handle' }, [el('span', { class: 'sheet-grabber', 'aria-hidden': 'true' })]);
  const keep = el('button', { type: 'button', class: 'btn soft', text: cancel });
  const element = el('section', { class: 'sheet csheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    handle, el('h2', { class: 'sheet-title', text: title }), el('div', { class: 'sheet-content' }, children), keep,
  ]);
  document.body.append(dim, element);
  let closing = false;
  const token = getComputedStyle(element).getPropertyValue('--d-sheet').trim();
  const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
  const timeScale = Math.max(Number.EPSILON, duration / restTime(springs.page));
  const move = animator((y) => { element.style.transform = `translateY(${y}px)`; });
  const fade = animator((opacity) => { dim.style.opacity = String(opacity); }, { unit: 'opacity' });
  move.set(element.getBoundingClientRect().height);
  fade.set(0);
  element.classList.add('on'); dim.classList.add('on');
  element.style.transition = 'none'; dim.style.transition = 'none';
  move.to(0, { spring: springs.page, timeScale }); fade.to(1, { spring: springs.page, timeScale });
  /** @param {number} [velocity] */
  const close = async (velocity = 0) => {
    if (closing) return;
    closing = true;
    element.inert = true;
    element.style.pointerEvents = 'none'; dim.style.pointerEvents = 'none';
    element.classList.remove('csheet');
    before?.focus({ preventScroll: true });
    onClose?.();
    document.removeEventListener('keydown', onKey, true);
    move.to(element.getBoundingClientRect().height + 24, { spring: springs.page, timeScale, velocity });
    fade.to(0, { spring: springs.page, timeScale });
    await Promise.all([move.whenResting(), fade.whenResting()]);
    element.remove(); dim.remove();
  };
  const focusable = () => [...element.querySelectorAll('button:not(:disabled),input,textarea,a[href],[tabindex="0"]')].filter((n) => !/** @type {HTMLElement} */ (n).hidden);
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); void close(); }
    if (e.key !== 'Tab') return;
    const controls = focusable();
    const next = (controls.indexOf(/** @type {Element} */ (document.activeElement)) + (e.shiftKey ? -1 : 1) + controls.length) % controls.length;
    e.preventDefault(); /** @type {HTMLElement} */ (controls[next])?.focus();
  };
  document.addEventListener('keydown', onKey, true);
  keep.addEventListener('click', () => void close());
  dim.addEventListener('click', () => void close());
  keep.focus({ preventScroll: true });
  /** @type {{id:number,start:number,y:number,time:number,velocity:number}|null} */
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || closing) return;
    drag = { id: e.pointerId, start: e.clientY - move.value, y: e.clientY, time: e.timeStamp, velocity: 0 };
    move.stop(); handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const elapsed = e.timeStamp - drag.time;
    if (elapsed > 0) drag.velocity = (e.clientY - drag.y) / elapsed * 1000;
    drag.y = e.clientY; drag.time = e.timeStamp;
    move.set(Math.max(0, e.clientY - drag.start));
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const velocity = e.timeStamp - drag.time < 120 ? drag.velocity : 0;
    const dismiss = e.type === 'pointerup' && (move.value > element.getBoundingClientRect().height * .3 || move.value > 10 && velocity > 800);
    drag = null;
    if (dismiss) void close(velocity);
    else move.to(0, { spring: springs.page, timeScale, velocity });
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  return { element, close };
}

/** The button's value stays usable by forms without a hidden native select.
 * @param {string} label @param {[string,string][]} options @param {string} value @param {(value:string)=>unknown} pick */
export function picker(label, options, value, pick) {
  const button = row({ title: label, value: options.find(([v]) => v === value)?.[1] ?? value, open: true });
  const show = (/** @type {string} */ next) => {
    value = next;
    const output = button.querySelector('.row-value');
    if (output) output.textContent = options.find(([v]) => v === next)?.[1] ?? next;
  };
  Object.defineProperty(button, 'value', { get: () => value, set: show });
  button.addEventListener('click', () => {
    const choices = options.map(([v, name]) => {
      const option = row({ title: name });
      option.setAttribute('role', 'radio'); option.setAttribute('aria-checked', String(v === value));
      option.dataset.value = v;
      if (v === value) { const check = icon('check'); check.setAttribute('class', 'i row-check'); option.append(check); }
      option.addEventListener('click', () => { show(v); pick(v); button.dispatchEvent(new Event('change')); void modal.close(); });
      return option;
    });
    const modal = sheet({ title: label, children: [el('div', { class: 'group', role: 'radiogroup', 'aria-label': label }, choices)] });
  });
  return button;
}

/** Settings and menu confirmations use the same sheet, with the original access tap guard.
 * @param {{title:string,body?:string,action:string,keep?:string,danger?:boolean}} options */
export function confirmSheet({ title, body, action, keep = 'Keep', danger = true }) {
  return new Promise((resolve) => {
    let accepted = false;
    const go = el('button', { type: 'button', class: `btn${danger ? ' danger' : ''}`, text: action });
    const modal = sheet({ title, cancel: keep, children: [...(body ? [el('p', { class: 'sheet-note', text: body })] : []), go], onClose: () => resolve(accepted) });
    go.addEventListener('click', () => { if (!tooSoon()) { accepted = true; void modal.close(); } });
  });
}
