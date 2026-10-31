// @ts-check
// Instant phone commands (docs/process/NEXT-BATCH.md part 5): a few plain orders the phone carries
// out at once, as it does "go quiet" (th/chat/quiet.js), with no mind and no wait: "open guitar",
// "remind me at 5 to call the bank". Anything the grammar doesn't read exactly goes to the mind as
// words, unchanged. Playback orders ("pause", "skip", "play Evening") come with the island, which
// reaches the playing app (part 3).
import { appFor } from '../registry/apps.js';

/** The names the owner calls each app, to the app's id. */
const APP_NAMES = /** @type {Record<string, string>} */ ({
  music: 'music', musica: 'music', guitar: 'guitar', guitarra: 'guitar', podcasts: 'podcasts', podcast: 'podcasts',
  astra: 'astra', 'my media': 'media', media: 'media', videos: 'media', study: 'study', estudio: 'study', photos: 'photos', fotos: 'photos',
});
const WORDS = 'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve'.split('|');
const MIN = 60_000;

/** @param {string} s */
const norm = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.!?¡¿]+$/g, '').replace(/\s+/g, ' ').trim();

/** The next time the clock reads h:m (or, with no am/pm and h ≤ 12, h + 12 if that comes first).
 * @param {number} now @param {number} h @param {number} m @param {string | undefined} half */
function nextTime(now, h, m, half) {
  if (h > 23 || m > 59 || (half && (h < 1 || h > 12))) return null;
  const hours = half ? [half === 'pm' ? (h % 12) + 12 : h % 12] : h <= 12 && h > 0 ? [h, (h + 12) % 24] : [h];
  let best = Infinity;
  for (const hh of hours) {
    const d = new Date(now);
    d.setHours(hh, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    best = Math.min(best, d.getTime());
  }
  return best;
}

/** "at 5", "at 5:30pm", "at 17:30", "in 20 minutes", "in an hour", "tomorrow at 8", "tomorrow",
 * "tonight": when, or null. @param {string} w @param {number} now */
export function whenOf(w, now) {
  let m = /^(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/.exec(w);
  if (m && (w.startsWith('at ') || m[2] || m[3])) return nextTime(now, +m[1], +(m[2] ?? 0), m[3]);
  m = /^in (\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half an) ?(minutes?|mins?|hours?|hrs?|h)$/.exec(w);
  if (m) {
    const n = m[1] === 'half an' ? 0.5 : /^an?$/.test(m[1]) ? 1 : WORDS.includes(m[1]) ? WORDS.indexOf(m[1]) : +m[1];
    const ms = n * (m[2].startsWith('h') ? 60 * MIN : MIN);
    return n > 0 && ms <= 7 * 24 * 60 * MIN ? now + ms : null;
  }
  m = /^(tomorrow|tonight)(?: at (\d{1,2})(?::(\d{2}))? ?(am|pm)?)?$/.exec(w);
  if (m) {
    const d = new Date(now);
    if (m[1] === 'tomorrow') d.setDate(d.getDate() + 1);
    let h = m[2] ? +m[2] : m[1] === 'tomorrow' ? 8 : 20;
    if (m[4] === 'pm' && h < 12) h += 12;
    if (m[4] === 'am' && h === 12) h = 0;
    if (m[1] === 'tonight' && m[2] && !m[4] && h < 12) h += 12;
    if (h > 23 || +(m[3] ?? 0) > 59) return null;
    d.setHours(h, +(m[3] ?? 0), 0, 0);
    return d.getTime() > now ? d.getTime() : null;
  }
  return null;
}

/** @typedef {{ kind: 'open', app: string } | { kind: 'remind', at: number, text: string }} Command */

/** The order in `text`, if the phone reads it exactly; else null (the words go to the mind).
 * @param {string} text @param {number} [now] @returns {Command | null} */
export function commandOf(text, now = Date.now()) {
  const t = norm(text);
  let m = /^(?:open|launch|go to|abre|abrir|ir a)(?: the)? (.+?)(?: app)?$/.exec(t);
  if (m && APP_NAMES[m[1]]) return { kind: 'open', app: APP_NAMES[m[1]] };
  // "remind me <when> to <what>" or "remind me to <what> <when>"; the words keep their own case.
  const raw = text.trim().replace(/[.!]+$/, '');
  m = /^remind me (.+?) to (.+)$/i.exec(raw);
  if (m) {
    const at = whenOf(norm(m[1]), now);
    if (at && m[2].trim()) return { kind: 'remind', at, text: m[2].trim() };
  }
  m = /^remind me to (.+) ((?:at|in|tomorrow|tonight)\b.*)$/i.exec(raw);
  if (m) {
    const at = whenOf(norm(m[2]), now);
    if (at && m[1].trim()) return { kind: 'remind', at, text: m[1].trim() };
  }
  return null;
}

/** "17:30", "tomorrow 08:00", "Monday 09:00". @param {number} at @param {number} [now] */
export function whenWords(at, now = Date.now()) {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (/** @type {number} */ x) => new Date(x).toDateString();
  if (day(at) === day(now)) return hm;
  if (day(at) === day(now + 86_400_000)) return `tomorrow ${hm}`;
  return `${d.toLocaleDateString('en', { weekday: 'long' })} ${hm}`;
}

/** What it will do, shown under the bar before it goes. @param {Command} c */
export function preview(c) {
  if (c.kind === 'open') return `Opens ${appFor(c.app)?.name ?? c.app}.`;
  return `A reminder at ${whenWords(c.at)}: ${c.text}`;
}

/** Carries it out (what it needs loads here, so the grammar above runs in a test without a page).
 * @param {Command} c @param {() => string} newId */
export async function run(c, newId) {
  const { toast } = await import('../ui.js');
  if (c.kind === 'open') {
    const { from: launchFrom, launch } = await import('../../ui/launch.js');
    const app = appFor(c.app);
    if (!app?.built) return toast(`${app?.name ?? 'That app'} comes later.`);
    launchFrom(innerWidth / 2, innerHeight - 60);
    await launch(app.color);
    location.assign(app.path);
    return;
  }
  const { api, signedIn } = await import('../client.js');
  const id = newId();
  try {
    const { reminder } = await signedIn((tok) => api.remind(tok, id, { text: c.text, at: c.at }));
    const shifted = reminder.fire_at !== reminder.at;
    toast(`${shifted ? "That's in quiet hours. " : ''}I'll remind you at ${whenWords(reminder.fire_at)}.`, {
      label: 'Undo',
      run: () => signedIn((tok) => api.unremind(tok, id)).then(() => toast('Reminder cancelled.'), () => toast("Couldn't cancel it. Try again.")),
    });
  } catch {
    toast("Couldn't set the reminder. Try again.");
  }
}
