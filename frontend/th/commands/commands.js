// @ts-check
// Instant phone commands (docs/process/NEXT-BATCH.md part 5): a few plain orders the phone carries
// out at once, as it does "go quiet" (th/chat/quiet.js), with no mind and no wait: "open guitar",
// "remind me at 5 to call the bank". Anything the grammar doesn't read exactly goes to the mind as
// words, unchanged. Playback orders ("pause", "skip", "previous", "sleep timer 20 minutes", "never
// play this again") act on the app playing in home's layer or island (th/island, part 3). "Stop" alone
// stays words for the mind (it may mean its work); "never play this again" also goes to the mind,
// so it can keep the song out of its mixes.
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

/** @typedef {'pause' | 'play' | 'next' | 'previous' | 'sleep' | 'never'} Control */
/** @typedef {{ kind: 'open', app: string } | { kind: 'remind', at: number, text: string }
 *   | { kind: 'control', cmd: Control, minutes?: number, alsoSay?: boolean }} Command */

const CONTROLS = /** @type {[RegExp, Control][]} */ ([
  [/^(?:pause|pausa|pause (?:the )?(?:music|song|podcast|it)|stop (?:the )?(?:music|song|podcast)|stop playing)$/, 'pause'],
  [/^(?:play|resume|unpause|keep playing|play (?:the )?music|carry on playing)$/, 'play'],
  [/^(?:skip|next|siguiente|salta|skip (?:this|it|this song|the song)|next song|play the next song)$/, 'next'],
  [/^(?:previous|anterior|previous song|last song|go back a song|back a song|play the last song)$/, 'previous'],
  [/^(?:never play (?:this|that|it)(?: song)? again|don'?t play (?:this|that)(?: song)? again|not this song again)$/, 'never'],
]);
/** Minutes in "20 minutes", "an hour", "half an hour". @param {string} n @param {string} unit */
function minutesOf(n, unit) {
  const k = n === 'half an' ? 0.5 : /^an?$/.test(n) ? 1 : WORDS.includes(n) ? WORDS.indexOf(n) : +n;
  const m = Math.round(k * (unit.startsWith('h') ? 60 : 1));
  return m >= 1 && m <= 240 ? m : null;
}

/** The order in `text`, if the phone reads it exactly; else null (the words go to the mind).
 * @param {string} text @param {number} [now] @returns {Command | null} */
export function commandOf(text, now = Date.now()) {
  const t = norm(text);
  for (const [re, cmd] of CONTROLS) if (re.test(t)) return { kind: 'control', cmd, ...(cmd === 'never' ? { alsoSay: true } : {}) };
  // The sleep timer: "play until I fall asleep" (30 minutes), "sleep timer 20 minutes", "stop the music in an hour".
  if (/^(?:play until i fall asleep|sleep timer|set a sleep timer)$/.test(t)) return { kind: 'control', cmd: 'sleep', minutes: 30 };
  let s = /^(?:(?:set a )?sleep timer(?: for)?|sleep in|stop (?:the )?music in|turn (?:the )?music off in|turn off the music in|stop playing in) (\d+|an?|half an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) ?(minutes?|mins?|hours?|hrs?|h)$/.exec(t);
  if (s) {
    const minutes = minutesOf(s[1], s[2]);
    if (minutes) return { kind: 'control', cmd: 'sleep', minutes };
  }
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
  if (c.kind === 'control')
    return {
      pause: 'Pauses what is playing.',
      play: 'Plays again.',
      next: 'Next song (Podcasts: 30 seconds on).',
      previous: 'Previous song (Podcasts: 15 seconds back).',
      sleep: `Stops the music in ${c.minutes ?? 30} minutes.`,
      never: 'Skips it and rates it "not for me"; the mind hears it too.',
    }[c.cmd];
  return `A reminder at ${whenWords(c.at)}: ${c.text}`;
}

/** Carries it out (what it needs loads here, so the grammar above runs in a test without a page).
 * @param {Command} c @param {() => string} newId */
export async function run(c, newId) {
  const { toast } = await import('../ui.js');
  if (c.kind === 'control') {
    const { control } = await import('../island/island.js');
    const r = control(c.cmd, c.minutes);
    toast(r.text, r.undo ? { label: 'Undo', run: r.undo } : undefined);
    return;
  }
  if (c.kind === 'open') {
    const { from: launchFrom, launch } = await import('../../ui/launch.js');
    const app = appFor(c.app);
    if (!app?.built) return toast(`${app?.name ?? 'That app'} comes later.`);
    launchFrom(innerWidth / 2, innerHeight - 60);
    const cover = launch(app.color);
    const { openApp } = await import('../island/island.js');
    if (!(await openApp(app.id, { cover: () => cover }))) {
      await cover;
      location.assign(app.path);
    }
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
