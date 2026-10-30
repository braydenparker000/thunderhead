// @ts-check
// Remind me (HOME.md §6.2): a small sheet over the ask bar. "What" starts as what is in the bar;
// then In 1 hour, This evening (19:00, gone after 18:30), Tomorrow morning (08:00) or Pick a time.
// The Worker keeps it and delivers it once, at that time, as a line in the conversation and a
// push; a time inside quiet hours moves to their end, and the toast says so. The toast's Undo
// takes it back. Words used from the bar leave the bar.
import { REMINDER_LIMITS } from '../contract.js';
import { api, signedIn } from '../client.js';
import { uuidv7 } from '../chat/model.js';
import { toast } from '../ui.js';
import { choices, when } from './times.js';

const MIN = 60_000;
const two = (/** @type {number} */ n) => String(n).padStart(2, '0');
const hm = (/** @type {Date} */ d) => `${two(d.getHours())}:${two(d.getMinutes())}`;

/** @param {number} t a `datetime-local` value's time */
const localValue = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${hm(d)}`;
};

export function openRemind() {
  document.querySelector('.remind')?.remove();
  const q = /** @type {HTMLTextAreaElement} */ (document.querySelector('#q'));
  const ask = /** @type {HTMLElement} */ (document.querySelector('#ask'));
  const fromBar = q.value.trim().slice(0, REMINDER_LIMITS.text);
  const sheet = document.createElement('div');
  sheet.className = 'remind';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Remind me');
  sheet.innerHTML = `<div class="rhead"><span>Remind me</span><button type="button" class="rclose" aria-label="Close"><svg class="i" aria-hidden="true"><use href="/ui/icons.svg#x"/></svg></button></div>
<label class="rwhat">What<input type="text" maxlength="${REMINDER_LIMITS.text}" enterkeyhint="done" autocomplete="off"></label>
<div class="rwhen"></div>
<div class="rpick" hidden><input type="datetime-local" aria-label="Day and time"><button type="button" class="rset">Set</button></div>`;
  const what = /** @type {HTMLInputElement} */ (sheet.querySelector('.rwhat input'));
  what.value = fromBar;
  const row = /** @type {HTMLElement} */ (sheet.querySelector('.rwhen'));
  const pick = /** @type {HTMLElement} */ (sheet.querySelector('.rpick'));
  const dt = /** @type {HTMLInputElement} */ (pick.querySelector('input'));
  const now = Date.now();
  for (const [label, t] of [...choices(now), /** @type {[string, number]} */ (['Pick a time', 0])]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    b.addEventListener('click', () => {
      if (!t) {
        pick.hidden = false;
        dt.min = localValue(Date.now() + MIN);
        dt.value ||= localValue(Math.ceil((Date.now() + 2 * 60 * MIN) / (15 * MIN)) * 15 * MIN);
        dt.focus();
        return;
      }
      save(t);
    });
    row.append(b);
  }
  /** @type {HTMLButtonElement} */ (pick.querySelector('.rset')).addEventListener('click', () => {
    const t = new Date(dt.value).getTime();
    if (!Number.isFinite(t) || t < Date.now()) return toast('Pick a time that is still to come.');
    save(t);
  });
  let saving = false;
  /** @param {number} at */
  async function save(at) {
    const text = what.value.trim();
    if (!text) {
      what.focus();
      return toast('Say what to remind you of.');
    }
    if (saving) return;
    saving = true;
    const id = uuidv7();
    try {
      const { reminder } = await signedIn((tok) => api.remind(tok, id, { text, at }));
      close();
      if (fromBar && text === fromBar && q.value.trim() === fromBar) {
        q.value = '';
        q.dispatchEvent(new Event('input'));
      }
      const shifted = reminder.fire_at !== reminder.at;
      toast(`${shifted ? "That's in quiet hours. " : ''}I'll remind you ${when(reminder.fire_at)}.`, {
        label: 'Undo',
        run: () =>
          signedIn((tok) => api.unremind(tok, id)).then(
            () => toast('Reminder cancelled.'),
            () => toast("Couldn't cancel it. Try again."),
          ),
      });
    } catch {
      saving = false;
      toast("Couldn't set the reminder. Try again.");
    }
  }
  const outside = (/** @type {PointerEvent} */ e) => {
    if (!(/** @type {HTMLElement} */ (e.target).closest('.remind'))) close();
  };
  const onKey = (/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && close();
  function close() {
    sheet.classList.remove('in');
    setTimeout(() => sheet.remove(), 200);
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey);
  }
  /** @type {HTMLButtonElement} */ (sheet.querySelector('.rclose')).addEventListener('click', close);
  ask.before(sheet);
  requestAnimationFrame(() => sheet.classList.add('in'));
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  addEventListener('keydown', onKey);
  (fromBar ? /** @type {HTMLElement} */ (row.firstElementChild) : what).focus();
}
