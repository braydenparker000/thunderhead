// @ts-check
// DOM helpers shared by the sign-in pages and Settings: the password Show button, the toast,
// the confirm sheet, the "Your recovery code" screen (SIGN-IN.md §7.1) and the 500 ms tap guard
// on access buttons (SECURITY.md §4.3, item 4).

import { confirmsLastFive, groupCode } from './codes.js';

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [kids]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

const shownAt = performance.now();
/** Taps on access buttons within 500 ms of the page appearing are ignored (a framed overlay can't
 * time a tap onto them). */
export const tooSoon = () => performance.now() - shownAt < 500;

/** Wires every `.show` button to the password field before it (§12 markup). */
export function wireShowButtons(root = document) {
  for (const b of root.querySelectorAll('button.show')) {
    const input = /** @type {HTMLInputElement | null} */ (b.previousElementSibling);
    if (!input || b.hasAttribute('data-wired')) continue;
    b.setAttribute('data-wired', '');
    b.addEventListener('click', () => {
      const on = input.type === 'password';
      input.type = on ? 'text' : 'password';
      b.textContent = on ? 'Hide' : 'Show';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Hide password.' : 'Show password as plain text. Warning: this will display your password on the screen.');
    });
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/** A short line at the top. Never the Memory page's undo toast (`.utoast`), whose Undo it would wipe.
 * @param {string} text */
export function toast(text) {
  let t = document.querySelector('.toast:not(.utoast)');
  if (!t) {
    t = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t?.classList.remove('show'), 1700);
}

/**
 * A bottom confirm sheet; resolves true for the action, false for Keep. Focus starts on Keep.
 * @param {{ title: string, body?: string, action: string, keep?: string, danger?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function confirmSheet(o) {
  return new Promise((resolve) => {
    const before = /** @type {HTMLElement | null} */ (document.activeElement);
    const dim = el('div', { class: 'cdim' });
    const go = el('button', { type: 'button', class: o.danger === false ? 'btn' : 'btn danger', text: o.action });
    const keep = el('button', { type: 'button', class: 'btn soft', text: o.keep ?? 'Keep' });
    const sheet = el('div', { class: 'csheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, [el('h2', { text: o.title })]);
    if (o.body) sheet.append(el('p', { text: o.body }));
    sheet.append(go, keep);
    document.body.append(dim, sheet);
    requestAnimationFrame(() => {
      dim.classList.add('on');
      sheet.classList.add('on');
    });
    keep.focus({ preventScroll: true });
    /** @param {boolean} answer */
    const done = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      dim.remove();
      sheet.remove();
      before?.focus?.({ preventScroll: true });
      resolve(answer);
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === go ? keep : go).focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    go.addEventListener('click', () => {
      if (!tooSoon()) done(true);
    });
    keep.addEventListener('click', () => done(false));
    dim.addEventListener('click', () => done(false));
  });
}

/**
 * The "Your recovery code" screen in `host`. No Copy button (clipboard history can sync). Resolves
 * when the owner typed the last five and tapped Continue.
 * @param {HTMLElement} host
 * @param {string} code
 * @returns {Promise<string>} the typed last five
 */
export function recoveryScreen(host, code) {
  return new Promise((resolve) => {
    const input = el('input', { id: 'confirm-code', name: 'confirm-code', class: 'code-in', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', maxlength: '7' });
    const go = el('button', { type: 'submit', class: 'btn', text: 'Continue' });
    go.disabled = true;
    const form = el('form', { class: 'recovery', novalidate: '' }, [
      el('h2', { text: 'Your recovery code' }),
      el('p', { text: "Write this down on paper and keep it somewhere safe. It's the only way back in if you forget your password. You won't see it again." }),
      el('div', { class: 'codebox', id: 'recovery-code', text: groupCode(code) }),
      el('div', { class: 'fld' }, [el('label', { for: 'confirm-code', text: 'Type the last 5 characters to confirm you saved it' }), input]),
      go,
    ]);
    host.replaceChildren(form);
    input.addEventListener('input', () => {
      go.disabled = !confirmsLastFive(code, input.value);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (confirmsLastFive(code, input.value)) resolve(input.value.toUpperCase().replace(/[\s-]/g, ''));
    });
    input.focus({ preventScroll: true });
  });
}

/**
 * Runs the sign-in countdown on a button (§6.2): the label changes each second, a screen reader
 * hears only the start and the end (`live` is a visually hidden polite region), and the button
 * stays disabled until 0.
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} live a polite live region
 * @param {() => { state: string, waitLeft: number }} tick
 * @param {string} idleLabel
 * @param {string} startLine
 * @param {(seconds: number) => string} label
 */
export function countdown(button, live, tick, idleLabel, startLine, label) {
  button.disabled = true;
  const first = Math.ceil(tick().waitLeft);
  live.textContent = `${startLine} You can try again in ${first} seconds.`;
  const step = () => {
    const v = tick();
    if (v.state !== 'waiting') {
      button.disabled = false;
      button.textContent = idleLabel;
      live.textContent = 'You can try again now.';
      return;
    }
    button.textContent = label(v.waitLeft);
    setTimeout(step, 250);
  };
  step();
}
