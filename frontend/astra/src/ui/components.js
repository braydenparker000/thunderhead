// Shared pieces: poster cards, the long-press lift menu, bottom sheets,
// toasts and skeleton rows.

import {h, haptic, reducedMotion} from './dom.js';
import {icon} from './icons.js';
import {pushLayer} from '../app/back-stack.js';
// Poster cards, images, skeleton rows and empty states (the browse screens').
export {posterCard, image, setWatchedBadge, skeletonRow, emptyCard} from './poster.js';

const LONG_PRESS_MS = 450;

// Pointers currently down anywhere, so a menu opened by a long press can
// ignore the release of that same press.
const held = new Set();
if (typeof addEventListener === 'function') {
  addEventListener('pointerdown', e => held.add(e.pointerId), true);
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, e => held.delete(e.pointerId), true);
}

/**
 * A menu or sheet opened by a long press takes taps only once the finger
 * that opened it has lifted; otherwise the release would tap whatever item
 * ends up under it.
 */
function armAfterRelease(layer) {
  if (!held.size) return;
  let armed = false, released = false;
  // The release's own click comes a few milliseconds after pointerup, in a task of its own.
  layer.addEventListener('click', e => {
    if (armed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (released) armed = true;
  }, true);
  const types = ['pointerup', 'pointercancel'];
  const onUp = () => {
    if (held.size) return;
    released = true;
    setTimeout(() => { armed = true; }, 400);
    for (const type of types) removeEventListener(type, onUp, true);
  };
  for (const type of types) addEventListener(type, onUp, true);
}

/** Calls onLongPress after a still press; a normal tap still clicks. Returns a cleanup. */
export function longPress(el, onLongPress) {
  let timer = 0, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); start = null; };
  // Android Chrome also sends contextmenu for a long press (at about 400 ms):
  // whichever comes first opens the menu, once.
  const fire = e => { clearTimeout(timer); if (fired || document.querySelector('.lift, .sheet')) return; fired = true; haptic(12); onLongPress(e); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    fired = false; start = {x: e.clientX, y: e.clientY};
    timer = setTimeout(() => fire(e), LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
  el.addEventListener('contextmenu', e => { e.preventDefault(); fire(e); });
}

/** Nuvio's long-press menu: the poster lifts to the centre over a blurred app. */
export function liftMenu(source, title, subtitle, actions) {
  const rect = source.getBoundingClientRect();
  const art = source.cloneNode(true);
  art.classList.add('lift-art');
  const menu = h('div', {class: 'lift-menu', role: 'menu'}, ...actions.map((a, i) => h('button', {
    class: 'lift-item' + (a.destructive ? ' destructive' : ''), type: 'button', role: 'menuitem', style: {animationDelay: `${60 + i * 35}ms`},
    onclick: () => { if (close()) a.run(); }, // a second quick tap runs nothing
  }, h('span', {}, a.label), a.icon ? icon(a.icon, {size: 20}) : null)));
  // Title and menu stack in one column, so the 14 px between them holds whatever the title's length.
  const panel = h('div', {class: 'lift-panel'}, h('div', {class: 'lift-text'}, h('b', {}, title || ''), subtitle ? h('span', {}, subtitle) : null), menu);
  const layer = h('div', {class: 'lift', onclick: e => { if (e.target === layer || e.target === panel) close(); }}, art, panel);
  // Landscape art (Continue Watching, episodes) may take 80% of the width, posters 60%.
  const wide = rect.width > rect.height;
  const targetW = Math.min(innerWidth * (wide ? 0.8 : 0.6), (innerHeight * 0.44) * (rect.width / rect.height));
  const targetH = targetW * (rect.height / rect.width);
  const tx = innerWidth / 2 - targetW / 2, ty = Math.max(24, innerHeight * 0.4 - targetH / 2 - 60);
  // The art sits at its final size and place; a transform carries it there
  // from the card (only compositing, no layout per frame).
  Object.assign(art.style, {left: tx + 'px', top: ty + 'px', width: targetW + 'px', height: targetH + 'px', transformOrigin: '0 0'});
  const fromCard = `translate(${rect.left - tx}px, ${rect.top - ty}px) scale(${rect.width / targetW}, ${rect.height / targetH})`;
  art.style.transform = fromCard;
  layer.style.setProperty('--menu-top', (ty + targetH + 18) + 'px');
  document.body.append(layer);
  armAfterRelease(layer);
  const move = reducedMotion() ? 0 : 300;
  art.getBoundingClientRect(); // start from the card
  requestAnimationFrame(() => {
    layer.classList.add('open');
    art.style.transition = `transform ${move}ms cubic-bezier(.2,.9,.3,1.15)`;
    art.style.transform = 'none';
  });
  const pop = pushLayer('lift', () => close(true));
  function close(fromBack = false) {
    if (!layer.isConnected || layer.classList.contains('closing')) return false;
    if (!fromBack) pop();
    layer.classList.add('closing');
    layer.classList.remove('open');
    art.style.transition = `transform ${Math.round(move * 0.7)}ms cubic-bezier(.4,0,.2,1)`;
    art.style.transform = fromCard;
    setTimeout(() => layer.remove(), move);
    return true;
  }
  menu.querySelector('button')?.focus({preventScroll: true});
  return close;
}

/**
 * A bottom sheet with a title and rows: Nuvio's floating card, inset from
 * the screen's edges. Back, a tap outside or a drag down closes it.
 */
export function sheet(title, rows, {subtitle = ''} = {}) {
  const grab = h('div', {class: 'sheet-grab'}, h('div', {class: 'sheet-handle'}), h('h3', {}, title), subtitle ? h('p', {class: 'sheet-sub'}, subtitle) : null);
  const body = h('div', {class: 'sheet-body', role: 'dialog', 'aria-label': title}, grab,
    h('div', {class: 'sheet-rows'}, ...rows.map(r => h('button', {class: 'sheet-row' + (r.selected ? ' selected' : ''), type: 'button', disabled: r.disabled, 'aria-current': r.selected ? 'true' : null, onclick: () => { if (close()) r.run?.(); }},
      r.icon ? h('span', {class: 'sheet-icon'}, icon(r.icon, {size: 20})) : null, h('span', {class: 'sheet-label'}, r.label, r.detail ? h('small', {}, r.detail) : null), r.selected ? icon('check', {size: 20}) : null))));
  const layer = h('div', {class: 'sheet', onclick: e => { if (e.target === layer) close(); }}, body);
  document.body.append(layer);
  armAfterRelease(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  const pop = pushLayer('sheet', () => close(true));
  // Drag the top of the sheet down to dismiss: it follows the finger (no
  // transition while dragging) and closes past 80 px or on a quick flick.
  let drag = null;
  grab.addEventListener('pointerdown', e => {
    drag = {y: e.clientY, last: e.clientY, t: e.timeStamp, v: 0};
    grab.setPointerCapture(e.pointerId);
    body.style.transition = 'none';
  });
  grab.addEventListener('pointermove', e => {
    if (!drag) return;
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.v = (e.clientY - drag.last) / dt;
    drag.last = e.clientY; drag.t = e.timeStamp;
    body.style.transform = `translateY(${Math.max(0, e.clientY - drag.y)}px)`;
  });
  const release = e => {
    if (!drag) return;
    const dy = (e.type === 'pointercancel' ? drag.last : e.clientY) - drag.y, fling = drag.v > 0.5;
    drag = null;
    body.style.transition = '';
    body.style.transform = '';
    if (dy > 80 || (fling && dy > 16)) close();
  };
  grab.addEventListener('pointerup', release);
  grab.addEventListener('pointercancel', release);
  // True only for the call that closes it, so a second tap on a row runs nothing.
  function close(fromBack = false) {
    if (!layer.isConnected || layer.classList.contains('closing')) return false;
    if (!fromBack) pop();
    layer.classList.add('closing');
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 250);
    return true;
  }
  return close;
}

let dialogs = 0;
/**
 * A centred question with Cancel and one action (Nuvio's dialog), for
 * choices that replace or remove something. `destructive` colours the
 * action and starts focus on Cancel. Back, Escape or a tap outside cancel.
 */
export function confirm(title, {message = '', action = 'OK', destructive = false, run} = {}) {
  const id = `dialog-${++dialogs}`;
  const cancel = h('button', {class: 'dialog-btn', type: 'button', onclick: () => close()}, 'Cancel');
  const ok = h('button', {class: 'dialog-btn ' + (destructive ? 'destructive' : 'primary'), type: 'button', onclick: () => { if (close()) run?.(); }}, action);
  const box = h('div', {class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': id + '-title', 'aria-describedby': message ? id + '-text' : null},
    h('h2', {class: 'dialog-title', id: id + '-title'}, title), message ? h('p', {class: 'dialog-text', id: id + '-text'}, message) : null,
    h('div', {class: 'dialog-buttons'}, cancel, ok));
  const layer = h('div', {class: 'dialog-layer', onclick: e => { if (e.target === layer) close(); }}, box);
  // Focus stays in the dialog (Tab cycles its two buttons) and goes back where it was afterwards.
  const before = document.activeElement;
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus(); }
  });
  document.body.append(layer);
  armAfterRelease(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  (destructive ? cancel : ok).focus({preventScroll: true});
  const pop = pushLayer('dialog', () => close(true));
  function close(fromBack = false) {
    if (!layer.isConnected || layer.classList.contains('closing')) return false; // a second tap runs nothing
    if (!fromBack) pop();
    layer.classList.add('closing');
    layer.classList.remove('open');
    if (before?.isConnected) before.focus?.({preventScroll: true});
    setTimeout(() => layer.remove(), 200);
    return true;
  }
  return close;
}

let toastTimer = 0, pinned = null;
/** A short message at the top centre. With `stay`, it stays (shown again after any other toast)
 * until its action is taken or Later is tapped. */
export function toast(text, {action = null, stay = false} = {}) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div', {class: 'toast', role: 'status', 'aria-live': 'polite'}); document.body.append(el); }
  if (stay) pinned = {text, action};
  const hide = () => { pinned = null; el.classList.remove('show'); };
  const later = stay ? h('button', {type: 'button', onclick: hide}, 'Later') : null;
  if (later) later.style.color = 'var(--muted)';
  el.replaceChildren(...[h('span', {}, text), action ? h('button', {type: 'button', onclick: () => { hide(); action.run(); }}, action.label) : null, later].filter(Boolean));
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (!stay) toastTimer = setTimeout(() => { if (pinned) toast(pinned.text, {action: pinned.action, stay: true}); else el.classList.remove('show'); }, action ? 4000 : 2500);
}

/** The mind's "three for tonight" (`astra/tonight`, astra.shortlist) in `slot` on Home: two or three
 * titles to pick from (a tap opens one) and the filters it chose by, its why behind a tap and
 * Dismiss. It never picks or plays (th/ported/arrangement.js reads it and sends the senses). */
export function mountTonight(app, slot) {
  import('/th/ported/arrangement.js').then(m => m.mount('astra', 'tonight', a => {
    const titles = (a.payload.titles || []).map(t => ({...t, at: /^astra:([^:]+):(.+)$/.exec(t.ref)})).filter(t => t.at);
    const filters = (a.payload.filters || []).join(' · ');
    if (!titles.length && !filters) return null;
    return {label: 'Three for tonight', title: titles.length ? 'Pick one' : filters, detail: titles.length ? filters : '',
      extra: titles.map(t => m.choice(a, t.title, () => app.openTitle({type: t.at[1], id: t.at[2], name: t.title})))};
  }, card => slot.replaceChildren(card))).catch(() => {});
}
