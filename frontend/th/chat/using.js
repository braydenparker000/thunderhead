// @ts-check
// What the mind drew on, as chips (HOME.md §4.13): on the working card while it works, and under the
// reply once it lands, folded into one line, "How I got this", that opens to them (`meta.using`,
// which the Worker copies from the work onto the reply). A chip shows its label and nothing else
// (textContent, capped by the Worker), and a tap opens its place: a fact Settings › Memory at it, a
// song Music, a page Study, a file saves it, a day opens that day's conversation, an app opens it;
// a source says its host; a search only says what was looked for.
import { from } from '../../ui/launch.js';
import { appFor, deepLink } from '../registry/apps.js';
import { el, toast } from '../ui.js';
import { citeHref, plain } from './model.js';

/** @typedef {import('../../../shared/contract/feed.ts').MindUse} MindUse */
/** @typedef {{ app: string, path: string, label: string }} Open */

/** A chip's glyph by kind (ui/icons.svg); an app's chip shows that app's own.
 * @type {Record<import('../../../shared/contract/feed.ts').MindUseKind, string>} */
const GLYPH = { fact: 'brain', song: 'music-notes-simple', page: 'book-open-text', source: 'newspaper', app: 'caret-right', file: 'file-text', day: 'calendar-blank', search: 'magnifying-glass' };
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An https URL's host, the only part of a source a chip ever shows. @param {string} url */
function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host : '';
  } catch {
    return '';
  }
}

/** That day's conversation: today's is the one on screen; another opens from the menu's list.
 * @param {string} day */
async function openDay(day) {
  const data = await import('../convos/data.js');
  if (data.cachedToday()?.day === day) return void document.querySelector('.convo')?.scrollTo({ top: 1e9, behavior: 'smooth' });
  const find = () => [...data.list.threads.values()].find((t) => t.kind === 'daily' && t.day === day);
  let t = find();
  if (!t) t = await data.refresh().then(find, () => undefined);
  if (t) return (await import('../convos/menu.js')).openThread(t.id);
  toast('That day isn’t in your conversations.');
}

/** What a tap on a chip does, or null for a chip that only says. @param {MindUse} u @param {(o: Open) => void} open */
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
  if (u.kind === 'file') return UUID7.test(id) ? () => void import('../attach/show.js').then((s) => s.save(id, plain(u.label) || 'file')) : null;
  if (u.kind === 'day') return DAY.test(id) ? () => void openDay(id) : null;
  const app = u.kind === 'app' ? appFor(id) : null;
  return app?.built ? () => open({ app: app.id, path: app.path, label: '' }) : null;
}

/** One chip. @param {MindUse} u @param {(o: Open) => void} open */
export function chip(u, open) {
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

/** The chips a message or a presence may show: known kinds with a label, at most six. @param {unknown} list @returns {MindUse[]} */
export function usable(list) {
  return Array.isArray(list) ? list.filter((u) => u && Object.hasOwn(GLYPH, u.kind) && plain(u.label)).slice(0, 6) : [];
}

let folds = 0;
/** "How I got this" under a reply, or null when it drew on nothing: one quiet line that opens (and
 * folds again) to its chips; motion comes from the tokens, so reduced motion snaps it.
 * @param {unknown} list the reply's `meta.using` @param {(o: Open) => void} open */
export function howFold(list, open) {
  const using = usable(list);
  if (!using.length) return null;
  const id = `how-${++folds}`;
  const toggle = el('button', { type: 'button', class: 'howt', 'aria-expanded': 'false', 'aria-controls': id, text: 'How I got this' });
  toggle.insertAdjacentHTML('beforeend', '<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#caret-right"/></svg>');
  const chips = el('div', { class: 'wkuse' }, using.map((u) => chip(u, open)));
  const inner = el('div', { class: 'howin', id }, [chips]);
  inner.inert = true;
  const box = el('div', { class: 'how' }, [toggle, inner]);
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(on));
    box.classList.toggle('open', on);
    inner.inert = !on;
  });
  return box;
}
