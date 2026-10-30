// @ts-check
// The weather sheet (BRIEFING.md §2, §7), opened from the weather tile: the next 12 hours (time,
// temperature, rain chance) and tomorrow's high and low, and the place, set or changed by a town's
// name, which the Worker looks up (Open-Meteo) and keeps. Escape, the dim or Close shut it.
import { api, signedIn } from '../client.js';
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import { el } from '../ui.js';

/** @typedef {import('../../../shared/contract/briefing.ts').WeatherTile} WeatherTile */

const hhmm = (/** @type {number} */ ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** @param {WeatherTile} w @param {() => void} changed after a new place is kept */
export function openWeather(w, changed) {
  const before = /** @type {HTMLElement | null} */ (document.activeElement);
  const dim = el('div', { class: 'cdim' });
  const sheet = el('div', { class: 'csheet wsheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': w.place ? `Weather in ${w.place}` : 'Weather' });
  sheet.append(el('h2', { text: w.place ?? 'Set a place for the weather' }));
  if (w.hours.length) {
    const list = el('ol', { class: 'whours', 'aria-label': 'The next 12 hours' });
    for (const h of w.hours) list.append(el('li', {}, [el('span', { text: hhmm(h.at) }), el('span', { text: `${h.temp}°` }), el('span', { class: 'wrain', text: `${h.rain}%` })]));
    sheet.append(list);
  }
  if (w.tomorrow) sheet.append(el('p', { class: 'shelp', text: `Tomorrow: high ${w.tomorrow.high}°, low ${w.tomorrow.low}°` }));

  const input = /** @type {HTMLInputElement} */ (el('input', { id: 'wplace', name: 'place', type: 'text', autocomplete: 'address-level2', maxlength: '80' }));
  const save = el('button', { type: 'submit', class: 'btn', text: w.place ? 'Change place' : 'Save' });
  const line = el('p', { class: 'line', role: 'status' });
  const form = el('form', { class: 'sform', novalidate: '' }, [el('div', { class: 'fld' }, [el('label', { for: 'wplace', text: 'Your town' }), input]), save, line]);
  const close = el('button', { type: 'button', class: 'btn soft', text: 'Close' });
  sheet.append(form, close);
  document.body.append(dim, sheet);
  requestAnimationFrame(() => {
    dim.classList.add('on');
    sheet.classList.add('on');
  });
  (w.place ? close : input).focus({ preventScroll: true });

  const done = () => {
    document.removeEventListener('keydown', onKey, true);
    dim.remove();
    sheet.remove();
    before?.focus?.({ preventScroll: true });
  };
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') done();
  };
  document.addEventListener('keydown', onKey, true);
  close.addEventListener('click', done);
  dim.addEventListener('click', done);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (name.length < 2) {
      line.textContent = 'Type your town’s name.';
      return;
    }
    save.setAttribute('disabled', '');
    line.textContent = '';
    try {
      await signedIn((t) => api.call('/v1/briefing/place', { method: 'PUT', token: t, body: { name } }));
      done();
      changed();
    } catch (err) {
      save.removeAttribute('disabled');
      line.textContent = /** @type {any} */ (err)?.details?.[0]?.issue ?? lineFor(failure(err));
    }
  });
}
