// Movement and layout recorder (MUSIC.md §5.10 "Movement and layout"), modelled on Astra's feel log
// (frontend/astra/src/ui/feel-log.js). In memory only, each list capped, and only numbers and the
// layouts' own names: never a title, an artist, a file name or search text. "Copy report" on the
// playback log screen (?diag) adds it under its own heading, `movement`.
// - every view transition: its name (scene or page names), ms, frames drawn and the worst gap
//   between two frames; frames are counted by one requestAnimationFrame loop that runs only while
//   a transition runs;
// - every open of the player: the window's and the visual viewport's height, whether a text field
//   had focus in the last second, the height the layout uses and the player's box height;
// - 600 ms after every song change and play/pause: whether the play and pause buttons are in the
//   page, visible, and their box sizes;
// - each time search is open: the viewport before and after the keyboard, the results list's
//   height (600 ms in, and at each viewport change), and scroll jumps of more than 40 px that no finger or fling made.
// Nothing here runs per frame outside a transition.
import {watchScenes} from '../view/scene.js';
import {watchPages} from '../list/list-transition.js';
import {VISIBLE} from '../res/values.js';

export const CAPS = {runs: 150, opens: 40, buttons: 60, searches: 20, perSearch: 12};
const JUMP_PX = 40;
const BUTTON_IDS = ['play', 'pause'];
const BUTTON_WAIT_MS = 600;

/** A name as the report may carry it: lower-case letters, digits and : . _ - > only. */
export const cleanName = name => String(name || 'unnamed').toLowerCase().replace(/[^a-z0-9:._>-]+/g, '-').slice(0, 60) || 'unnamed';
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const round = x => (Number.isFinite(x) ? Math.round(x) : null);
const push = (list, item, cap) => { list.push(item); if (list.length > cap) list.splice(0, list.length - cap); };

export class FeelLog {
  constructor(ctx) {
    this.ctx = ctx;
    this.t0 = performance.now();
    this.runs = [];
    this.opens = [];
    this.buttons = [];
    this.searches = [];
    this.running = new Map(); // source (scene controller or page transition) -> run
    this.looping = false;
    this.focusedAt = -Infinity;
    this.nav = 'nav_main';
    this.search = null;
    this.buttonTimer = 0;
    ctx.feelLog = this;
    watchScenes((ctl, start) => {
      if (ctl.root?.listItemType) return; // a row's own scenes are not a view transition
      if (start) this.begin(ctl, `${ctl.root?.id || 'scene'}:${ctl.prevScene}>${ctl.scene}`);
      else this.finish(ctl, false);
    });
    watchPages((tr, start, cut) => (start ? this.begin(tr, tr.name) : this.finish(tr, cut)));
    const isField = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    document.addEventListener('focusin', e => { if (isField(e.target)) this.focusedAt = Infinity; }, true);
    document.addEventListener('focusout', e => { if (isField(e.target)) this.focusedAt = performance.now(); }, true);
    ctx.bus.subscribe('bus_gui', (msg, src, d) => { if (msg === 'msg_nav_changed') this.navChanged(d?.nav); });
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_track_changed' && !d?.meta) this.checkButtons('song');
      else if (msg === 'msg_player_playing_state_changed') this.checkButtons('play-pause');
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.nav === 'nav_main') this.playerOpened('shown'); });
  }

  now() { return Math.round(performance.now() - this.t0); }

  // Transitions: one frame loop while any runs.
  begin(source, name) {
    if (this.running.has(source)) this.finish(source, true);
    const start = performance.now();
    this.running.set(source, {name: cleanName(name), start, last: start, frames: 0, worst: 0});
    this.loop();
  }

  finish(source, cut) {
    const run = this.running.get(source);
    if (!run) return;
    this.running.delete(source);
    const end = performance.now();
    push(this.runs, {t: Math.round(run.start - this.t0), name: run.name, ms: Math.round(end - run.start), frames: run.frames, worstGap: Math.round(Math.max(run.worst, end - run.last)), ...(cut ? {cut: true} : {})}, CAPS.runs);
  }

  loop() {
    if (this.looping || typeof requestAnimationFrame !== 'function') return;
    this.looping = true;
    const frame = t => {
      for (const run of this.running.values()) { run.frames++; run.worst = Math.max(run.worst, t - run.last); run.last = t; }
      if (this.running.size) requestAnimationFrame(frame); else this.looping = false;
    };
    requestAnimationFrame(frame);
  }

  navChanged(nav) {
    const from = this.nav;
    this.nav = nav;
    if (from === nav) return;
    if (from === 'nav_search') this.endSearch();
    if (nav === 'nav_search') this.startSearch();
    if (nav === 'nav_main') this.playerOpened('nav');
  }

  viewport() {
    return {innerH: round(window.innerHeight), vvH: round(window.visualViewport?.height ?? NaN)};
  }

  /** CSS px height of a view's box, or null. */
  boxH(v) {
    const r = v?.el?.getBoundingClientRect?.();
    return r ? round(r.height) : null;
  }

  playerOpened(via) {
    push(this.opens, {
      t: this.now(), via, ...this.viewport(),
      inputFocus: performance.now() - this.focusedAt < 1000,
      layoutH: round(this.ctx.viewportHeight), playerH: this.boxH(this.ctx.topNav),
    }, CAPS.opens);
  }

  // The play and pause buttons, once the state's scene change has settled.
  checkButtons(why) {
    clearTimeout(this.buttonTimer);
    this.buttonTimer = setTimeout(() => this.measureButtons(why), BUTTON_WAIT_MS);
  }

  measureButtons(why) {
    const entry = {t: this.now(), why, playing: this.ctx.player?.state === 1, nav: cleanName(this.nav)};
    if (document.hidden) { push(this.buttons, {...entry, hidden: true}, CAPS.buttons); return; }
    const found = [];
    const walk = v => {
      if (BUTTON_IDS.includes(v.id)) found.push(v);
      for (const c of v.children ?? []) walk(c);
    };
    if (this.ctx.topNav) walk(this.ctx.topNav);
    entry.buttons = BUTTON_IDS.map(id => {
      const views = found.filter(v => v.id === id);
      if (!views.length) return {id, inDom: false, visible: false, w: 0, h: 0};
      // The one on screen, if any.
      const shown = views.map(v => this.buttonState(id, v));
      return shown.find(s => s.visible) ?? shown[0];
    });
    push(this.buttons, entry, CAPS.buttons);
  }

  buttonState(id, v) {
    const inDom = !!v.el?.isConnected;
    let shown = inDom;
    for (let c = v; c && shown; c = c.parent) if (c.visibility !== VISIBLE || !(c.alpha > 0)) shown = false;
    const r = inDom ? v.el.getBoundingClientRect() : null;
    const onScreen = !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
    return {id, inDom, visible: shown && onScreen, w: r ? round(r.width) : 0, h: r ? round(r.height) : 0};
  }

  // Search: the viewport around the keyboard, the results list, and scroll jumps.
  listOf() { return this.ctx.listWidget?.libList ?? null; }

  startSearch() {
    const s = this.search = {t: this.now(), before: this.viewport(), after: [], listH: null, jumps: [], lastY: null};
    const resize = () => {
      if (s.after.length < CAPS.perSearch) s.after.push({t: this.now() - s.t, ...this.viewport(), listH: s.listH = this.boxH(this.listOf())});
    };
    // The results list's height once the search screen has settled (its scene change takes 250 ms).
    const settle = setTimeout(() => { s.listH = this.boxH(this.listOf()); }, BUTTON_WAIT_MS);
    s.stop = () => { clearTimeout(settle); window.visualViewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
    window.visualViewport?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    const list = this.listOf();
    if (list) {
      s.list = list;
      list.feelWatch = l => {
        const y = l.scrollY / (this.ctx.dpr || 1);
        if (s.lastY !== null && Math.abs(y - s.lastY) > JUMP_PX && !l.drag && !l._fling && s.jumps.length < CAPS.perSearch) s.jumps.push({t: this.now() - s.t, dy: round(y - s.lastY)});
        s.lastY = y;
      };
    }
  }

  endSearch() {
    const s = this.search;
    if (!s) return;
    this.search = null;
    s.stop();
    if (s.list) s.list.feelWatch = null;
    push(this.searches, {t: s.t, before: s.before, after: s.after, listH: s.listH, jumps: s.jumps}, CAPS.searches);
  }

  /** The report: numbers and names only. */
  report() {
    const names = [...new Set(this.runs.map(r => r.name))].sort();
    const summary = names.map(name => {
      const runs = this.runs.filter(r => r.name === name), ms = runs.map(r => r.ms);
      return {name, runs: runs.length, medMs: median(ms), maxMs: Math.max(...ms), fps: median(runs.map(r => (r.ms > 0 ? Math.round(r.frames * 1000 / r.ms) : 0))), worstGap: Math.max(...runs.map(r => r.worstGap)), cut: runs.filter(r => r.cut).length};
    });
    const open = this.search ? [{t: this.search.t, before: this.search.before, after: this.search.after, listH: this.search.listH, jumps: this.search.jumps, open: true}] : [];
    return {
      version: 1, sessionSeconds: Math.round(this.now() / 1000), dpr: this.ctx.dpr, ...this.viewport(),
      transitions: summary, lastTransitions: this.runs.slice(-40),
      playerOpens: this.opens.slice(), playPauseButton: this.buttons.slice(), search: [...this.searches, ...open],
    };
  }
}

export const installFeelLog = ctx => new FeelLog(ctx);
