// Settings (MENU-AND-SETTINGS.md §4), its own page from the menu's bar (home.js: Appearance, then a
// row for each page, then About), and the pages that need sign-in: Quiet hours (§4.2), Devices
// (SIGN-IN.md §11.1, §7.2), Agents (§17), Account (§9.1), What I remember (MEMORY.md §12),
// Notifications (MENU-AND-SETTINGS.md §4.3) and Export (§4.9). Each opens full screen over the shell
// with a fixed header and scrolling groups: a page opened from
// Settings returns there, Settings and a page opened by its address return to the open menu. Signing out never asks for the password;
// handing out a credential (recovery code, agent key) checks it inline (§15).
import { api, signedIn, signOutHere } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { dMMM, lastActive, place } from '/th/format.js';
import { wipe } from '/th/session.js';
import { el, recoveryScreen, toast, tooSoon } from '/th/ui.js';
import { outbox } from '/th/chat/store.js';
import { confirmSheet, icon, row } from './components.js';

const TITLES = { settings: 'Settings', quiet: 'Quiet hours', devices: 'Devices', agents: 'Agents', account: 'Password', memory: 'What I remember', notifications: 'Notifications', export: 'Export', deleted: 'Recently deleted', appearance: 'Appearance', chat: 'Home and chat', gestures: 'Ring and gestures', island: 'Island', briefing: 'Briefing', mind: 'The mind', privacy: 'Privacy and data', about: 'About and diagnostics' };

/** Signs this device out, asking first while messages are still waiting to send (SIGN-IN.md §11.3)
 * or a Forget hasn't reached the Worker (MEMORY.md §12): signing out wipes the phone, and with it
 * what is still waiting. */
export async function signOutAsking() {
  const forgets = await forgetsLeft();
  const n = (await outbox.list()).length;
  const unsent = n === 1 ? "1 message hasn't sent yet." : `${n} messages haven't sent yet.`;
  const title = n ? `${unsent} Sign out anyway?` : forgets === 1 ? "1 Forget hasn't gone through yet. Sign out anyway?" : `${forgets} Forgets haven't gone through yet. Sign out anyway?`;
  if ((n || forgets) && !(await confirmSheet({ title, body: forgetsBody(forgets, n ? 'either' : ''), action: 'Sign out', keep: 'Cancel' }))) return;
  signOutHere();
}

/** Sends the Forgets still waiting (memory-queue.js) once more, for 4 s at most so signing out
 * never hangs on a slow network; how many are left. */
async function forgetsLeft() {
  let waiting = false;
  try {
    waiting = Boolean(localStorage.getItem('th.p.forget'));
  } catch {}
  if (!waiting) return 0;
  const queue = await import('./memory-queue.js');
  await Promise.race([queue.flush().catch(() => {}), new Promise((r) => setTimeout(r, 4_000))]);
  return queue.pendingIds().length;
}

/** The sheet's line for Forgets that would be lost: after a title that already counts them (''),
 * after one about messages ('either'), or after any other title ('yet').
 * @param {number} forgets @param {'' | 'either' | 'yet'} lead */
function forgetsBody(forgets, lead) {
  if (!forgets) return undefined;
  const count = forgets === 1 ? "1 Forget hasn't" : `${forgets} Forgets haven't`;
  return `${lead ? `${count} gone through ${lead}. ` : ''}If you sign out now, I'll keep remembering ${forgets === 1 ? 'that fact' : 'those facts'}.`;
}
/** The pages open, bottom first: a page opened from Settings stays over it. @type {HTMLElement[]} */
const stack = [];

/** Opens a settings page: over Settings when opened from it (`over`), else in place of what was open.
 * @param {'settings' | 'quiet' | 'devices' | 'agents' | 'account' | 'memory' | 'notifications' | 'export' | 'deleted'} name
 * @param {{ fromRoute?: boolean, role?: string, over?: boolean, focus?: string }} [opts] */
export async function openPage(name, opts = {}) {
  if (!opts.over) for (const p of stack.splice(0)) p.remove();
  const under = stack[stack.length - 1] ?? null;
  /** @type {(() => void) | null} what the page must do as it closes (Memory sends a pending Forget) */
  let cleanup = null;
  const back = el('button', { type: 'button', class: 'sback', 'aria-label': under ? 'Back to Settings' : 'Back to the menu' }, [icon('caret-left')]);
  const title = el('h1', { class: 'page-title', text: TITLES[name], tabindex: '-1' });
  const body = el('div', { class: 'sbody' });
  const header = el('header', { class: 'sheader' }, [back, title]);
  const scroll = el('div', { class: 'sscroll' }, [body]);
  // The frosted panel behind the page, as the menu's (#side > .field): flat while the page moves, blurred at rest (home.css).
  const field = el('div', { class: 'field', 'aria-hidden': 'true' });
  const page = el('section', { class: 'spage', role: 'dialog', 'aria-modal': 'true', 'aria-label': TITLES[name] }, [field, header, scroll]);
  scroll.addEventListener('scroll', () => header.classList.toggle('scrolled', scroll.scrollTop > 0), { passive: true });
  // The page's module is resolved before the page is shown, so its first visible frame already has its
  // content (the shell-look first-frame check); boot preloads these during idle, so this normally costs nothing.
  const MODULES = { settings: './home.js', quiet: './home.js', agents: './agents.js', memory: './memory.js', export: './export.js', notifications: './notifications.js', deleted: './deleted.js', account: './account.js', appearance: './appearance.js', chat: './chat.js', gestures: './gestures.js', island: './island.js', briefing: './briefing.js', mind: './mind.js', privacy: './privacy.js', about: './about.js' };
  /** @type {any} */
  const mod = name in MODULES ? await import(MODULES[/** @type {keyof typeof MODULES} */ (name)]) : null;
  document.querySelector('#app').append(page);
  stack.push(page);
  requestAnimationFrame(() => page.classList.add('in'));
  const close = () => {
    cleanup?.();
    cleanup = null;
    page.classList.remove('in');
    Promise.all(page.getAnimations().map((animation) => animation.finished.catch(() => {}))).then(() => page.remove());
    const i = stack.indexOf(page);
    if (i >= 0) stack.splice(i, 1);
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    const below = stack[stack.length - 1];
    if (below) /** @type {HTMLElement | null} */ (below.querySelector('h1'))?.focus({ preventScroll: true });
    else document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' }));
  };
  back.addEventListener('click', close);
  page.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // The page's title takes focus (a screen reader names the page), never a ring on the back button.
  title.focus({ preventScroll: true });
  if (name === 'settings') mod.settingsHome(body, (p) => openPage(/** @type {any} */ (p), { over: true }), opts.focus);
  else if (name === 'quiet') cleanup = await mod.quietPage(body);
  else if (name === 'devices') await devices(body);
  else if (name === 'agents') mod.agents(body, opts);
  else if (name === 'memory') cleanup = await mod.memory(body);
  else if (name === 'export') await mod.exportPage(body);
  else if (name === 'notifications') await mod.notifications(body);
  else if (name === 'deleted') await mod.deletedPage(body);
  else if (mod.page) cleanup = (await mod.page(body)) ?? null; // the catalogue's pages and About (catalog.js)
  else mod.account(body);
}

/** A line under a form or list for a failed request. */
export const errLine = (host, e) => {
  let line = host.querySelector(':scope > .line');
  if (!line) host.append((line = el('p', { class: 'line', role: 'status' })));
  line.textContent = e ? lineFor(failure(e)) : '';
};

/**
 * Asks for the current password inline and runs `fn` with it; shows the error and waits again on
 * a wrong one. Resolves with fn's result, or null when cancelled.
 */
export function withPassword(host, title, buttonLabel, fn) {
  return new Promise((resolve) => {
    const input = el('input', { class: 'field', id: 'current-password', name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
    const go = el('button', { type: 'submit', class: 'btn', text: buttonLabel });
    const cancel = el('button', { type: 'button', class: 'btn soft', text: 'Cancel' });
    const line = el('p', { class: 'line', role: 'status' });
    const form = el('form', { class: 'sform', novalidate: '' }, [
      el('h2', { class: 'group-title', text: title }),
      el('div', { class: 'fld' }, [el('label', { for: 'current-password', text: 'Current password' }), input]),
      go, cancel, line,
    ]);
    host.replaceChildren(form);
    input.focus({ preventScroll: true });
    cancel.addEventListener('click', () => resolve(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      go.disabled = true;
      line.textContent = '';
      try {
        resolve(await signedIn((t) => fn(t, input.value)));
      } catch (err) {
        go.disabled = false;
        line.textContent = lineFor(failure(err));
        input.select();
      }
    });
  });
}

// --- Devices ---------------------------------------------------------------------------------

async function devices(body) {
  const list = el('div', { class: 'group slist', 'aria-busy': 'true' });
  const warn = el('p', { class: 'swarn', hidden: '' });
  const actions = el('div', { class: 'group sactions' });
  const recovery = el('div', { class: 'srec' });
  body.replaceChildren(warn, el('h2', { class: 'group-title', text: 'Signed in' }), list, el('h2', { class: 'group-title', text: 'Access' }), actions, recovery);
  const load = async () => {
    try {
      const [me, sessions] = await signedIn((t) => Promise.all([api.me(t), api.sessions(t)]));
      warn.textContent = "You haven't confirmed your recovery code. Make a new one.";
      warn.hidden = me.recovery_confirmed;
      list.replaceChildren(...sessions.items.sort((a, b) => Number(b.this_device) - Number(a.this_device)).map((s) => deviceRow(s, load)));
      list.removeAttribute('aria-busy');
      errLine(body, null);
    } catch (e) {
      errLine(body, e);
    }
  };
  const btn = (text, cls, fn) => {
    const b = row({ title: text, icon: 'devices', danger: cls === 'danger' });
    b.classList.add('btn');
    b.addEventListener('click', () => { if (!tooSoon()) fn(); });
    actions.append(b);
  };
  btn('Sign out of this device', 'soft', () => signOutAsking());
  btn('Sign out all other devices', 'soft', async () => {
    if (!(await confirmSheet({ title: 'Sign out all other devices?', body: 'They stop working within a minute.', action: 'Sign out' }))) return;
    try { await signedIn((t) => api.signout(t, 'others')); toast('Signed out everywhere else'); load(); } catch (e) { errLine(body, e); }
  });
  btn('Sign out everywhere', 'danger', async () => {
    const forgets = await forgetsLeft();
    if (!(await confirmSheet({ title: 'Sign out everywhere, including this phone?', body: forgetsBody(forgets, 'yet'), action: 'Sign out', keep: 'Cancel' }))) return;
    try { await signedIn((t) => api.signout(t, 'all')); } catch (e) { if (failure(e).kind !== 'api') { errLine(body, e); return; } }
    await wipe();
    location.replace('/signin/');
  });
  const rec = el('button', { type: 'button', class: 'btn soft', text: 'Make a new recovery code' });
  rec.addEventListener('click', async () => {
    const r = await withPassword(recovery, 'Make a new recovery code', 'Make code', (t, pw) => api.newRecoveryCode(t, pw));
    if (!r) { recovery.replaceChildren(rec); return; }
    const showing = recoveryScreen(recovery, r.recovery_code);
    recovery.querySelector('input')?.classList.add('field');
    const last5 = await showing;
    await signedIn((t) => api.confirmRecovery(t, last5)).catch(() => {});
    recovery.replaceChildren(rec);
    toast('New recovery code saved');
    load();
  });
  recovery.append(rec);
  await load();
}

function deviceRow(s, reload) {
  const name = el('button', { type: 'button', class: 'btn quiet inline row-title sname', text: s.label, 'aria-label': `Rename ${s.label}` });
  const row = el('div', { class: 'row srow' }, [
    icon('device-mobile'),
    el('div', { class: 'row-copy stext' }, [
      el('div', { class: 'st1' }, [name, ...(s.this_device ? [el('span', { class: 'badge', text: 'This device' })] : [])]),
      el('div', { class: 'st2', text: place(s) }),
      el('div', { class: 'st2', text: `Signed in ${dMMM(s.signed_in_at)} · ${lastActive(s.last_seen_at)}` }),
    ]),
  ]);
  name.addEventListener('click', () => {
    const input = el('input', { class: 'field sedit', value: s.label, maxlength: '40', 'aria-label': 'Device name' });
    name.replaceWith(input);
    input.focus({ preventScroll: true });
    input.select();
    let done = false;
    const save = async () => {
      if (done) return;
      done = true;
      const label = input.value.trim().slice(0, 40);
      if (label && label !== s.label) {
        try { await signedIn((t) => api.relabel(t, s.id, label)); s.label = label; } catch (e) { toast(lineFor(failure(e))); }
      }
      reload();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { done = true; reload(); } });
    input.addEventListener('blur', save);
  });
  if (!s.this_device) {
    const out = el('button', { type: 'button', class: 'btn quiet inline sbtn', text: 'Sign out' });
    out.addEventListener('click', async () => {
      if (tooSoon() || !(await confirmSheet({ title: `Sign out ${s.label}?`, body: 'It stops working within a minute.', action: 'Sign out' }))) return;
      try { await signedIn((t) => api.revokeSession(t, s.id)); toast('Signed out'); reload(); } catch (e) { toast(lineFor(failure(e))); }
    });
    row.append(out);
  }
  return row;
}
