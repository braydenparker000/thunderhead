// @ts-check
// The working card (HOME.md §4.13; owner, 2026-11-02: "I wanna see what the Thunderhead is working
// on while busy"): while a reply is on its way, one card docks above the ask bar in the decision
// card's place and style (th/decide/dock.js): a title in the mind's words, the live line it reports
// under it, small chips for what it draws on, and Stop, which ends the work, not the session. A
// decision card waiting comes first: this one sits above it, folded to its title line. When the
// reply comes the card folds up into it. And the first moment (HOME.md §6.3): a 2 px line under the
// ask bar fills as the Worker takes the message just sent, then fades. Every word is set with
// textContent; a chip shows its label and nothing else (the Worker caps it).
import { from } from '../../ui/launch.js';
import { decisions } from '../decide/state.js';
import { dock } from '../decide/dock.js';
import { appFor, deepLink } from '../registry/apps.js';
import { el, toast } from '../ui.js';
import { citeHref, plain } from './model.js';

/** @typedef {import('../../../shared/contract/feed.ts').MindUse} MindUse */
/** @typedef {{ title: string, note: string, using: MindUse[], waking: boolean, stop: 'none' | 'button' | 'stopping' }} Work */
/** @typedef {{ app: string, path: string, label: string }} Open */

/** A chip's glyph by kind (ui/icons.svg); an app's chip shows that app's own.
 * @type {Record<import('../../../shared/contract/feed.ts').MindUseKind, string>} */
const GLYPH = { fact: 'brain', song: 'music-notes-simple', page: 'book-open-text', source: 'newspaper', app: 'caret-right' };

/** A motion token's time in ms (0 under reduced motion). @param {string} name */
const ms = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
/** An https URL's host, the only part of a source the card ever shows. @param {string} url */
function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host : '';
  } catch {
    return '';
  }
}

/** What a tap on a chip does, or null for a chip that only says: a fact opens Settings › Memory at
 * it, a song Music at its path, a page Study there, a source says its host, an app opens.
 * @param {MindUse} u @param {(o: Open) => void} open */
function tapFor(u, open) {
  const id = typeof u.id === 'string' ? u.id : '';
  if (u.kind === 'fact') return id ? () => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'memory', focus: id } })) : null;
  if (u.kind === 'song') return () => open({ app: 'music', path: deepLink('music', id) ? id : '/music/', label: '' });
  if (u.kind === 'page') {
    const path = citeHref(id) ?? (deepLink('study', id) ? id : null);
    return path ? () => open({ app: 'study', path, label: '' }) : null;
  }
  if (u.kind === 'source') {
    const host = hostOf(id);
    return host ? () => toast(host) : null;
  }
  const app = u.kind === 'app' ? appFor(id) : null;
  return app?.built ? () => open({ app: app.id, path: app.path, label: '' }) : null;
}

/** @param {MindUse} u @param {(o: Open) => void} open */
function chip(u, open) {
  const tap = tapFor(u, open);
  const c = el(tap ? 'button' : 'span', { class: 'wkchip' });
  const icon = u.kind === 'app' ? appFor(String(u.id))?.icon ?? GLYPH.app : GLYPH[u.kind];
  c.innerHTML = `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${icon}"/></svg>`;
  c.append(plain(u.label).slice(0, 40));
  if (tap) {
    c.setAttribute('type', 'button');
    c.addEventListener('click', () => {
      const r = c.getBoundingClientRect();
      if (u.kind === 'song' || u.kind === 'page' || u.kind === 'app') from(r.left + r.width / 2, r.top + r.height / 2);
      tap();
    });
  }
  return c;
}

/** @param {{ ask: HTMLElement, onStop: () => void, onOpen: (o: Open) => void }} o */
export function createWorking({ ask, onStop, onOpen }) {
  const slot = dock('working', ask);
  /** @type {{ card: HTMLElement, title: HTMLElement, note: HTMLElement, use: HTMLElement, stop: HTMLButtonElement } | null} */
  let shown = null;
  /** @type {Work | null} */
  let last = null;
  let drawn = '';
  let drawnUse = '';

  function build() {
    const title = el('span', { class: 'wkt', 'aria-live': 'polite' });
    const stop = el('button', { type: 'button', class: 'wkstop', text: 'Stop' });
    stop.addEventListener('click', () => {
      if (stop.getAttribute('aria-disabled') !== 'true') onStop();
    });
    const note = el('div', { class: 'wkn' });
    const use = el('div', { class: 'wkuse' });
    const card = el('div', { class: 'card work', role: 'group', 'aria-label': 'Working on' }, [el('div', { class: 'wkhead' }, [el('span', { class: 'd' }), title, stop]), note, use]);
    slot.append(card);
    drawn = drawnUse = '';
    return { card, title, note, use, stop };
  }

  /** The card is done with: it folds up into the reply above it, and goes. */
  function fold() {
    if (!shown) return;
    const { card } = shown;
    shown = null;
    card.classList.add('fold');
    card.setAttribute('aria-hidden', 'true');
    setTimeout(() => card.remove(), ms('--d-base') + 60);
  }

  /** @param {Work | null} w */
  function render(w) {
    last = w;
    if (!w) return fold();
    shown ??= build();
    const tight = decisions.waiting > 0;
    const key = JSON.stringify([w.title, w.note, w.waking, w.stop, tight]);
    const useKey = JSON.stringify(w.using);
    if (useKey !== drawnUse) {
      drawnUse = useKey;
      shown.use.replaceChildren(...w.using.map((u) => chip(u, onOpen)));
      shown.use.hidden = !w.using.length;
    }
    if (key === drawn) return;
    drawn = key;
    const { card, title, note, stop } = shown;
    title.textContent = w.title;
    note.textContent = w.note;
    note.hidden = !w.note;
    card.classList.toggle('waking', w.waking);
    card.classList.toggle('tight', tight);
    stop.hidden = w.stop === 'none';
    stop.textContent = w.stop === 'stopping' ? 'Stopping…' : 'Stop';
    stop.classList.toggle('stopping', w.stop === 'stopping');
    stop.setAttribute('aria-disabled', String(w.stop === 'stopping'));
  }
  // A decision card that rises or folds changes how much of this one shows.
  document.addEventListener('th:decisions', () => render(last));
  return { render };
}

/** The first moment (HOME.md §6.3): a 2 px line under the ask bar fills toward the end while the
 * message just sent goes, to the end when the Worker has it, then fades; it fades unfilled when the
 * message waits or fails. @param {HTMLElement} ask */
export function createSendLine(ask) {
  const line = el('div', { class: 'sendline', 'aria-hidden': 'true' });
  ask.append(line);
  let id = '';
  return {
    /** @param {string} mid */
    start(mid) {
      id = mid;
      line.className = 'sendline';
      void line.offsetWidth; // from empty, even when the last one is still fading
      line.classList.add('go');
    },
    /** @param {string} mid @param {boolean} ok */
    end(mid, ok) {
      if (mid !== id) return;
      id = '';
      line.classList.add(ok ? 'done' : 'off');
    },
  };
}
