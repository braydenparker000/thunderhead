// @ts-check
// "How I talk" in Settings › The mind (shared/contract/voice.ts): under the Name row, the voice page
// in a text area with Save (on once it changes), who changed it last, when and why, and "Earlier
// versions": each with its date, by whom and why; opening one shows its text and "Use this
// version". Read from GET /v1/mind/voice; saved with PUT; a version brought back with
// POST /v1/mind/voice/restore. The mind changes it too, and says so in the chat with an Undo.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { icon } from './components.js';

/** @typedef {import('../../../shared/contract/voice.ts').VoiceResponse} VoiceResponse */
/** @typedef {import('../../../shared/contract/voice.ts').VoiceVersionInfo} Info */

const MAX = 4000;
/** "4 Nov, 07:30" in the phone's own zone. @param {number} ms */
const stamp = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** @param {Info['by']} by */
const who = (by) => (by === 'owner' ? 'you' : 'me');

/** The line under the page. @param {Info | null} last */
export function lastLine(last) {
  if (!last) return 'Not changed yet. This is how I started.';
  return `Last changed by ${who(last.by)}, ${stamp(last.at)}${last.why ? `: ${last.why}` : '.'}`;
}

/** The block, placed under the Name row. */
export function voiceBlock() {
  const area = /** @type {HTMLTextAreaElement} */ (el('textarea', { id: 'voice-page', class: 'field marea', rows: '10', 'aria-describedby': 'voice-state' }));
  area.disabled = true;
  const save = /** @type {HTMLButtonElement} */ (el('button', { type: 'submit', class: 'btn', text: 'Save' }));
  save.disabled = true;
  const state = el('p', { id: 'voice-state', class: 'st2', role: 'status', text: 'Reading…' });
  const last = el('p', { class: 'st2', 'data-last': '' });
  const list = el('div', { class: 'mmeters', 'data-versions': '' });
  const caret = icon('caret-right');
  caret.setAttribute('class', 'i row-caret');
  const fold = el('details', { class: 'group mfold', 'data-earlier': '' }, [
    el('summary', { class: 'row', 'data-info': '' }, [icon('arrow-counter-clockwise'), el('span', { class: 'row-copy row-title', text: 'Earlier versions' }), caret]),
    list,
  ]);
  const form = el('form', { class: 'sform', 'data-voice': '' }, [
    el('label', { for: 'voice-page', class: 'st2', text: 'How I talk, in plain words. I read this every time I wake.' }),
    area,
    state,
    save,
    last,
  ]);
  const host = el('div', { class: 'group', id: 'mind-voice' }, [form]);
  /** @type {string} what the Worker has */
  let stored = '';

  const check = () => {
    const n = area.value.length;
    const changed = area.value.replace(/\s+$/, '') !== stored;
    if (n > MAX) state.textContent = `Too long: ${n.toLocaleString('en-GB')} of 4,000 characters.`;
    else if (!area.value.trim()) state.textContent = 'Write at least a line.';
    else state.textContent = changed ? `${n.toLocaleString('en-GB')} of 4,000 characters.` : '';
    save.disabled = !changed || n > MAX || !area.value.trim();
  };

  /** @param {VoiceResponse} r */
  const show = (r) => {
    stored = r.text;
    area.value = r.text;
    area.disabled = false;
    last.textContent = lastLine(r.last);
    check();
    list.replaceChildren(...(r.versions.length ? r.versions.map(versionRow) : [el('p', { class: 'sempty', text: 'No earlier versions yet.' })]));
  };

  /** One earlier version: date, by whom, why; opening it reads its text. @param {Info} v */
  const versionRow = (v) => {
    const body = el('div', { class: 'mdetail' });
    const head = el('button', { type: 'button', class: 'row', 'aria-expanded': 'false', 'data-info': '', 'data-version': v.id }, [
      icon(v.by === 'owner' ? 'user-circle' : 'sparkle'),
      el('span', { class: 'row-copy' }, [
        el('span', { class: 'row-title', text: `${stamp(v.at)}, by ${who(v.by)}` }),
        el('span', { class: 'row-detail', text: v.why ?? 'No reason given.' }),
      ]),
    ]);
    head.addEventListener('click', async () => {
      if (head.getAttribute('aria-expanded') === 'true') {
        head.setAttribute('aria-expanded', 'false');
        body.replaceChildren();
        return;
      }
      head.setAttribute('aria-expanded', 'true');
      body.replaceChildren(el('p', { class: 'st2', text: 'Reading…' }));
      try {
        const full = /** @type {{ text: string }} */ (await signedIn((t) => api.call(`/v1/mind/voice/${encodeURIComponent(v.id)}`, { token: t })));
        const use = el('button', { type: 'button', class: 'btn soft', text: 'Use this version' });
        use.addEventListener('click', () => {
          if (!tooSoon()) restore(v.id, use);
        });
        body.replaceChildren(el('p', { class: 'shelp', 'data-text': '', text: full.text }), use);
      } catch (e) {
        body.replaceChildren(el('p', { class: 'st2', text: lineFor(failure(e)) }));
      }
    });
    return el('div', { class: 'mrow' }, [head, body]);
  };

  /** @param {string} id @param {HTMLButtonElement} button */
  const restore = async (id, button) => {
    button.disabled = true;
    try {
      show(/** @type {VoiceResponse} */ (await signedIn((t) => api.call('/v1/mind/voice/restore', { method: 'POST', token: t, body: { id } }))));
      toast('Using that version again.');
    } catch (e) {
      button.disabled = false;
      toast(lineFor(failure(e)));
    }
  };

  const load = async () => {
    try {
      show(/** @type {VoiceResponse} */ (await signedIn((t) => api.call('/v1/mind/voice', { token: t }))));
    } catch (e) {
      state.textContent = lineFor(failure(e));
    }
  };

  area.addEventListener('input', check);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      show(/** @type {VoiceResponse} */ (await signedIn((t) => api.call('/v1/mind/voice', { method: 'PUT', token: t, body: { text: area.value } }))));
      state.textContent = 'Saved.';
    } catch (err) {
      check();
      state.textContent = lineFor(failure(err));
    }
  });
  load();
  return [host, fold];
}
