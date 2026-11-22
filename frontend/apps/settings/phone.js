// @ts-check
// Settings › Account and data › On this phone (MENU-AND-SETTINGS.md §6.11): what this browser keeps for
// the site. First the browser's own figures (used, what it allows, whether it keeps the site's data when
// space runs low, and a button to ask it to); then a row per app's store with its measured size and
// count, largest first, each shown as soon as it is measured (phone-measure.js works in pieces). A row
// that holds only what downloads again has Clear, asked first (phone-stores.js); nothing that lives only
// here is offered. Everything is read on the phone, so the page works offline.
import { el, toast } from '/th/ui.js';
import { words } from '/th/data/tally.js';
import { confirmSheet, group } from './components.js';
import { infoRow } from './catalog.js';
import { assign, discover, measure } from './phone-measure.js';

/** @typedef {import('./phone-stores.js').Store} Store */

const count = (/** @type {number} */ n, /** @type {[string, string]} */ [one, many]) => `${n} ${n === 1 ? one : many}`;
const OFFLINE = 'You’re offline. Anything you clear comes back only once you have a signal.';
const WHY = 'Without this, the browser may delete offline songs, downloads and books when the phone runs low on space.';

/** @param {HTMLElement} body */
export function page(body) {
  let gone = false;
  const offline = el('p', { class: 'swarn', id: 'phone-offline', text: OFFLINE });
  const used = infoRow('Used by the site', 'Measuring…');
  used.id = 'phone-used';
  const kept = infoRow('Kept when space runs low', 'Measuring…');
  kept.id = 'phone-persist';
  const browser = group('This browser', [used, kept]);
  const list = el('div', { class: 'group', id: 'phone-list' });
  const status = el('p', { class: 'shelp', id: 'phone-status', role: 'status', text: 'Measuring what this phone keeps…' });
  const net = () => { offline.hidden = navigator.onLine !== false; };
  net();
  body.append(
    el('p', { class: 'slead', text: 'What this browser keeps for the site, largest first. Clearing here never removes what is only on this phone: messages not sent yet, edits, places and sign-in.' }),
    offline, browser,
    el('section', { class: 'group-section' }, [el('h2', { class: 'group-title', text: 'By app' }), list]),
    status,
  );
  addEventListener('online', net);
  addEventListener('offline', net);

  /** The browser's figures, and the ask when it does not keep the site's data. */
  const figures = async () => {
    const s = navigator.storage;
    const est = await s?.estimate?.().catch(() => null);
    const value = /** @type {HTMLElement} */ (used.querySelector('.row-detail'));
    used.querySelector('.row-value')?.remove();
    if (est && typeof est.usage === 'number') {
      value.textContent = est.quota ? `Of ${words(est.quota)} this browser allows the site.` : 'This browser gives no limit.';
      used.append(el('span', { class: 'row-value', text: words(est.usage) }));
    } else value.textContent = 'This browser doesn’t say.';
    const on = await s?.persisted?.().catch(() => null);
    const detail = /** @type {HTMLElement} */ (kept.querySelector('.row-detail'));
    kept.querySelector('.row-value')?.remove();
    browser.querySelector('#phone-ask')?.remove();
    browser.querySelector('#phone-why')?.remove();
    if (on == null) { detail.textContent = 'This browser doesn’t say.'; return; }
    detail.textContent = on ? 'The browser won’t delete the site’s data on its own.' : 'The browser may delete it when the phone is low on space.';
    kept.append(el('span', { class: 'row-value', text: on ? 'Yes' : 'No' }));
    if (on || typeof s?.persist !== 'function') return;
    const ask = el('button', { type: 'button', class: 'btn soft', id: 'phone-ask', text: 'Ask to keep it' });
    ask.addEventListener('click', async () => {
      ask.disabled = true;
      const yes = await s.persist().catch(() => false);
      if (gone) return;
      if (!yes) toast('The browser said no. It decides by how much you use the site.');
      await figures();
    });
    browser.append(ask, el('p', { class: 'shelp', id: 'phone-why', text: WHY }));
  };

  /** Draws a measured row in its place, largest first. @param {Store} store @param {{ bytes: number, items: number } | null} m @param {() => Promise<void>} again */
  const show = (store, m, again) => {
    list.querySelector(`[data-store="${store.id}"]`)?.remove();
    const r = infoRow(store.title, m ? `${store.detail} ${count(m.items, store.unit)}.` : 'Couldn’t measure this one.', m ? words(m.bytes) : undefined);
    r.dataset.store = store.id;
    r.dataset.bytes = String(m?.bytes ?? -1);
    if (m && m.items && store.clear) {
      const clear = el('button', { type: 'button', class: 'btn quiet inline', text: 'Clear', 'aria-label': `Clear ${store.title}` });
      clear.addEventListener('click', async () => {
        const lost = /** @type {string} */ (store.lost);
        const ok = await confirmSheet({
          title: `Clear ${store.title}?`,
          body: `This removes the ${lost}, ${words(m.bytes)}, from this phone. They come back by downloading again.`,
          action: 'Clear',
        });
        if (!ok || gone) return;
        clear.disabled = true;
        try {
          await /** @type {() => Promise<void>} */ (store.clear)();
        } catch {
          toast('Couldn’t clear it. Try again.');
        }
        if (!gone) await Promise.all([again(), figures()]);
      });
      r.append(clear);
    }
    const after = [...list.children].find((c) => Number(/** @type {HTMLElement} */ (c).dataset.bytes) < (m?.bytes ?? -1));
    list.insertBefore(r, after ?? null);
  };

  (async () => {
    figures();
    /** @type {ReturnType<typeof assign>} */
    let rows;
    try {
      rows = assign(await discover());
    } catch {
      status.textContent = 'Couldn’t read what this phone keeps.';
      return;
    }
    if (!rows.length) { status.textContent = 'Nothing kept on this phone yet.'; return; }
    let done = 0;
    for (const { store, units } of rows) {
      if (gone) return;
      status.textContent = `Measuring… ${done} of ${rows.length}`;
      const again = async () => {
        const fresh = assign(await discover()).find((x) => x.store.id === store.id);
        if (!fresh) { list.querySelector(`[data-store="${store.id}"]`)?.remove(); return; }
        show(store, await measure(store, fresh.units).catch(() => null), again);
      };
      show(store, await measure(store, units).catch(() => null), again);
      done++;
    }
    if (!gone) status.textContent = 'All measured.';
  })();

  return () => {
    gone = true;
    removeEventListener('online', net);
    removeEventListener('offline', net);
  };
}
