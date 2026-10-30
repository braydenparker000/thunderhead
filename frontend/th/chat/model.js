// @ts-check
// The conversation's logic without the DOM (HOME.md §2, §4, §7), so node tests cover it: merging
// the server's messages with the outbox, what the reply slot shows while a reply is on its way,
// the voice line, the edge light, a local message's meta line, and how a reply's text becomes
// lines and links. Times are ms; `now` is always passed in.

/** @typedef {import('../../../shared/contract/api.ts').Message} Message */
/** @typedef {import('../../../shared/contract/api.ts').MindPresence} MindPresence */
/** @typedef {{ id: string, body: string, created_at: number, state: 'sending' | 'queued' | 'failed' | 'toolong', tries: number, failed_at?: number, reply_to?: string }} Local */
/** @typedef {(Message & { local?: false }) | (Local & { author: 'owner', kind: 'text', local: true })} Shown */

export const THINK_AFTER_MS = 1200;
export const WAKING_AFTER_MS = 8000;
export const WAKING_LONG_AFTER_MS = 60_000;
export const WORKING_MAX_MS = 30 * 60_000;
export const SENDING_AFTER_MS = 2000;
export const RETRY_MS = Object.freeze([2000, 5000, 15000]);
export const MAX_CHARS = 8000;
export const REVEAL_CPS = 160;
export const REVEAL_MAX_MS = 1200;
export const TYPING_IDLE_MS = 90_000;
export const TYPING_EVERY_MS = 60_000;
/** A message that didn't send keeps the edge on error this long, or until it is retried (HOME.md §7). */
export const FAILED_EDGE_MS = 60_000;

/** Server messages in seq order, then outbox messages the server doesn't have yet.
 * @param {Message[]} server @param {Local[]} local @returns {Shown[]} */
export function merge(server, local) {
  const ids = new Set(server.map((m) => m.id));
  /** @type {Shown[]} */
  const out = [...server].sort((a, b) => a.seq - b.seq);
  for (const l of local) if (!ids.has(l.id)) out.push({ ...l, author: 'owner', kind: 'text', local: true });
  return out;
}

const REPLY_KINDS = new Set(['text', 'question', 'card']);

/** The newest owner message no mind reply came after, or null (system lines and progress posts
 * don't answer; a message still in the outbox waits for a reply only while it is sending, so a
 * queued or failed one shows its meta line and nothing else). @param {Shown[]} shown */
export function waitingFor(shown) {
  for (let i = shown.length - 1; i >= 0; i--) {
    const m = shown[i];
    if (m.author === 'mind' && REPLY_KINDS.has(m.kind)) return null;
    if (m.author !== 'owner' || (m.local && m.state !== 'sending')) continue;
    return !m.local && m.answered_at ? null : m;
  }
  return null;
}

/** Whether the Worker's "isn't waking" line stands in the thread with no reply after it, so the
 * voice line doesn't say the same thing again (HOME.md §4.4). @param {Shown[]} shown */
export function noWakeShown(shown) {
  for (let i = shown.length - 1; i >= 0; i--) {
    const m = shown[i];
    if (m.author === 'mind' && REPLY_KINDS.has(m.kind)) return false;
    if (m.author === 'system' && /** @type {any} */ (m.meta)?.line === 'not_waking') return true;
  }
  return false;
}

/** Whether the mind posted progress after the waiting message. @param {Shown[]} shown @param {Shown} waiting */
export const hasProgress = (shown, waiting) =>
  shown.slice(shown.indexOf(waiting) + 1).some((m) => m.author === 'mind' && m.kind === 'progress');

const LIVE = new Set(['working', 'listening', 'stopping']);

/** What the reply slot shows while a reply is on its way (HOME.md §4.4).
 * @param {{ sentAt: number, now: number, presence: MindPresence | null, progress: boolean }} s
 * @returns {'none' | 'dots' | 'waking' | 'waking_long' | 'unconnected'} */
export function slot({ sentAt, now, presence, progress }) {
  const state = presence?.state;
  if (state === 'unconfigured') return 'unconnected';
  if (state === 'failed' || state === 'limited') return 'none'; // the Worker's system line says it
  const t = now - sentAt;
  if (t < THINK_AFTER_MS && !progress) return 'none';
  if (!progress && !(state && LIVE.has(state))) {
    if (t >= WAKING_LONG_AFTER_MS) return 'waking_long';
    if (t >= WAKING_AFTER_MS) return 'waking';
  }
  return 'dots';
}

/** What a message is about, for the words the slot shows until the mind says what it is doing. */
const TOPICS = /** @type {[RegExp, string][]} */ ([
  [/\b(music|songs?|playlists?|albums?|tracks?|listen|m[uú]sica|canci[oó]n)/i, 'Thinking about your music…'],
  [/\b(guitar|chords?|riffs?|tabs?|scales?|practi[cs]e|guitarra)/i, 'Thinking about guitar…'],
  [/\b(podcasts?|episodes?)/i, 'Thinking about podcasts…'],
  [/\b(watch|movies?|films?|shows?|anime|series|pel[ií]culas?)/i, 'Thinking about what to watch…'],
  [/\b(study|books?|chapters?|verses?|scriptures?|read|estudi|libros?)/i, 'Thinking about your books…'],
  [/\b(weather|rain|snow|temperature|forecast|clima|lluvia)/i, 'Thinking about the weather…'],
  [/\b(today|tomorrow|tonight|schedule|plan|agenda|remind|week|hoy|ma[nñ]ana)/i, 'Thinking about your day…'],
  [/\b(remember|forgot|last time|did i|recuerdas)/i, 'Thinking back…'],
]);
export const WORD_MS = 3000;

/** The reply slot's words while the mind works (HOME.md §4.4): its own note (`th status working
 * --note`), else words from the message, then two more, 3 s each. @param {{ body: string, sentAt: number, now: number, presence: MindPresence | null }} s */
export function thinking({ body, sentAt, now, presence }) {
  const note = presence?.state === 'working' ? (presence.note ?? '').trim() : '';
  if (note) return /[….!?]$/.test(note) ? note : `${note}…`;
  const lines = [TOPICS.find(([re]) => re.test(body))?.[1] ?? 'Thinking…', 'Working it out…', 'Putting it together…'];
  return lines[Math.min(lines.length - 1, Math.floor(Math.max(0, now - sentAt - THINK_AFTER_MS) / WORD_MS))];
}

const COUNT = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
/** "One thing needs you." … "Nine things need you.", then "Many things need you." @param {number} n */
export const needsYou = (n) => (n === 1 ? 'One thing needs you.' : n <= 9 ? `${COUNT[n]} things need you.` : 'Many things need you.');

/** The two voice lines (HOME.md §2.1 rows 2–8, 10 and 11). Row 3 gives way to the Worker's system line
 * when that is in the thread (`noWake`). `decisions`: the cards that may show now (rows 4–6);
 * `answered`: the last one was just answered, with a yes or otherwise (row 8, for the session);
 * `quiet`: the owner's "go quiet" line (BEHAVIOR.md §8.2), which holds the rest.
 * @param {{ presence: MindPresence | null, firstRun: boolean, homeLine: string | null, noWake?: boolean, decisions?: number, answered?: 'yes' | 'other' | null, quiet?: string | null }} s
 * @returns {[string, string | null]} */
export function voiceLine({ presence, firstRun, homeLine, noWake = false, decisions = 0, answered = null, quiet = null }) {
  if ((presence?.state === 'failed' || presence?.state === 'limited') && !noWake) return ["I can't wake just now.", "I'll answer when I'm back."];
  if (quiet) return [quiet, "I'll hold everything until then."];
  if (firstRun) return ["I'm here.", 'Ask me anything, any time.'];
  if (decisions > 0) return [needsYou(decisions), homeLine ?? 'The rest is handled.'];
  if (answered) return ['Nothing needs you now.', answered === 'yes' ? 'Everything is handled.' : homeLine];
  return ['Nothing needs you.', homeLine];
}

/** The edge light's state (HOME.md §7): thinking > error > offline > calm; listening is home.js's.
 * `failedAt` is when the newest message that didn't send failed (0 for none).
 * @param {{ presence: MindPresence | null, waiting: boolean, typingUntil: number, offline: boolean, now: number, failedAt?: number }} s
 * @returns {'think' | 'error' | 'offline' | 'calm'} */
export function edge({ presence, waiting, typingUntil, offline, now, failedAt = 0 }) {
  const state = presence?.state;
  const working = state === 'working' && now - (presence?.since ?? now) < WORKING_MAX_MS;
  if (state === 'failed' || state === 'limited') return waiting && typingUntil > now ? 'think' : 'error';
  if (working || state === 'waking' || typingUntil > now || (waiting && state !== 'unconfigured')) return 'think';
  if (failedAt && now - failedAt < FAILED_EDGE_MS) return 'error';
  if (offline) return 'offline';
  return 'calm';
}

/** The meta line under an owner bubble that isn't simply sent (HOME.md §4.2), or null.
 * @param {Shown} m @param {number} now */
export function meta(m, now) {
  if (!m.local) return null;
  if (m.state === 'toolong') return 'Too long to send';
  if (m.state === 'failed') return "Didn't send";
  if (m.state === 'queued') return "Sends when you're back online";
  return now - m.created_at >= SENDING_AFTER_MS ? 'Sending…' : null;
}

/** How long a reply's reveal takes: 160 characters a second, at most 1.2 s. @param {string} text */
export const revealMs = (text) => Math.min(REVEAL_MAX_MS, Math.round((text.length / REVEAL_CPS) * 1000));

/** Study's address for a cited block. @param {string} ref `book:<id>#p<n>.b<k>` */
export function citeHref(ref) {
  const m = /^book:([0-9a-f-]{36})#p(\d+)\.b(\d+)$/.exec(ref);
  return m ? `/study/?book=${m[1]}&p=${m[2]}&b=${m[3]}` : null;
}

/** A long URL shows as its host plus "…". @param {string} href */
export function label(href) {
  if (href.length <= 40) return href.replace(/^https:\/\//, '');
  try {
    return `${new URL(href).host}…`;
  } catch {
    return `${href.slice(8, 36)}…`;
  }
}

/** Whether a keystroke should tell the Worker the owner is typing (RUNTIME.md §3): the first one
 * after 90 s without typing, then at most once a minute.
 * @param {{ now: number, lastKey: number, lastSent: number }} s */
export const shouldPrewarm = ({ now, lastKey, lastSent }) => now - lastKey >= TYPING_IDLE_MS || now - lastSent >= TYPING_EVERY_MS;

/** UUIDv7 (RFC 9562) for a message the phone writes, so a resend is the same message. */
export function uuidv7(now = Date.now()) {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
