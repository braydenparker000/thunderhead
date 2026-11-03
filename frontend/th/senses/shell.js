// @ts-check
// The shell's and home's senses (shared/contract/senses.ts), heard from what home already shows and
// says, so home.js and the island are unchanged (boot.js starts this after the first paint, signed in):
// - `ring.choice`: a disc of the ring takes `go` when the owner lets go on it (by finger or by key);
//   the discs are the app registry's, in its order;
// - `app.open`: Music or Podcasts in front inside home: the island's `th:app-ready`, or back out of
//   the island (`data-island` leaves <body>); `app.close`: into the island (`data-island` is set),
//   with how long it was in front;
// - `island.tap`: a tap on the island, to its details, its app or a control;
// - `briefing.open`: the Briefing comes into view (it stops being `inert`);
// - `settings.change`: Settings' `th:setting`, the key only, never the value;
// - `line.seen`: a home line's card on screen (its ledger rows, `data-ledger`, th/chat/view.js),
//   once a line on this phone;
// - `reply.open_chip`: a reply's Open chip tapped (`data-app`).
// A shell event with nothing on home that shows it is not sent: an app other than Music and
// Podcasts closing (it is a page of its own, left by navigating) and a home line dismissed (home
// has no dismissal yet). Ids and times only; th/senses/send.js keeps each app's switch.
import { apps } from '../registry/apps.js';
import { sense } from './send.js';

const SEEN = 'th.p.senses.lines';
const WEEK_MS = 7 * 86_400_000;

/** The lines this phone has reported seen (the newest 100). @returns {string[]} */
function seenLines() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** @param {Document} doc */
export function startShellSenses(doc = document) {
  const ring = doc.querySelector('#ring');
  if (ring)
    new MutationObserver((list) => {
      for (const m of list) {
        const el = /** @type {Element} */ (m.target);
        if (!el.classList.contains('pet') || !el.classList.contains('go') || /(^| )go( |$)/.test(m.oldValue ?? '')) continue;
        const id = apps[[...ring.querySelectorAll('.pet')].indexOf(el)]?.id;
        if (id) void sense('ring.choice', `app:${id}`);
      }
    }).observe(ring, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  /** When each layered app last came to the front. @type {Map<string, number>} */
  const front = new Map();
  const opened = (/** @type {string} */ app) => {
    // The island's ready and leaving it can both say so for one opening.
    if (Date.now() - (front.get(app) ?? 0) < 2000) return;
    front.set(app, Date.now());
    void sense('app.open', `app:${app}`);
  };
  doc.addEventListener('th:app-ready', (e) => {
    const app = /** @type {CustomEvent} */ (e).detail?.app;
    if (typeof app === 'string') opened(app);
  });
  new MutationObserver((list) => {
    for (const m of list) {
      const now = doc.body.dataset.island;
      if (now && now !== m.oldValue) {
        const at = front.get(now);
        front.delete(now);
        void sense('app.close', `app:${now}`, at ? { ms: Math.min(Date.now() - at, WEEK_MS) } : null);
      } else if (!now && m.oldValue) opened(m.oldValue);
    }
  }).observe(doc.body, { attributes: true, attributeFilter: ['data-island'], attributeOldValue: true });

  // Capture: before the island acts on the tap (opening its app takes `data-island` away).
  doc.addEventListener(
    'click',
    (e) => {
      const t = /** @type {Element} */ (e.target);
      const app = doc.body.dataset.island;
      if (!app || !t.closest?.('.th-island')) return;
      const to = t.closest('.compact') ? 'details' : t.closest('.art, .heading') ? 'app' : t.closest('[data-control], .zz') ? 'control' : null;
      if (to) void sense('island.tap', `app:${app}`, { to });
    },
    true,
  );

  const brief = doc.querySelector('#brief');
  if (brief)
    new MutationObserver((list) => {
      if (list.some((m) => m.oldValue !== null) && !brief.hasAttribute('inert')) void sense('briefing.open');
    }).observe(brief, { attributes: true, attributeFilter: ['inert'], attributeOldValue: true });

  doc.addEventListener('th:setting', (e) => {
    const key = /** @type {CustomEvent} */ (e).detail?.key;
    if (typeof key === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(key)) void sense('settings.change', `setting:${key}`);
  });

  doc.addEventListener(
    'click',
    (e) => {
      const app = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest?.('#talk .chip[data-app]'))?.dataset.app;
      if (app) void sense('reply.open_chip', `app:${app}`);
    },
    true,
  );

  // A home line on screen for a moment: each of its lines once on this phone.
  const shown = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        shown.unobserve(en.target);
        const had = seenLines();
        const rows = (/** @type {HTMLElement} */ (en.target).dataset.ledger ?? '').split(' ').filter((r) => r && !had.includes(r));
        if (!rows.length) continue;
        try {
          localStorage.setItem(SEEN, JSON.stringify([...had, ...rows].slice(-100)));
        } catch {}
        for (const r of rows) void sense('line.seen', `ledger:${r}`);
      }
    },
    { threshold: 0.6 },
  );
  const watchLines = () => {
    for (const n of doc.querySelectorAll('#talk .note[data-ledger]:not([data-seen])')) {
      /** @type {HTMLElement} */ (n).dataset.seen = '';
      shown.observe(n);
    }
  };
  const talk = doc.querySelector('#talk');
  if (talk) new MutationObserver(watchLines).observe(talk, { childList: true, subtree: true });
  watchLines();
}
