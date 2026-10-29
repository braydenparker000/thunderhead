// @ts-check
// The conversation's logic without the DOM (HOME.md §2, §4, §7), so node tests cover it: merging
// the server's messages with the outbox, what the reply slot shows while a reply is on its way,
// the voice line, the edge light, a local message's meta line, and how a reply's text becomes
// lines and links. Times are ms; `now` is always passed in.

/** @typedef {import('../../../shared/contract/api.ts').Message} Message */
/** @typedef {import('../../../shared/contract/api.ts').MindPresence} MindPresence */
/** @typedef {{ id: string, body: string, created_at: number, state: 'sending' | 'queued' | 'failed' | 'toolong', tries: number }} Local */
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
 * don't answer). @param {Shown[]} shown */
export function waitingFor(shown) {
  for (let i = shown.length - 1; i >= 0; i--) {
    const m = shown[i];
    if (m.author === 'mind' && REPLY_KINDS.has(m.kind)) return null;
    if (m.author === 'owner') return !m.local && m.answered_at ? null : m;
  }
  return null;
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

/** The two voice lines (HOME.md §2.1 rows 2, 3, 7 and 10; decisions arrive with proposals in P4).
 * @param {{ presence: MindPresence | null, firstRun: boolean, homeLine: string | null }} s
 * @returns {[string, string | null]} */
export function voiceLine({ presence, firstRun, homeLine }) {
  if (presence?.state === 'failed' || presence?.state === 'limited') return ["I can't wake just now.", "I'll answer when I'm back."];
  if (firstRun) return ["I'm here.", 'Ask me anything, any time.'];
  return ['Nothing needs you.', homeLine];
}

/** The edge light's state (HOME.md §7): thinking > error > offline > calm; listening is home.js's.
 * @param {{ presence: MindPresence | null, waiting: boolean, typingUntil: number, offline: boolean, now: number }} s
 * @returns {'think' | 'error' | 'offline' | 'calm'} */
export function edge({ presence, waiting, typingUntil, offline, now }) {
  const state = presence?.state;
  const working = state === 'working' && now - (presence?.since ?? now) < WORKING_MAX_MS;
  if (state === 'failed' || state === 'limited') return waiting && typingUntil > now ? 'think' : 'error';
  if (working || state === 'waking' || typingUntil > now || (waiting && state !== 'unconfigured')) return 'think';
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

const LINK = /https:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g;

/** A long URL shows as its host plus "…". @param {string} href */
export function label(href) {
  if (href.length <= 40) return href.replace(/^https:\/\//, '');
  try {
    return `${new URL(href).host}…`;
  } catch {
    return `${href.slice(8, 36)}…`;
  }
}

/** A reply's text as lines: line breaks kept, lines starting "– " as a hanging list, https links.
 * @param {string} text @returns {{ list: boolean, parts: ({ text: string } | { href: string, label: string })[] }[]} */
export function lines(text) {
  return text.split('\n').map((raw) => {
    const list = raw.startsWith('– ');
    const line = list ? raw.slice(2) : raw;
    /** @type {({ text: string } | { href: string, label: string })[]} */
    const parts = [];
    let at = 0;
    for (const m of line.matchAll(LINK)) {
      if (m.index > at) parts.push({ text: line.slice(at, m.index) });
      parts.push({ href: m[0], label: label(m[0]) });
      at = m.index + m[0].length;
    }
    if (at < line.length || !parts.length) parts.push({ text: line.slice(at) });
    return { list, parts };
  });
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
