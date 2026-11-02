// @ts-check
// The conversation's logic without the DOM (HOME.md §2, §4, §7), so node tests cover it: merging
// the server's messages with the outbox, what the reply slot and the working card show while a
// reply is on its way, the status chip, the mind's home lines among the messages, the edge light, a local message's meta line, and how a reply's text becomes
// lines and links. Times are ms; `now` is always passed in.

/** @typedef {import('../../../shared/contract/api.ts').Message} Message */
/** @typedef {import('../../../shared/contract/api.ts').MindPresence} MindPresence */
/** @typedef {{ id: string, body: string, created_at: number, state: 'sending' | 'queued' | 'failed' | 'toolong', tries: number, failed_at?: number, reply_to?: string,
 *   files?: import('../attach/state.js').LocalFile[], thread_id?: string }} Local */
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

/** What a message is about, for the working card's title until the mind says what it is doing. */
const TOPICS = /** @type {[RegExp, string][]} */ ([
  [/\b(music|songs?|playlists?|albums?|tracks?|listen|m[uú]sica|canci[oó]n)/i, 'Thinking about your music'],
  [/\b(guitar|chords?|riffs?|tabs?|scales?|practi[cs]e|guitarra)/i, 'Thinking about guitar'],
  [/\b(podcasts?|episodes?)/i, 'Thinking about podcasts'],
  [/\b(watch|movies?|films?|shows?|anime|series|pel[ií]culas?)/i, 'Thinking about what to watch'],
  [/\b(study|books?|chapters?|verses?|scriptures?|read|estudi|libros?)/i, 'Thinking about your books'],
  [/\b(weather|rain|snow|temperature|forecast|clima|lluvia)/i, 'Thinking about the weather'],
  [/\b(today|tomorrow|tonight|schedule|plan|agenda|remind|week|hoy|ma[nñ]ana)/i, 'Thinking about your day'],
  [/\b(remember|forgot|last time|did i|recuerdas)/i, 'Thinking back'],
]);
/** @param {string} body */
export const topic = (body) => TOPICS.find(([re]) => re.test(body))?.[1] ?? 'Thinking';

/** The working card shows after this long with a live mind (sooner once it gives a title), and
 * after WAKING_CARD_MS with one still waking (HOME.md §4.13). */
export const CARD_AFTER_MS = 1500;
export const WAKING_CARD_MS = 3000;
const USE_KINDS = new Set(['fact', 'song', 'page', 'source', 'app']);
/** A command, a flag or a file path: never on the card (a Bash call's description can become the
 * note, mind/hooks/post-tool.mjs). */
const RAW = /`|(?:^|\s)[~.]{0,2}\/[\w.-]|\b[\w-]+\.(?:m?js|ts|json|md|py|sh|css|html|txt|ya?ml|sql)\b|(?:^|\s)--?[a-z]/i;
/** The mind's words as the card may show them, or ''. @param {unknown} s */
export const plain = (s) => (typeof s === 'string' && s.trim() && !RAW.test(s) ? s.trim() : '');

/** When the run of owner messages that waits began (the first after the mind's last reply): a title
 * the mind gave before it was for something else. @param {Shown[]} shown @param {Shown} waiting */
function runStart(shown, waiting) {
  let at = waiting.created_at;
  for (let i = shown.indexOf(waiting); i >= 0; i--) {
    const m = shown[i];
    if (m.author === 'mind' && REPLY_KINDS.has(m.kind)) break;
    if (m.author === 'owner' && !m.local) at = m.created_at;
  }
  return at;
}

/** The working card (HOME.md §4.13), or null. While a reply is on its way to a message the Worker
 * has: at once once the mind gives a title or chips for it, else 1.5 s after it was sent to a live
 * mind, or 3 s to one still waking ("Waking up", its dot pulsing; a minute on, "This can take a
 * minute."). The title is the mind's, else its note, else words from the message; the note is the
 * live line under a title. What the mind said before this run of messages counts for nothing.
 * @param {{ shown: Shown[], waiting: Shown | null, now: number, presence: MindPresence | null }} s
 * @returns {{ title: string, note: string, using: import('../../../shared/contract/feed.ts').MindUse[], waking: boolean } | null} */
export function work({ shown, waiting, now, presence }) {
  if (!waiting || waiting.local) return null;
  const state = presence?.state;
  if (state === 'unconfigured' || state === 'failed' || state === 'limited') return null;
  const start = runStart(shown, waiting);
  const working = state === 'working';
  const given = working && (presence?.title_at ?? 0) >= start;
  const title = given ? plain(presence?.title) : '';
  const using = given && Array.isArray(presence?.using) ? presence.using.filter((u) => USE_KINDS.has(u?.kind) && plain(u.label)).slice(0, 6) : [];
  const t = now - waiting.created_at;
  const live = !!state && LIVE.has(state);
  if (!title && !using.length && t < (live ? CARD_AFTER_MS : WAKING_CARD_MS)) return null;
  const note = working && (presence?.since ?? 0) >= start ? plain(presence?.note) : '';
  if (!live) return { title: 'Waking up', note: t >= WAKING_LONG_AFTER_MS ? 'This can take a minute.' : '', using: [], waking: true };
  return title ? { title, note, using, waking: false } : { title: note || topic(waiting.body), note: '', using, waking: false };
}

/** The status chip at the top of home, or null while all is well (owner, 2026-10-31: no standing
 * voice line). The owner's own "go quiet" first (it shows at once, even offline), then offline,
 * then a mind that can't wake unless the Worker's line says so in the thread (`noWake`).
 * @param {{ presence: MindPresence | null, noWake?: boolean, quiet?: string | null, offline?: boolean }} s
 * @returns {{ kind: 'offline' | 'wake' | 'quiet', text: string } | null} */
export function status({ presence, noWake = false, quiet = null, offline = false }) {
  if (quiet) return { kind: 'quiet', text: quiet.replace(/\.$/, '') };
  if (offline) return { kind: 'offline', text: 'Offline' };
  if ((presence?.state === 'failed' || presence?.state === 'limited') && !noWake) return { kind: 'wake', text: 'Can’t wake just now' };
  return null;
}

/** The line once quiet ends (BEHAVIOR.md §8.3): what came while it held, or null when nothing did
 * (home says something only when there is something). @param {Shown[]} shown @param {number} from
 * @param {number} to @param {number} cards the decision cards waiting now */
export function catchUp(shown, from, to, cards) {
  const reminders = shown.filter((m) => m.author === 'system' && /** @type {any} */ (m.meta)?.reminder && m.created_at >= from && m.created_at <= to).length;
  const parts = [];
  if (reminders) parts.push(`${reminders} reminder${reminders === 1 ? '' : 's'}`);
  if (cards) parts.push(`${cards} card${cards === 1 ? '' : 's'} waiting`);
  return parts.length ? `While you were quiet: ${parts.join(', ')}.` : null;
}

/** Today's messages with the mind's home lines among them in time order: a line is a card in the
 * chat, where it was placed (HOME.md §2.1), never a standing line at the top.
 * @param {Shown[]} shown @param {{ id: string, lines: { text: string, lang: string | null }[], at: number, night: boolean }[]} cardsIn
 * @returns {Shown[]} */
export function withLines(shown, cardsIn) {
  if (!cardsIn.length) return shown;
  const cards = cardsIn.map((l) => /** @type {Shown} */ (/** @type {any} */ ({
    seq: 0, id: `line:${l.id}`, thread_id: '', author: 'system', origin: 'system', kind: 'card', body: l.lines.map((x) => x.text).join('\n'),
    meta: { line: 'home', night: l.night, lines: l.lines }, attachments: [], reply_to: null, created_at: l.at,
    delivered_at: null, acked_at: null, answered_at: null,
  })));
  cards.sort((a, b) => a.created_at - b.created_at);
  /** @type {Shown[]} */
  const out = [];
  let i = 0;
  for (const m of shown) {
    while (i < cards.length && cards[i].created_at <= m.created_at) out.push(cards[i++]);
    out.push(m);
  }
  return out.concat(cards.slice(i));
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
