// What the shell draws over the app: the long-press lift menu, bottom sheets, confirm dialogs and
// toasts. Every movement goes through ui/motion.js (FEEL.md "Choreography"): it follows the Motion
// setting, can be interrupted, and is timed into the feel log. ui/components.js re-exports these.

import {h} from './dom.js';
import {icon} from './icons.js';
import {pushLayer} from '../app/back-stack.js';
import {enter, exit, fadeTo, rise, press, stop, sheet as sheetMotion, T} from './motion.js';

// Pointers currently down anywhere, so a menu opened by a long press can ignore the release of that
// same press.
const held = new Set();
if (typeof addEventListener === 'function') {
  addEventListener('pointerdown', e => held.add(e.pointerId), true);
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, e => held.delete(e.pointerId), true);
}

/**
 * A menu or sheet opened by a long press takes taps only once the finger that opened it has lifted;
 * otherwise the release would tap whatever item ends up under it.
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

/**
 * The lift (FEEL.md): the poster's copy lifts to the centre on --spring-lively over one fading blur;
 * its menu grows from the corner nearest the card; the items rise in. Release (a tap outside, Back,
 * an item) sends the copy home to its card.
 */
export function liftMenu(source, title, subtitle, actions) {
  const rect = source.getBoundingClientRect();
  const art = source.cloneNode(true);
  art.classList.add('lift-art');
  const items = actions.map(a => press(h('button', {class: 'lift-item' + (a.destructive ? ' destructive' : ''), type: 'button', role: 'menuitem',
    onclick: () => { if (close()) a.run(); }}, // a second quick tap runs nothing
  h('span', {}, a.label), a.icon ? icon(a.icon, {size: 20}) : null)));
  const menu = h('div', {class: 'lift-menu', role: 'menu'}, ...items);
  const text = h('div', {class: 'lift-text'}, h('b', {}, title || ''), subtitle ? h('span', {}, subtitle) : null);
  // Title and menu stack in one column, so the 14 px between them holds whatever the title's length.
  const panel = h('div', {class: 'lift-panel'}, text, menu);
  const blur = h('div', {class: 'lift-blur'});
  const layer = h('div', {class: 'lift', onclick: e => { if (e.target === layer || e.target === panel || e.target === blur) close(); }}, blur, art, panel);
  // Landscape art (Continue Watching, episodes) may take 80% of the width, posters 60%.
  const wide = rect.width > rect.height;
  const targetW = Math.min(innerWidth * (wide ? 0.8 : 0.6), (innerHeight * 0.44) * (rect.width / rect.height));
  const targetH = targetW * (rect.height / rect.width);
  const tx = innerWidth / 2 - targetW / 2, ty = Math.max(24, innerHeight * 0.4 - targetH / 2 - 60);
  // The copy sits at its final size and place; a transform carries it there from the card.
  Object.assign(art.style, {left: tx + 'px', top: ty + 'px', width: targetW + 'px', height: targetH + 'px', transformOrigin: '0 0'});
  const fromCard = `translate(${rect.left - tx}px, ${rect.top - ty}px) scale(${rect.width / targetW}, ${rect.height / targetH})`;
  layer.style.setProperty('--menu-top', (ty + targetH + 18) + 'px');
  // The menu grows from its top corner on the card's side.
  menu.style.transformOrigin = rect.left + rect.width / 2 < innerWidth / 2 ? 'top left' : 'top right';
  document.body.append(layer);
  armAfterRelease(layer);
  fadeTo(blur, 1, {duration: T.normal, name: 'lift:blur'});
  enter(art, {from: fromCard, spring: 'lively', duration: T.lively, fade: false, name: 'lift:open'});
  enter(menu, {from: 'scale(0.62)', spring: 'lively', duration: T.lively, name: 'lift:menu'});
  rise([text, ...items], {name: 'lift:items'});
  const pop = pushLayer('lift', () => close(true));
  function close(fromBack = false) {
    if (!layer.isConnected || layer.classList.contains('closing')) return false;
    if (!fromBack) pop();
    layer.classList.add('closing');
    for (const el of [text, ...items]) stop(el);
    exit(panel, {name: 'lift:menu-out'});
    fadeTo(blur, 0, {duration: T.normal, name: 'lift:blur'});
    exit(art, {to: fromCard, fade: false, duration: T.normal, name: 'lift:close'}).finished.then(() => layer.remove());
    return true;
  }
  menu.querySelector('button')?.focus({preventScroll: true});
  return close;
}

/**
 * A bottom sheet with a title and rows: Nuvio's floating card, inset from the screen's edges. It
 * rises, follows a finger, and Back, a tap outside or a drag down closes it (ui/sheet-motion.js).
 */
export function sheet(title, rows, {subtitle = ''} = {}) {
  const grab = h('div', {class: 'sheet-grab'}, h('div', {class: 'sheet-handle'}), h('h3', {}, title), subtitle ? h('p', {class: 'sheet-sub'}, subtitle) : null);
  const body = h('div', {class: 'sheet-body', role: 'dialog', 'aria-label': title}, grab,
    h('div', {class: 'sheet-rows'}, ...rows.map(r => press(h('button', {class: 'sheet-row' + (r.selected ? ' selected' : ''), type: 'button', disabled: r.disabled, 'aria-current': r.selected ? 'true' : null, onclick: () => { if (close()) r.run?.(); }},
      r.icon ? h('span', {class: 'sheet-icon'}, icon(r.icon, {size: 20})) : null, h('span', {class: 'sheet-label'}, r.label, r.detail ? h('small', {}, r.detail) : null), r.selected ? icon('check', {size: 20}) : null)))));
  const scrim = h('div', {class: 'sheet-scrim'});
  const layer = h('div', {class: 'sheet', onclick: e => { if (e.target === layer || e.target === scrim) close(); }}, scrim, body);
  document.body.append(layer);
  armAfterRelease(layer);
  const pop = pushLayer('sheet', () => close(true));
  // Dragged past its dismiss point it has already left: only the history entry and the layer remain.
  const motion = sheetMotion(body, {scrim, name: 'sheet', onDismiss: () => { if (!layer.classList.contains('closing')) { layer.classList.add('closing'); pop(); } layer.remove(); }});
  // True only for the call that closes it, so a second tap on a row runs nothing.
  function close(fromBack = false) {
    if (!layer.isConnected || layer.classList.contains('closing')) return false;
    if (!fromBack) pop();
    layer.classList.add('closing');
    motion.destroy();
    motion.close().finished.then(() => layer.remove());
    return true;
  }
  return close;
}

let dialogs = 0;
/**
 * A centred question with Cancel and one action (Nuvio's dialog), for choices that replace or remove
 * something. It grows from .96 as it fades in. `destructive` colours the action and starts focus on
 * Cancel. Back, Escape or a tap outside cancel.
 */
export function confirm(title, {message = '', action = 'OK', destructive = false, run} = {}) {
  const id = `dialog-${++dialogs}`;
  const cancel = press(h('button', {class: 'dialog-btn', type: 'button', onclick: () => close()}, 'Cancel'));
  const ok = press(h('button', {class: 'dialog-btn ' + (destructive ? 'destructive' : 'primary'), type: 'button', onclick: () => { if (close()) run?.(); }}, action));
  const box = h('div', {class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': id + '-title', 'aria-describedby': message ? id + '-text' : null},
    h('h2', {class: 'dialog-title', id: id + '-title'}, title), message ? h('p', {class: 'dialog-text', id: id + '-text'}, message) : null,
    h('div', {class: 'dialog-buttons'}, cancel, ok));
  const scrim = h('div', {class: 'dialog-scrim'});
  const layer = h('div', {class: 'dialog-layer', onclick: e => { if (e.target === layer || e.target === scrim) close(); }}, scrim, box);
  // Focus stays in the dialog (Tab cycles its two buttons) and goes back where it was afterwards.
  const before = document.activeElement;
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus(); }
  });
  document.body.append(layer);
  armAfterRelease(layer);
  enter(scrim, {from: 'none', name: 'dialog:scrim'});
  enter(box, {from: 'scale(0.96)', name: 'dialog:open'});
  (destructive ? cancel : ok).focus({preventScroll: true});
  const pop = pushLayer('dialog', () => close(true));
  function close(fromBack = false) {
    if (!layer.isConnected || layer.classList.contains('closing')) return false; // a second tap runs nothing
    if (!fromBack) pop();
    layer.classList.add('closing');
    if (before?.isConnected) before.focus?.({preventScroll: true});
    exit(scrim, {name: 'dialog:scrim'});
    exit(box, {to: 'scale(0.96)', name: 'dialog:close'}).finished.then(() => layer.remove());
    return true;
  }
  return close;
}

let toastTimer = 0, pinned = null, leaving = null;
/**
 * A short message that rises from the nav bar (--spring-lively) and leaves by fading. With `stay`, it
 * stays (shown again after any other toast) until its action is taken or Later is tapped.
 */
export function toast(text, {action = null, stay = false} = {}) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div', {class: 'toast', role: 'status', 'aria-live': 'polite'}); document.body.append(el); }
  if (stay) pinned = {text, action};
  const hide = () => {
    pinned = null;
    const out = leaving = exit(el, {name: 'toast:out'});
    out.finished.then(() => { if (leaving === out) { el.classList.remove('show'); stop(el); } });
  };
  const later = stay ? h('button', {type: 'button', class: 'toast-later', onclick: hide}, 'Later') : null;
  el.replaceChildren(...[h('span', {}, text), action ? h('button', {type: 'button', onclick: () => { hide(); action.run(); }}, action.label) : null, later].filter(Boolean));
  // A toast already up changes its words in place; one coming in rises (its first frame is drawn
  // below the bar, so even the very first toast moves).
  const wasUp = el.classList.contains('show') && !leaving;
  leaving = null;
  el.classList.add('show');
  if (!wasUp) enter(el, {from: 'translate(-50%, 48px) scale(0.92)', to: 'translate(-50%, 0)', spring: 'lively', duration: T.lively, name: 'toast:in'});
  clearTimeout(toastTimer);
  if (!stay) toastTimer = setTimeout(() => { if (pinned) toast(pinned.text, {action: pinned.action, stay: true}); else hide(); }, action ? 4000 : 2500);
}

/** Forgets a toast that stays (its reason is over), so it is not shown again. */
export function unpin() { pinned = null; }
