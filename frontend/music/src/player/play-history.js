// What was actually heard, newest first: a song is written once it has sounded for 10 seconds
// (HEARD_MS) of one play; a song heard twice is there twice. On this phone only (localStorage
// `cp-play-history`, at most 500 plays), sent nowhere, and nothing older is brought in.
// The 50 % rule for play counts (Player.checkPlayed) is a different thing and stays as it is.
//
// Previous uses it (Player.previous): within the first 5 seconds of a song, back to the song heard
// before it, whatever the shuffle; pressed again, the one before that (`back`).
const STATE_PLAYING = 1; // player.js (not imported: it imports this module)

export const HEARD_MS = 10000;
export const HISTORY_CAP = 500;
const STORE = 'cp-play-history';
// A step of more than this between two ticks (a frozen tab) counts this much at most.
const TICK_MS = 500, MAX_STEP_MS = 2000;

/** The page's localStorage, or null (Node, or storage turned off). */
function storage() {
  try { return typeof window === 'object' ? window.localStorage ?? null : null; } catch { return null; }
}

function load() {
  try {
    const v = JSON.parse(storage()?.getItem(STORE) ?? '[]');
    return Array.isArray(v) ? v.filter(e => typeof e?.id === 'string' && Number.isFinite(e.at)) : [];
  } catch { return []; }
}

export class PlayHistory {
  constructor(player, {now = () => Date.now(), clock = () => performance.now(), persist = true} = {}) {
    this.player = player;
    this.now = now;
    this.clock = clock;
    this.persist = persist && !!storage();
    /** @type {{id: string, at: number}[]} newest first */
    this.items = this.persist ? load() : [];
    // The songs written this session, by id (a song of a list no longer held is still found).
    this.seen = new Map();
    // The play being heard: its load, the time it has sounded, whether it is written.
    this.token = -1;
    this.heardMs = 0;
    this.written = null;
    this.lastClock = 0;
    this.lastPos = 0;
    // Where Previous went back to: the entry and the load it started.
    this.cursor = null;
    this.timer = 0;
    this.listeners = new Set();
    player.ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_track_changed' && !d?.meta) this.sync();
      else if (msg === 'msg_player_playing_state_changed') this.sync();
    });
  }

  /** The play under way follows the player: a new load starts a new play; the clock runs while it plays. */
  sync() {
    const p = this.player;
    if (p.loadToken !== this.token) {
      this.token = p.loadToken;
      this.heardMs = 0;
      this.written = null;
      this.lastPos = 0;
    }
    this.lastClock = this.clock();
    const playing = p.state === STATE_PLAYING && !!p.track;
    if (playing && !this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.timer.unref?.();
    } else if (!playing && this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  /** True while the song can be heard: playing, and its element has sound to give. */
  sounding() {
    const p = this.player;
    if (p.state !== STATE_PLAYING || !p.track) return false;
    if (!p.isMedia(p.track)) return true;
    const el = p.audio;
    return !!el && !el.paused && el.readyState >= 3;
  }

  /** Counts the time since the last tick when the song sounded; at HEARD_MS the play is written. */
  tick() {
    const p = this.player;
    if (p.loadToken !== this.token) this.sync();
    const t = this.clock(), step = Math.min(MAX_STEP_MS, Math.max(0, t - this.lastClock));
    this.lastClock = t;
    if (!this.sounding()) return;
    // Heard through once and started again from its start (Repeat One, a restart): another play.
    const pos = p.positionMs();
    if (this.written && pos < 1000 && this.lastPos > HEARD_MS / 2) { this.heardMs = 0; this.written = null; }
    this.lastPos = pos;
    this.heardMs += step;
    if (!this.written && this.heardMs >= HEARD_MS) this.write(p.track);
  }

  write(track) {
    const e = {id: track.id, at: this.now()};
    this.seen.set(track.id, track);
    this.written = e;
    this.items.unshift(e);
    if (this.items.length > HISTORY_CAP) this.items.length = HISTORY_CAP;
    this.save();
    for (const fn of this.listeners) fn();
  }

  save() {
    if (!this.persist) return;
    try { storage()?.setItem(STORE, JSON.stringify(this.items)); } catch { /* storage unavailable */ }
  }

  /** Calls fn whenever a play is written; returns the function that stops it. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The heard songs as {entry, track}, newest first, those the library still has. */
  entries(trackOf) {
    return this.items.flatMap(entry => { const track = trackOf(entry.id); return track ? [{entry, track}] : []; });
  }

  /**
   * Plays the song heard before the one playing (the one before the last one Previous went back to,
   * when it went back to this one); false when there is none, at the start of the history.
   */
  back(trackOf, play) {
    const p = this.player, cur = p.track;
    let from = 0;
    if (this.cursor && this.cursor.token === p.loadToken) from = this.items.indexOf(this.cursor.entry) + 1;
    for (let k = Math.max(0, from); k < this.items.length; k++) {
      const e = this.items[k];
      // This play itself (written already), and the same song heard just before, are not "before".
      if (e === this.written || e.id === cur?.id) continue;
      const t = trackOf(e.id);
      if (!t || !play(t)) continue;
      this.cursor = {entry: e, token: p.loadToken};
      return true;
    }
    return false;
  }
}

/** "Just now", "2 min ago", "21:14" (today), "Yesterday 21:14", "Mon 21:14", "3 Nov", "3 Nov 2025". */
export function heardWhen(at, now = Date.now()) {
  const d = new Date(at), today = new Date(now);
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(today) - day(d)) / 86400000);
  if (days <= 0) return hm;
  if (days === 1) return `Yesterday ${hm}`;
  if (days < 7) return `${d.toLocaleDateString('en-GB', {weekday: 'short'})} ${hm}`;
  const date = d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
  return d.getFullYear() === today.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}
