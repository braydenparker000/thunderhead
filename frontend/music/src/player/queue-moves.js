// The player's side of Up next, History and Previous (owner, 2026-11-25), mixed into Player
// (player.js ends with Object.assign(Player.prototype, QueueMoves)):
// - what will follow from the playing list, in its real order (ahead), and its name;
// - the pagers' preview of the song Next or Previous would really play (previewAt);
// - Previous by what was heard (previous, playBack, interject);
// - Next up's own moves: play an entry now, reorder, remove and put back, clear;
// - a song of the list passed over this time round (skipOnce).
// The Queue's entries are the songs the owner queued; outside queue mode the unplayed ones wait and
// play after the playing song (keepQueued), in the order chosen whatever the shuffle.
import {stepOver} from '/th/music/dj.js';

// player.js's constants (not imported: player.js imports this module).
const STATE_STOPPED = 0, STATE_PLAYING = 1, REPEAT_ON = 1, REPEAT_ADVANCE = 2;
// Previous restarts the song after this much of it; before, it goes back to the song heard before.
export const RESTART_MS = 5000;

export const QueueMoves = {
  /** The songs queued and not played yet wait for the playing song to end (they are not dropped). */
  keepQueued() {
    if (this.unplayedCount > 0) this.hasPendingQueue = true;
  },

  /** Next up: the queued songs still to play, in their order (not the one playing). */
  nextUp() {
    const playing = this.queueMode ? this.playingEntry ?? null : null;
    return this.entries.filter(e => !e.played && e !== playing);
  },

  /** A song of the library (or of the lists the player holds) by id. */
  trackById(id) {
    const lib = this.ctx.library?.byId?.get(id);
    if (lib) return lib;
    const same = t => t?.id === id;
    return this.queue.find(same) ?? this.entries.find(e => same(e.track))?.track ?? this.savedNP?.queue?.find(same) ?? this.history?.seen.get(id) ?? null;
  },

  /** The list the player goes on with after the Queue: in queue mode the saved one, else the playing one. */
  listState() {
    const np = this.queueMode ? this.savedNP : null;
    if (np) {
      const list = np.queue ?? [];
      const order = np.order?.length === list.length ? np.order : [...list.keys()];
      return {list, order, at: np.index, again: !!np.again, category: np.category};
    }
    if (!this.queue.length) return {list: [], order: [], at: -1, again: false, category: null};
    this.ensureOrder();
    return {list: this.queue, order: this.order, at: this.index, again: false, category: this.category};
  },

  /**
   * Up to n songs that will follow from the list (not the queued ones), in the order they will play:
   * the list's order, its shuffle or the DJ's plan; [{track, index}] (index: the song's place in
   * the list). Ends at the list's end, or after one round when the list repeats.
   */
  ahead(n = 30) {
    const {list, order, at, again, category} = this.listState();
    const len = list.length;
    if (!len || at < 0) return [];
    const wrap = this.repeat === REPEAT_ON || (this.repeat === REPEAT_ADVANCE && !category);
    const skips = this.skips.get(list);
    const skip = i => list[i]?.rating === 1 || !!skips?.has(i);
    // A list of nothing else plays as it is (th/music/dj.js stepOver).
    const all = !order.some(i => !skip(i));
    const out = [];
    if (again && (all || !skip(at))) out.push({track: list[at], index: at});
    const pos = order.indexOf(at);
    for (let k = 1; k < len && out.length < n; k++) {
      let p = pos + k;
      if (p >= len) {
        if (!wrap) break;
        p %= len;
      }
      const i = order[p];
      if (!all && skip(i)) continue;
      out.push({track: list[i], index: i});
    }
    return out;
  },

  /** The playing list's name: its album, playlist, folder..., else the list it was played from. */
  listName() {
    const c = this.queueMode ? this.savedNP?.category : this.category;
    const own = c?.source?.groups?.[c.index]?.title ?? c?.source?.sectionTitle?.(c.index);
    if (own) return own;
    const qs = this.ctx.listWidget?.queueStack, top = qs?.[qs.length - 1], t = this.listState().list[0];
    if (top?.title && (!t || top.tracks?.some(x => x.id === t.id))) return top.title;
    const lib = this.ctx.library?.tracks;
    if (lib?.length && this.listState().list.length === lib.length) return this.ctx.res?.stringByName?.('all_songs') ?? 'All Songs';
    return null;
  },

  /**
   * The song step(rel) would really play (the pagers' neighbours): a queued song, the list's next
   * one, a wrap; null where it would play another category, or nothing.
   */
  previewAt(rel) {
    if (!this.track || !rel) return rel ? null : this.track;
    const firstQueued = () => this.entries.find(e => !e.played)?.track ?? null;
    if (rel > 0) {
      if (this.pendingQueue && this.queueStart !== 3) return firstQueued();
      if (this.queueMode) {
        const i = this.indexAt(1, false);
        if (i !== null) return this.queue[i] ?? null;
        // The Queue's end: back to the list (queue_end 1), or round the Queue with repeat.
        if (+(this.ctx.pref?.('queue_end') ?? 1) !== 1) return this.repeat === REPEAT_ON && this.queue.length > 1 ? this.queue[this.order?.[0] ?? 0] ?? null : null;
        return this.ahead(1)[0]?.track ?? null;
      }
      if (this.pendingQueue && this.indexAt(1, false) === null) return firstQueued();
    }
    const i = this.indexAt(rel);
    return i === null || i === this.index ? null : this.queue[i] ?? null;
  },

  /**
   * Previous (owner, 2026-11-25, with previous_resets on, now the default): after RESTART_MS of a
   * song it starts again; before, the song heard before it plays (play-history.js), whatever the
   * shuffle, and pressed again the one before that; at the start of the history, the list's
   * previous song. previous_resets off keeps its meaning: always the list's previous song.
   */
  previous() {
    if (this.ctx.pref?.('previous_resets') === false) { this.step(-1); return; }
    if (this.track && this.state !== STATE_STOPPED && this.positionMs() > RESTART_MS) { this.seek(0); return; }
    if (!this.history.back(id => this.trackById(id), t => this.playBack(t))) this.step(-1);
  },

  /** The place of a track in the playing list, the nearest before the playing song in play order first; -1 when not there. */
  indexNear(t) {
    if (!this.queue.length) return -1;
    this.ensureOrder();
    const order = this.order, pos = order.indexOf(this.index), n = order.length;
    for (let k = 1; k < n; k++) {
      const back = order[(pos - k + n) % n];
      if (this.queue[back]?.id === t.id) return back;
    }
    return -1;
  },

  /** Plays a song heard before: in the playing list where it is there, else ahead of the list (interject). */
  playBack(t) {
    const playing = this.state === STATE_PLAYING, i = this.indexNear(t);
    if (i >= 0) this.load(i, playing);
    else this.interject(t, playing, true);
    return true;
  },

  /**
   * Plays a song that is not in the playing list now, as an entry ahead of the songs still queued:
   * after it they play, then the list goes on (with the song it left when again: Previous).
   */
  interject(track, playing = this.state === STATE_PLAYING, again = false) {
    const e = {track, created: Date.now(), played: false};
    if (this.queueMode) {
      const at = this.entries.indexOf(this.playingEntry) + 1;
      this.entries.splice(at, 0, e);
      this.queue = this.queueOrderTracks();
      this.order = null;
      this.load(at, playing);
      this.postQueueChanged();
      return e;
    }
    const first = this.entries.findIndex(x => !x.played);
    const at = first < 0 ? this.entries.length : first;
    this.entries.splice(at, 0, e);
    this.playQueueAt(at, playing);
    if (again && this.savedNP) this.savedNP.again = true;
    return e;
  },

  /** A song of the list that follows (ahead's index) plays now; the queued songs wait for its end. */
  playListAt(index) {
    if (this.queueMode) {
      const np = this.savedNP;
      if (!np?.queue?.[index]) return false;
      this.queueMode = false;
      this.savedNP = null;
      this.queue = np.queue;
      this.category = np.category;
      this.order = np.order;
      this.orderShuffle = np.orderShuffle;
      this.orderQueueMode = false;
      this.post('msg_player_category_changed');
    } else if (!this.queue[index]) return false;
    this.keepQueued();
    this.load(index, true);
    this.postQueueChanged();
    return true;
  },

  /** Passes over (on) or brings back a song of the list that follows, this time round. */
  skipOnce(index, on = true) {
    const {list} = this.listState();
    if (!list[index]) return;
    let s = this.skips.get(list);
    if (!s) this.skips.set(list, s = new Set());
    if (on) s.add(index);
    else s.delete(index);
    this.postQueueChanged();
  },

  /** A song played leaves the songs passed over before it (they were passed this time round). */
  passSkips() {
    const s = this.skips.get(this.queue);
    if (!s?.size) return;
    const order = this.order?.length === this.queue.length ? this.order : null;
    if (!order && this.songsShuffled) return;
    const pos = order ? order.indexOf(this.index) : this.index;
    for (const i of s) if ((order ? order.indexOf(i) : i) <= pos) s.delete(i);
  },

  /** A queued entry plays now; the others still to come keep their order after it. */
  playEntry(e) {
    const from = this.entries.indexOf(e);
    if (from < 0) return false;
    this.entries.splice(from, 1);
    const first = this.entries.findIndex(x => !x.played);
    const to = this.queueMode ? this.entries.indexOf(this.playingEntry) + 1 : first < 0 ? this.entries.length : first;
    this.entries.splice(to, 0, e);
    if (this.queueMode) this.queueUpdated(false);
    return this.playQueueAt(this.entries.indexOf(e), true);
  },

  /** Next up in a new order (sub: its entries in the order wanted); the other entries keep their places. */
  reorderNextUp(sub) {
    const set = new Set(sub);
    const slots = this.entries.flatMap((e, i) => (set.has(e) ? [i] : []));
    if (slots.length !== sub.length) return;
    const next = [...this.entries];
    slots.forEach((slot, k) => { next[slot] = sub[k]; });
    this.entries = next;
    this.queueUpdated(false);
  },

  /** Takes entries out of the Queue; returns [{entry, at}] to put them back (putBack). */
  takeOut(entries) {
    const gone = entries.map(entry => ({entry, at: this.entries.indexOf(entry)})).filter(g => g.at >= 0);
    if (gone.length) this.removeFromQueue(gone.map(g => g.at));
    return gone;
  },

  /** Clears Next up (the playing entry and the played ones stay); returns what putBack restores. */
  clearNextUp() {
    return this.takeOut(this.nextUp());
  },

  /** Puts entries back where they were ([{entry, at}] from takeOut), those not back already. */
  putBack(gone) {
    const back = gone.filter(g => !this.entries.includes(g.entry)).sort((a, b) => a.at - b.at);
    if (!back.length) return;
    for (const g of back) this.entries.splice(Math.min(g.at, this.entries.length), 0, g.entry);
    this.queueUpdated(false);
  },
};
