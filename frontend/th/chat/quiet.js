// @ts-check
// "Go quiet" (BEHAVIOR.md §8, Law 9): a fixed grammar caught before anything is sent, so it works
// with no mind and no network. No time means the next 06:30; "for 2 hours", "until 6", "today",
// "until Monday", "until I'm back" (a week) set one; "I'm back" ends it. Anything more goes to the
// mind. The end is kept on this phone at once and given to the Worker as `quiet.until`.
import { api, signedIn } from '../client.js';

const KEY = 'th.p.quiet.until';
/** Set here and not yet taken by the Worker. */
const PENDING = 'th.p.quiet.pending';
/** When the quiet now on (or just ended) began, for the catch-up line once it ends. */
const FROM = 'th.p.quiet.from';
/** The day's catch-up line, kept until the day rolls: { day, at, body }. */
const CATCHUP = 'th.p.quiet.catchup';
const HOUR = 3_600_000;
const WEEK = 168 * HOUR;
const NUMBERS = 'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve'.split('|');
const NUMEROS = 'cero|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce'.split('|');
const DAYS = ['sunday|domingo', 'monday|lunes', 'tuesday|martes', 'wednesday|miercoles', 'thursday|jueves', 'friday|viernes', 'saturday|sabado'];
const ON = /^(?:(?:ok|okay|please|now|not now|vale|por favor)[,\s]+)*(?:go quiet|be quiet|quiet mode|quiet|stop talking|silencio|modo silencio)(?:[,\s]+(?:please|por favor))?(?:[,\s]+(.+))?$/;
const OFF = /^(?:(?:ok|okay|vale)[,\s]+)?(?:i'?m back|i am back|you can talk(?: now| again)?|end quiet|quiet off|ya volvi|ya estoy|puedes hablar)$/;

/** @param {string} s */
const norm = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/[.!?¡¿]+/g, '').replace(/\s+/g, ' ').trim();

/** The next time the local clock reads h:m after `now`. @param {number} now @param {number} h @param {number} m */
function next(now, h, m) {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** @param {string} rest @param {number} now @returns {number | null} */
function untilOf(rest, now) {
  if (/^(?:|today|for today|tonight|until tomorrow|till tomorrow|hoy|hasta manana)$/.test(rest)) return next(now, 6, 30);
  let m = /^(?:for|por) (?:an? |una? )?(\d+|[a-z]+)? ?(hours?|hrs?|h|horas?|minutes?|mins?|minutos?)$/.exec(rest);
  if (m) {
    const n = m[1] === undefined ? 1 : /^\d+$/.test(m[1]) ? Number(m[1]) : Math.max(NUMBERS.indexOf(m[1]), NUMEROS.indexOf(m[1]));
    return n > 0 ? now + Math.min(n * (m[2].startsWith('m') ? 60_000 : HOUR), WEEK) : null;
  }
  m = /^(?:until|till|hasta las?) (\d{1,2})(?::(\d\d))? ?(am|pm)?$/.exec(rest);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h > 23 || min > 59 || (m[3] && (h === 0 || h > 12))) return null;
    if (m[3]) h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
    // "until 6" is whichever 6 comes first.
    return m[3] || h === 0 || h > 12 ? next(now, h, min) : Math.min(next(now, h, min), next(now, (h + 12) % 24, min));
  }
  m = /^(?:until|till|hasta el) ([a-z]+)$/.exec(rest);
  const day = m ? DAYS.findIndex((d) => d.split('|').includes(m[1])) : -1;
  if (day >= 0) {
    const d = new Date(now);
    d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7 || 7));
    d.setHours(6, 30, 0, 0);
    return d.getTime();
  }
  return /^(?:until|till) (?:i'?m back|i am back|i say so)$/.test(rest) ? now + WEEK : null;
}

/** What a message asks of quiet, if it is only that. @param {string} text @returns {{ until: number } | { end: true } | null} */
export function quietOrder(text, now = Date.now()) {
  const t = norm(text);
  if (OFF.test(t)) return { end: true };
  const m = ON.exec(t);
  const until = m ? untilOf(m[1] ?? '', now) : null;
  return until === null ? null : { until };
}

/** "Quiet until 06:30." (over a day away: "Quiet until Monday 06:30."). @param {number} until */
export function quietLine(until, now = Date.now()) {
  const d = new Date(until);
  const day = until - now > 24 * HOUR ? `${d.toLocaleDateString('en', { weekday: 'long' })} ` : '';
  return `Quiet until ${day}${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}.`;
}

/** When quiet ends, or 0 when it is off. */
export function quietUntil(now = Date.now()) {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > now ? v : 0;
  } catch {
    return 0;
  }
}

/** @param {number} until 0 ends quiet */
function keepHere(until) {
  try {
    if (until && !quietUntil()) localStorage.setItem(FROM, String(Date.now()));
    if (until) localStorage.setItem(KEY, String(until));
    else localStorage.removeItem(KEY);
  } catch {}
  document.dispatchEvent(new CustomEvent('th:quiet'));
}

/** The owner's order: kept here at once, then given to the Worker. @param {number} until 0 ends it */
export function setQuiet(until) {
  keepHere(until);
  try {
    localStorage.setItem(PENDING, '1');
  } catch {}
  return sendQuiet();
}

/** @type {Promise<void> | null} */
let sending = null;
async function send() {
  try {
    for (let i = 0; i < 3 && localStorage.getItem(PENDING) === '1' && navigator.onLine; i++) {
      const sent = localStorage.getItem(KEY);
      await signedIn((t) => api.call('/v1/settings', { method: 'PATCH', token: t, body: { 'quiet.until': quietUntil() } }));
      if (localStorage.getItem(KEY) === sent) localStorage.removeItem(PENDING);
    }
  } catch {}
}
/** Gives the Worker this phone's quiet if it hasn't taken it yet (offline: once back), one send at
 * a time, and again if it changed meanwhile. */
export function sendQuiet() {
  sending ??= send().finally(() => {
    sending = null;
  });
  return sending;
}

/** The Worker's quiet (set or ended on another phone), unless this phone's is on its way. @param {unknown} until */
export function fromWorker(until) {
  try {
    if (localStorage.getItem(PENDING) === '1') return;
  } catch {}
  const v = typeof until === 'number' && until > Date.now() ? until : 0;
  if (v !== quietUntil()) keepHere(v);
}

/** A quiet that has ended (its time ran out, "I'm back", End now, or another phone) and has had no
 * catch-up line yet: when it began and ended, or null. */
export function endedQuiet(now = Date.now()) {
  try {
    const from = Number(localStorage.getItem(FROM));
    const until = Number(localStorage.getItem(KEY));
    if (!from || until > now) return null;
    return { from, to: until && until <= now ? until : now };
  } catch {
    return null;
  }
}

/** The catch-up line is written (or there was nothing to say): this quiet is done with. */
export function caughtUp(line = /** @type {{ day: string, at: number, body: string } | null} */ (null)) {
  try {
    localStorage.removeItem(FROM);
    if (line) localStorage.setItem(CATCHUP, JSON.stringify(line));
  } catch {}
}

/** The catch-up line kept for `day`, if any. @param {string | undefined} day */
export function catchUpFor(day) {
  try {
    const l = JSON.parse(localStorage.getItem(CATCHUP) || 'null');
    return l && l.day === day ? /** @type {{ day: string, at: number, body: string }} */ (l) : null;
  } catch {
    return null;
  }
}
