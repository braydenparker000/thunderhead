// Sign-in for the shell. With no API address configured, it does nothing and Home stays as in P0.
// Otherwise: no session → /signin/?next=<this path>; a session → the menu's Devices, Agents and
// Account rows open their pages, /settings/<page>/ opens one directly, security notices show on
// Home as cards with the gold bottom edge until answered (SIGN-IN.md §3.3, §11.4), and so do
// decision cards (th/decide/card.js, HOME.md §3). Always: the service worker (th/update.js) and the
// menu's About row.
import { api, configured, flushPendingSignout, signedIn, toSignin } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { noticeCard } from '/th/format.js';
import { onSignedOut, store } from '/th/session.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { updateLine } from '/th/update-rules.js';
import { checkForUpdate, startUpdates, waiting } from '/th/update.js';
import { CONFIG } from '/config.js';

const ROUTES = { '/settings/password/': 'account', '/settings/agents/': 'agents', '/settings/devices/': 'devices', '/settings/memory/': 'memory' };

// The service worker and "Check for update" work with or without sign-in.
startUpdates();
aboutRow();

// A framed copy does nothing at all (frame guard, SECURITY.md §4.3).
if (configured && window.top === window.self) {
  if (!(await store.read())) toSignin();
  else start();
}

async function start() {
  const root = document.documentElement;
  root.dataset.signedIn = '';
  onSignedOut(() => location.replace('/signin/'));
  flushPendingSignout();
  for (const row of document.querySelectorAll('[data-open] small')) row.remove();
  const open = async (name, opts) => (await import('/apps/settings/settings.js')).openPage(name, opts);
  // Capture phase: the rows' "comes with sign-in" toasts (home.js) never run once signed in.
  document.addEventListener('click', (e) => {
    const row = e.target.closest?.('[data-open]');
    if (!row) return;
    e.stopImmediatePropagation();
    open(row.dataset.open);
  }, true);
  const path = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
  if (ROUTES[path]) open(ROUTES[path], { role: new URLSearchParams(location.search).get('new') ?? undefined, fromRoute: true });
  // A Forget that never reached the Worker (the Memory page closed first) goes now; that page
  // sends its own when it is the one opening.
  try {
    if (localStorage.getItem('th.p.forget') && ROUTES[path] !== 'memory')
      import('/apps/settings/memory-queue.js').then((m) => m.flush()).catch(() => {});
  } catch {}
  // The conversation loads after the first paint, so the shell stays small (PERFORMANCE.md §2). If
  // it can't, the ask bar says so (home.js) rather than doing nothing.
  requestAnimationFrame(() => setTimeout(() => import('/th/chat/index.js').then((m) => m.startChat()).catch(() => { root.dataset.chat = 'failed'; }), 0));
  // The Briefing page (BRIEFING.md) too: from this phone at once, then from the Worker.
  requestAnimationFrame(() => setTimeout(() => import('/th/briefing/page.js').then((m) => m.startBriefing()).catch(() => {}), 0));
  // Decision cards (HOME.md §3) load after the first paint too.
  requestAnimationFrame(() => setTimeout(() => import('/th/decide/card.js').then((m) => m.startDecisions()).catch(() => {}), 0));
  menuCode();
  // Push (SECURITY.md §10): when it is on, the subscription follows a replaced key and a new sign-in.
  if ('Notification' in window && Notification.permission === 'granted')
    requestAnimationFrame(() => setTimeout(() => import('/th/push/phone.js').then((m) => m.recheck()).catch(() => {}), 0));
  try {
    const me = await signedIn((t) => api.me(t));
    notices(me.notices ?? [], open);
  } catch (e) {
    if (failure(e).kind === 'api') toast(lineFor(failure(e)));
  }
}

/** The menu's conversations and search (th/convos) load once the menu starts to open, so the shell
 * stays inside its budget; a tap on "Search everything" waits for them. */
function menuCode() {
  const side = document.querySelector('#side');
  /** @type {Promise<unknown> | null} */
  let menu = null;
  const load = () => (menu ??= import('/th/convos/menu.js').then((m) => m.startMenu()).catch((e) => { menu = null; throw e; }));
  new MutationObserver(() => { if (side.classList.contains('open')) load().catch(() => {}); }).observe(side, { attributes: true, attributeFilter: ['class'] });
  // Capture phase: the pill's "comes with sign-in" toast (home.js) never runs once signed in.
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#search')) return;
    e.stopImmediatePropagation();
    load().then(() => import('/th/convos/search.js')).then((s) => s.enter()).catch(() => toast("Couldn't load search. Reload to try again."));
  }, true);
}

const hidden = (id) => { try { return localStorage.getItem(`th.p.hide.${id}`) === '1'; } catch { return false; } };

function notices(items, open) {
  const turns = document.querySelector('#turns');
  const edge = document.querySelector('#edge');
  const shown = items.filter((n) => !hidden(n.id));
  // Gold while any card needs the owner: a notice here, or a decision card (th/decide/card.js).
  const glow = () => edge?.classList.toggle('gold', document.querySelector('#convo .card.notice:not(.gone), #decision .card:not(.gone)') !== null);
  for (const n of shown) {
    const c = noticeCard(n);
    const buttons = c.buttons.map((b) => {
      const btn = el('button', { type: 'button', class: b.primary ? 'yes' : '', text: b.label });
      btn.addEventListener('click', () => act(n, b.act, card, btn));
      return btn;
    });
    const card = el('div', { class: 'card notice', role: 'group', 'aria-label': 'Security notice' }, [
      el('div', { class: 'why' }, [el('span', { class: 'd' }), 'Security']),
      el('div', { class: 'q', text: c.text }),
      el('div', { class: 'decide' }, buttons),
    ]);
    turns.append(card);
  }
  document.querySelector('#hint')?.classList.toggle('gone', shown.length > 0);
  glow();

  async function act(n, what, card, btn) {
    if (tooSoon()) return;
    const fold = () => { card.classList.add('gone'); setTimeout(() => card.remove(), 600); glow(); };
    if (what === 'hide') {
      try { localStorage.setItem(`th.p.hide.${n.id}`, '1'); } catch {}
      fold();
      return;
    }
    btn.disabled = true;
    try {
      if (what === 'cancel_reset') await signedIn((t) => api.cancelReset(t, n.args.ticket_id));
      else await signedIn((t) => api.ackNotice(t, n.id, what === 'agents' ? 'ok' : what));
      fold();
      if (what === 'agents') open('agents');
      if (what === 'cancel_reset') toast('Reset cancelled');
      if (what === 'not_me') toast(n.kind === 'agent_key_created' ? 'Key revoked' : 'Signed out');
    } catch (e) {
      btn.disabled = false;
      toast(lineFor(failure(e)));
    }
  }
}

/** Menu → About: the running release ("a1b2c3d") and "Check for update" (MENU-AND-SETTINGS.md §4.11). */
function aboutRow() {
  const version = document.querySelector('#version');
  if (version && CONFIG.commit !== 'dev') version.textContent = CONFIG.commit.slice(0, 7);
  document.querySelector('#update')?.addEventListener('click', async () => {
    if (!navigator.serviceWorker) return toast(updateLine('unsupported'));
    toast(updateLine('checking'));
    toast(updateLine((await checkForUpdate()) || waiting() ? 'waiting' : 'current'));
  });
}
