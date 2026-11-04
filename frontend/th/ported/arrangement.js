// @ts-check
// An app's arrangement (surfaces.ts ARRANGEMENT_SLOTS; BEHAVIOR.md §3.1, rung 0): the one thing the
// mind placed in this app's slot (Music's "tonight", Guitar's "today's section", Podcasts' "next
// up", Study's "where you left off", Astra's "three for tonight"), read from GET /v1/surfaces and
// drawn by the app as one small card: its action, its why behind a tap (as a reply's chips fold it),
// and Dismiss. Three senses, by the arrangement's ledger row (`ledger:<id>`, the meter's key,
// insight/meter.ts): `arrangement.seen` once a day while it is on screen, `arrangement.tap` on its
// action, `arrangement.dismiss` on Dismiss. A dismissal is the owner's DELETE of the slot, which
// quiets its topic for 14 days (surfaces/ops.ts), so the mind can't place it again; this phone also
// keeps the row's id, so it never comes back here, even offline, until the Worker places a new one.
// Only signed in, in a top-level page or one of home's own frames (th/ported/session.js). The I/O is
// in `deps`, so tests/arrangement-logic.test.mjs drives it without a network.
import { CONFIG } from '../../config.js';
import { framedByOther, sessionToken } from './session.js';

/** @typedef {{ id: string, app: string, slot: string, kind: string, payload: Record<string, any>, why: string, ref: string | null }} Arrangement */
/** @typedef {{ label: string, title: string, detail?: string, action?: string, go?: () => unknown, extra?: HTMLElement[] }} Face */

const SEEN = 'th.p.arrange.seen';
const GONE = 'th.p.arrange.gone';
const KEEP = 40;
const CALL_MS = 15_000;

export const deps = {
  /** @type {typeof fetch} */
  fetch: (...a) => fetch(...a),
  api: () => CONFIG.api,
  token: () => (framedByOther() ? Promise.resolve(null) : sessionToken()),
  /** @type {(type: string, ref: string) => Promise<unknown>} */
  sense: (type, ref) => import('/th/senses/send.js').then((m) => m.sense(type, ref)),
  now: () => Date.now(),
  /** @type {Pick<Storage, 'getItem' | 'setItem'> | null} */
  store: typeof localStorage === 'undefined' ? null : localStorage,
};

/** @param {string} key @returns {any} */
function read(key, empty = {}) {
  try {
    return JSON.parse(deps.store?.getItem(key) || 'null') ?? empty;
  } catch {
    return empty;
  }
}
/** @param {string} key @param {unknown} v */
function write(key, v) {
  try {
    deps.store?.setItem(key, JSON.stringify(v));
  } catch {}
}
/** This phone's day (the seen sense is once a day). */
const day = () => {
  const d = new Date(deps.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** @param {string} method @param {string} path */
async function call(method, path) {
  const base = deps.api();
  const t = base ? await deps.token() : null;
  if (!t) return null;
  try {
    return await deps.fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}` },
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(CALL_MS),
    });
  } catch {
    return null;
  }
}

/** A GET of the Worker's, signed in (the app's own read for the card's action), or null. @param {string} path */
export async function getJson(path) {
  const r = await call('GET', path);
  return r?.ok ? r.json().catch(() => null) : null;
}

/** Whether this phone dismissed the arrangement written by that ledger row. @param {string} id */
export const dismissedHere = (id) => read(GONE, []).includes(id);

/** The app's arrangement in `slot`, or null: none placed, signed out, offline, or one this phone
 * dismissed. @param {string} app @param {string} slot @returns {Promise<Arrangement | null>} */
export async function current(app, slot) {
  const r = await call('GET', '/v1/surfaces');
  if (!r?.ok) return null;
  /** @type {{ items?: any[] }} */
  const body = await r.json().catch(() => ({}));
  const s = (body.items ?? []).find((x) => x?.app === app && x?.slot === slot);
  if (!s?.ledger_id || dismissedHere(s.ledger_id) || (s.expires_at && s.expires_at <= deps.now())) return null;
  return { id: s.ledger_id, app, slot, kind: s.kind, payload: s.payload ?? {}, why: s.why ?? '', ref: s.ref ?? null };
}

/** On screen: `arrangement.seen`, once a day for each arrangement. @param {Arrangement} a */
export async function seen(a) {
  const had = read(SEEN);
  if (had[a.id] === day()) return false;
  const kept = Object.entries({ ...had, [a.id]: day() }).slice(-KEEP);
  write(SEEN, Object.fromEntries(kept));
  await deps.sense('arrangement.seen', `ledger:${a.id}`);
  return true;
}

/** Its action taken (played, opened, started). @param {Arrangement} a */
export const tapped = (a) => deps.sense('arrangement.tap', `ledger:${a.id}`);

/** Dismissed: never shown here again, the sense, and the owner's DELETE (its topic rests 14 days).
 * @param {Arrangement} a */
export async function dismissed(a) {
  write(GONE, [...read(GONE, []).filter((/** @type {string} */ x) => x !== a.id), a.id].slice(-KEEP));
  await deps.sense('arrangement.dismiss', `ledger:${a.id}`);
  await call('DELETE', `/v1/surfaces/${encodeURIComponent(a.app)}/${encodeURIComponent(a.slot)}`);
}

// ----- the card --------------------------------------------------------------------------------

/** @param {string} tag @param {Record<string, string>} attrs @param {(Node | string | null | undefined)[]} kids */
function h(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

let styled = false;
function style() {
  if (styled) return;
  styled = true;
  document.head.append(h('link', { rel: 'stylesheet', href: '/th/ported/arrangement.css' }));
}

/** The card for `a` as the app words it (`face`): its label, title and detail, the action, Why
 * (the fold) and Dismiss. @param {Arrangement} a @param {Face} face @param {() => void} [gone] */
export function card(a, face, gone) {
  style();
  const fold = h('p', { class: 'th-arr-why', id: `th-arr-why-${a.app}`, hidden: '' }, [a.why]);
  const why = h('button', { type: 'button', class: 'th-arr-chip', 'aria-expanded': 'false', 'aria-controls': fold.id }, ['Why']);
  why.addEventListener('click', () => {
    const open = fold.hidden;
    fold.hidden = !open;
    why.setAttribute('aria-expanded', String(open));
  });
  const x = h('button', { type: 'button', class: 'th-arr-chip th-arr-x' }, ['Dismiss']);
  const root = h('section', { class: 'th-arr', 'data-app': a.app, 'data-ledger': a.id, 'aria-label': `${face.label}: ${face.title}` }, [
    h('div', { class: 'th-arr-text' }, [h('small', {}, [face.label]), h('strong', {}, [face.title]), face.detail ? h('span', {}, [face.detail]) : null]),
    ...(face.extra ?? []),
    h('div', { class: 'th-arr-row' }, [
      face.action && face.go ? h('button', { type: 'button', class: 'th-arr-go' }, [face.action]) : null,
      why,
      x,
    ]),
    fold,
  ]);
  root.querySelector('.th-arr-go')?.addEventListener('click', () => {
    void tapped(a);
    face.go?.();
  });
  x.addEventListener('click', () => {
    root.remove();
    void dismissed(a);
    gone?.();
  });
  return root;
}

/** A tap on one of the card's own choices (a title of a shortlist) as its action.
 * @param {Arrangement} a @param {string} text @param {() => unknown} go */
export function choice(a, text, go) {
  const b = h('button', { type: 'button', class: 'th-arr-pick' }, [text]);
  b.addEventListener('click', () => {
    void tapped(a);
    go();
  });
  return b;
}

/** Reports the card seen once most of it has been on screen. @param {Arrangement} a @param {Element} el */
export function watch(a, el) {
  if (typeof IntersectionObserver === 'undefined') return;
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void seen(a);
    },
    { threshold: 0.6 },
  );
  io.observe(el);
}

/** Reads the app's arrangement and, if there is one, puts its card where `place` says (it is given
 * the card) and watches it come on screen. Never throws; the card, or null.
 * @param {string} app @param {string} slot @param {(a: Arrangement) => Face | null} face
 * @param {(card: HTMLElement) => void} place @param {() => void} [gone] */
export async function mount(app, slot, face, place, gone) {
  try {
    const a = await current(app, slot);
    const f = a && face(a);
    if (!a || !f) return null;
    const el = card(a, f, gone);
    place(el);
    watch(a, el);
    return el;
  } catch {
    return null;
  }
}
