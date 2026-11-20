// @ts-check
// Ink and Lamp's header line on home (approved screens R-Grey / R-Dark / R-Off-*): the weekday's name,
// the date and the time over the picture, and the rec switch, which starts and ends a stretch off
// the record through th/record (the same calls as the + sheet's key and the End button), never its
// own copy. Its veils keep the line readable over the picture, and over the conversation once that
// has scrolled up under it. Everything here is added on start and taken away on stop.
import { clock } from '/th/pref.js';

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const HTML = '<div class="lk-veil" aria-hidden="true"></div><div class="lk-veil lk-deep" aria-hidden="true"></div>'
  + '<p class="lk-line"><span class="lk-day"></span><span class="lk-date"></span><time class="lk-time"></time></p>'
  + '<button type="button" class="lk-rec" role="switch" aria-checked="true"><span class="lk-rec-l">rec</span>'
  + '<span class="lk-lamp" aria-hidden="true"></span><span class="lk-track" aria-hidden="true"><span class="lk-thumb lk-thumb--small"></span></span></button>';

export function head() {
  const home = document.getElementById('home');
  const convo = document.getElementById('convo');
  if (!home || !convo) return;
  const box = document.createElement('div');
  box.className = 'lk-head';
  box.innerHTML = HTML;
  home.append(box);
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (box.querySelector(s));
  const day = $('.lk-day'), date = $('.lk-date'), time = /** @type {HTMLTimeElement} */ ($('.lk-time'));
  const rec = /** @type {HTMLButtonElement} */ ($('.lk-rec')), label = $('.lk-rec-l');

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let tick;
  const paint = () => {
    const now = new Date();
    day.textContent = WD[now.getDay()];
    date.textContent = `${now.getDate()} ${MON[now.getMonth()]}`;
    time.textContent = clock(now.getTime());
    time.dateTime = now.toISOString().slice(0, 16);
    clearTimeout(tick);
    tick = setTimeout(paint, 60_000 - (now.getTime() % 60_000) + 20);
  };
  paint();
  const seen = () => { if (!document.hidden) paint(); };
  document.addEventListener('visibilitychange', seen);

  // The switch: on the record is "on" (the thumb right, the lamp lit).
  /** @type {typeof import('/th/record/record.js') | null} */
  let record = null;
  const off = () => { try { return Boolean(localStorage.getItem('th.p.otr')); } catch { return false; } };
  const show = () => {
    const on = !off();
    rec.setAttribute('aria-checked', String(on));
    rec.setAttribute('aria-label', on ? 'On the record' : 'Off the record');
    label.textContent = on ? 'rec' : 'off the\nrecord';
  };
  show();
  document.addEventListener('th:otr', show);
  rec.addEventListener('click', async () => {
    if (rec.getAttribute('aria-busy') === 'true') return;
    if (!document.documentElement.hasAttribute('data-signed-in')) {
      return void import('/th/ui.js').then((u) => u.toast('Off the record comes with sign-in'));
    }
    rec.setAttribute('aria-busy', 'true');
    try {
      record ??= await import('/th/record/record.js');
      if (record.current()) record.end();
      else await record.start();
    } finally {
      rec.removeAttribute('aria-busy');
      show();
    }
  });

  // Scrolled up under the line, the ground runs under it (a class crossing a threshold, no per-frame work).
  const away = () => home.classList.toggle('lk-away', convo.scrollTop > 180);
  convo.addEventListener('scroll', away, { passive: true });
  away();

  return () => {
    clearTimeout(tick);
    document.removeEventListener('visibilitychange', seen);
    document.removeEventListener('th:otr', show);
    convo.removeEventListener('scroll', away);
    home.classList.remove('lk-away');
    box.remove();
  };
}
