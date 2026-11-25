// When Music can't reach the owner's songs (MUSIC.md §6.3), it says so in its own toast and Play is the
// way on:
// - signed out (the library or a song answered 401: the session expired, or there is none): "Sign in to
//   play your songs." A song playing stops where it was and Play shows. Play goes to the sign-in door;
//   the session coming back (a new one on this phone, read from its own storage every few seconds while
//   the page shows, no request) clears it, and an empty library loads by itself.
// - the library failed to load and there is none on the phone: "Couldn't load your songs." Play tries
//   again; so does the connection coming back, the page showing again, and a slow timer (30 s, doubling
//   to 10 min), so it loads by itself.
// A library already on the phone (and its offline copies) plays as before: nothing is said at the open.
export const WORDS = {
  signin: {title: 'Sign in to play your songs.', line2: 'Tap play to sign in'},
  failed: {title: "Couldn't load your songs.", line2: 'Tap play to try again'},
};
const TOKEN_EVERY_MS = 3000, RETRY_MS = 30_000, RETRY_MAX_MS = 600_000;
/** The toast stays until the state changes (a tap on it hides it; Play shows it again). */
const SHOW_MS = 24 * 3_600_000;

const defaults = {
  token: () => import('/th/ported/session.js').then(m => m.sessionToken(), () => null),
  /** The sign-in door, back to this page after it (from home's frame, home goes, and comes back to home). */
  signIn: () => {
    let w = window;
    try { if (window.top !== window && window.top.location.origin === location.origin) w = window.top; } catch {}
    w.location.assign('/signin/?' + new URLSearchParams({next: w.location.pathname + w.location.search}));
  },
  hidden: () => !!globalThis.document?.hidden,
};

export class Access {
  constructor(ctx, player, library, deps = {}) {
    this.ctx = ctx;
    this.player = player;
    this.library = library;
    this.deps = {...defaults, ...deps};
    /** null (all is well), 'signin' or 'failed'. */
    this.state = null;
    this.refused = undefined;
    this.tries = 0;
    this.timer = 0;
    ctx.access = this;
    globalThis.addEventListener?.('online', () => { if (this.state === 'failed') this.retry(); });
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (this.deps.hidden()) return;
      if (this.state === 'failed') this.retry();
      else if (this.state === 'signin') this.watchToken();
    });
  }

  /** After a library load: says what is wrong when there is no library to play. */
  checkLibrary() {
    const e = this.library.r2Error;
    if (!e) { if (this.state === 'failed' || (this.state === 'signin' && this.library.tracks.length)) this.clear(); return; }
    if (this.library.tracks.length) return;
    if (e.status === 401) this.signedOut();
    else this.set('failed');
  }

  /** A 401 for the library or the playing song: the song stops where it was, and nothing is asked again until Play or a new session. */
  signedOut() {
    const p = this.player;
    if (p?.playing) p.pause();
    if (p?.guard) { clearTimeout(p.guard.timer); p.guard.timer = 0; p.guard.pending = true; }
    // Read before saying so: the session that was refused (a new one is the session back).
    this.refused = undefined;
    Promise.resolve(this.deps.token()).then(t => { this.refused = t; });
    this.set('signin');
    this.watchToken();
  }

  set(state) {
    this.state = state;
    this.show();
    clearTimeout(this.timer);
    this.timer = 0;
    if (state === 'failed') this.timer = setTimeout(() => { this.timer = 0; this.retry(); }, Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** this.tries));
  }

  show() {
    const w = WORDS[this.state];
    if (w) this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {...w, ms: SHOW_MS});
  }

  clear() {
    if (!this.state) return;
    this.state = null;
    this.tries = 0;
    clearTimeout(this.timer);
    this.timer = 0;
    this.ctx.bus.post('bus_gui', 'cmd_gui_close_toast', this, {});
  }

  /** The library asked for again (once at a time); an empty one that comes says nothing more. */
  async retry() {
    if (this.retrying) return this.retrying;
    this.tries++;
    this.retrying = this.library.refreshR2({force: true}).finally(() => { this.retrying = null; });
    await this.retrying;
    this.checkLibrary();
  }

  /** While signed out and the page shows: the session on this phone, read every few seconds; a new one clears it. */
  watchToken() {
    if (this.tokenTimer || this.state !== 'signin') return;
    const look = async () => {
      this.tokenTimer = 0;
      if (this.state !== 'signin' || this.deps.hidden()) return;
      const t = await this.deps.token();
      if (this.state !== 'signin') return;
      if (t && this.refused !== undefined && t !== this.refused) { this.back(); return; }
      this.tokenTimer = setTimeout(look, TOKEN_EVERY_MS);
    };
    this.tokenTimer = setTimeout(look, TOKEN_EVERY_MS);
  }

  /** The session is back: the words go; an empty library loads (Play then plays where it was, and asks again for the covers not read meanwhile). */
  back() {
    this.clear();
    this.coversHeld = true;
    if (!this.library.tracks.length) this.retry();
  }

  /** Play, before the player acts: true when it was this module's to answer (sign-in, or the library again). */
  onPlay() {
    if (this.coversHeld && this.state !== 'signin') { this.coversHeld = false; this.library.coversAgain?.(); }
    if (this.state === 'signin') {
      // (An offline copy plays without the session: the player goes on.)
      if (this.player?.track && this.ctx.audioCache?.has?.(this.player.track.src)) return false;
      this.show();
      this.deps.signIn();
      return true;
    }
    if (this.state === 'failed' && !this.player?.track) { this.show(); this.retry(); return true; }
    return false;
  }
}
