// @ts-check
// What's new (HOME.md §2): after an update, one calm card by the ask bar says in a few plain lines what
// changed and how to try it, once per release, so the owner never has to read a pull request to enjoy
// it. The lines ship with the site (`/whats-new.json`: an id, the date and at most four lines, each
// with an optional app to open); "Got it" folds the card and remembers the id on this phone. Only a
// phone signed in before the release's date gets it (one signed in since has it all already); nothing
// shows when the lines are older than 14 days (a phone that wasn't opened in between), and nothing
// leaves the phone. Loaded by apps/home/boot.js after the first paint.

const SEEN = 'th.news.seen';
const STALE_MS = 14 * 86_400_000;

/** @typedef {{ text: string, open?: string, label?: string }} Line */
/** @typedef {{ id: string, date: string, lines: Line[] }} News */

/** Whether `n` is a release's news worth a card now. @param {any} n @param {string | null} seen @param {number} now */
export function due(n, seen, now = Date.now()) {
  if (!n || typeof n.id !== 'string' || !n.id || n.id === seen) return false;
  if (!Array.isArray(n.lines) || !n.lines.length) return false;
  const at = Date.parse(n.date);
  return Number.isFinite(at) && now - at < STALE_MS && at - now < 86_400_000;
}

/** Shows this release's card, if it hasn't been seen on this phone. */
export async function startNews() {
  let seen = null;
  try {
    seen = localStorage.getItem(SEEN);
  } catch {}
  /** @type {News | null} */
  let n = null;
  try {
    const r = await fetch('/whats-new.json', { cache: 'no-cache' });
    if (r.ok) n = await r.json();
  } catch {}
  if (!n || !due(n, seen)) return;
  const remember = () => {
    try {
      localStorage.setItem(SEEN, /** @type {News} */ (n).id);
    } catch {}
  };
  // (Only when this phone was signed in before the release: the session's own time says so.)
  const { store } = await import('../session.js');
  const since = (await store.read())?.signed_in_at;
  if (!(typeof since === 'number' && since < Date.parse(n.date))) {
    remember();
    return;
  }
  const { el } = await import('../ui.js');
  const turns = document.querySelector('#turns');
  if (!turns) return;
  // Never while a finger is down: the card would move the conversation under it mid-swipe.
  await untouched();
  const fold = () => {
    remember();
    card.classList.add('gone');
    setTimeout(() => card.remove(), 600);
  };
  const lines = n.lines.slice(0, 4).map((l) => {
    const row = el('li', {}, [String(l.text ?? '').slice(0, 160)]);
    if (typeof l.open === 'string' && /^[a-z]+$/.test(l.open)) {
      const b = el('button', { type: 'button', class: 'try', text: String(l.label ?? 'Try it').slice(0, 24) });
      b.addEventListener('click', () => {
        fold();
        void openApp(/** @type {string} */ (l.open));
      });
      row.append(' ', b);
    }
    return row;
  });
  const got = el('button', { type: 'button', class: 'yes', text: 'Got it' });
  got.addEventListener('click', fold);
  const card = el('div', { class: 'card news', role: 'group', 'aria-label': "What's new" }, [
    el('div', { class: 'why' }, [el('span', { class: 'd' }), 'New in this update']),
    el('ul', { class: 'q' }, lines),
    el('div', { class: 'decide' }, [got]),
  ]);
  turns.append(card);
}

/** Resolves once no finger or button is down (at once if none is). */
function untouched() {
  return new Promise((resolve) => {
    let down = 0;
    const on = () => down++;
    const off = () => {
      down = Math.max(0, down - 1);
      if (!down) setTimeout(done, 300);
    };
    const done = () => {
      if (down) return;
      removeEventListener('pointerdown', on, true);
      removeEventListener('pointerup', off, true);
      removeEventListener('pointercancel', off, true);
      resolve(undefined);
    };
    addEventListener('pointerdown', on, true);
    addEventListener('pointerup', off, true);
    addEventListener('pointercancel', off, true);
    // (A finger already down when this starts is caught by its pointerup.)
    if (!document.querySelector(':active')) setTimeout(done, 0);
  });
}

/** Opens an app by id as the ring does: as a layer where it can be one, else its page. @param {string} id */
async function openApp(id) {
  try {
    const { appFor } = await import('../registry/apps.js');
    const app = appFor(id);
    if (!app?.built) return;
    const { openApp: layer } = await import('../island/island.js');
    if (!(await layer(app.id))) location.assign(app.path);
  } catch {}
}
