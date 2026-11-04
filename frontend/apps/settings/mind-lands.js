// @ts-check
// "What lands" at the end of Settings › The mind (BEHAVIOR.md §3.6, MENU-AND-SETTINGS.md §6.6): each
// topic the mind placed in the last 30 days, with what you did with it, counts only: used, taken
// back, left, never seen. A topic you passed over three times in a row rests for 30 days; Reopen
// brings it back now. Read when the fold opens (GET /v1/insight/topics). Never a score for you (law 16).
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { icon } from './components.js';

/** @typedef {import('../../../shared/contract/lands.ts').TopicLands} TopicLands */
/** @typedef {import('../../../shared/contract/lands.ts').TopicsResponse} TopicsResponse */

const PLACES = /** @type {Record<string, string>} */ ({ home: 'home', briefing: 'the Briefing' });
/** `episodes.new` → "Episodes new": a topic's key in words. @param {string} key */
const words = (key) => {
  const w = key.replace(/[._-]+/g, ' ').trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};
/** "4 December". @param {string} day */
const date = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** The counts in words, and where it went. @param {TopicLands} t */
export function countsLine(t) {
  const where = t.places.length ? ` · on ${t.places.map((p) => PLACES[p] ?? p).join(' and ')}` : '';
  return `Used ${t.kept} · took back ${t.undone} · left ${t.ignored} · not seen ${t.unseen}${where}`;
}

/** One topic: its words, its counts, and while it rests, until when and Reopen.
 * @param {TopicLands} t @param {(t: TopicLands) => Promise<void>} reopen */
export function landsRow(t, reopen) {
  const copy = el('div', { class: 'row-copy stext' }, [
    el('div', { class: 'st1' }, [el('span', { class: 'sname static', text: words(t.topic_key) })]),
    el('div', { class: 'st2', text: countsLine(t) }),
  ]);
  const r = el('div', { class: 'row srow', 'data-info': '', 'data-topic': t.topic_key }, [icon(t.reopens ? 'clock' : 'sparkle'), copy]);
  if (t.reopens) {
    copy.append(el('div', { class: 'st2 gold', text: `Resting until ${date(t.reopens)}: you passed it over ${t.streak || 3} times in a row.` }));
    const b = el('button', { type: 'button', class: 'btn quiet inline sbtn', text: 'Reopen', 'aria-label': `Reopen ${words(t.topic_key)}` });
    b.addEventListener('click', () => {
      if (!tooSoon()) reopen(t);
    });
    r.append(b);
  }
  return r;
}

/** The rows, worst first as the Worker sends them, or the line when there are none.
 * @param {TopicsResponse} r @param {(t: TopicLands) => Promise<void>} reopen */
export function landsParts(r, reopen) {
  return [
    el('p', { class: 'shelp', text: 'What I placed in the last 30 days, and what you did with it. When you pass a topic over three times in a row, I stop suggesting it for 30 days.' }),
    ...(r.items.length ? [el('div', { class: 'group' }, r.items.map((t) => landsRow(t, reopen)))] : [el('p', { class: 'sempty', text: 'Nothing placed in the last 30 days.' })]),
    el('p', { class: 'st2', text: 'Counts only, never a score for you.' }),
  ];
}

/** The fold, read the first time it opens and again after a Reopen. */
export function landsFold() {
  const host = el('div', { class: 'mmeters', 'aria-live': 'polite' });
  const caret = icon('caret-right');
  caret.setAttribute('class', 'i row-caret');
  const summary = el('summary', { class: 'row', 'data-info': '' }, [icon('sparkle'), el('span', { class: 'row-copy row-title', text: 'What lands' }), caret]);
  const fold = el('details', { class: 'group mfold', id: 'mind-lands' }, [summary, host]);
  let read = false;
  const load = async () => {
    host.replaceChildren(el('p', { class: 'st2', text: 'Reading…' }));
    try {
      host.replaceChildren(...landsParts(/** @type {TopicsResponse} */ (await signedIn((t) => api.call('/v1/insight/topics', { token: t }))), reopen));
    } catch {
      read = false;
      host.replaceChildren(el('p', { class: 'sempty', text: "I couldn't read this just now. Close and open it to try again." }));
    }
  };
  /** @param {TopicLands} t */
  const reopen = async (t) => {
    try {
      await signedIn((tok) => api.call(`/v1/surfaces/topics/${encodeURIComponent(t.topic_key)}/reopen`, { method: 'POST', token: tok, body: {} }));
      toast(`${words(t.topic_key)} can come back now.`);
      await load();
    } catch (e) {
      // Reopened elsewhere, or its 30 days ran out: say so, and show it as it is now.
      toast(lineFor(failure(e)));
      await load();
    }
  };
  fold.addEventListener('toggle', () => {
    if (!(/** @type {HTMLDetailsElement} */ (fold).open) || read) return;
    read = true;
    load();
  });
  return fold;
}
