// Streams for a title or episode: every add-on is asked at once and fills in as it answers, in the add-ons'
// own order, one section each under its name. Nothing is auto-picked, and nothing is ranked or hidden unless
// the owner says so: their filter chips and their chosen order (Settings › Streams `streamSort`, the order
// chip; addons/stream-facts.js), remembered between titles when `streamRemember` is on. From Details the top
// continues Details' hero and settles into a short header (streams-hero.js, streams-settle.js); cards rise in as
// they arrive (stream-motion.js).

import {h, clock} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {rise} from '../ui/motion.js';
import {fetchStreams, supports} from '../addons/client.js';
import {factsOf, filtersFrom, shown} from '../addons/stream-facts.js';
import {withoutHash} from '../addons/stream-text.js';
import {Notes} from '../addons/stream-note.js';
import {cardStyle, drawInSlices, sizeFrom, streamCard} from './stream-card.js';
import {measureDetails, streamsHero, tint} from './streams-hero.js';
import {addonChips, filterChips, syncChips} from './stream-chips.js';
import {emptyState, failedRow, skeletonStream} from './stream-states.js';
import {handOver, placesOf, riseCards} from './stream-motion.js';
import {settleIn, settleOut} from './streams-settle.js';
import '../settings/streams.js';

export {sizeFrom};

/** Gives each stream of a group a key that stays the same however the list is filtered. */
const keyed = g => ({...g, streams: g.streams ? g.streams.map((s, i) => ({...s, key: `${g.addon.url}#${i}`})) : g.streams});

/** A source's name: the add-on's, then the stream's, once only when the stream's already starts with it ("Example 1080p", not "Example Example 1080p"). */
export function sourceName(addon, stream, between = ' ') {
  const a = String(addon || '').replace(/\s+/g, ' ').trim(), n = String(stream || '').replace(/\s+/g, ' ').trim();
  return !n ? a : (a && n.toLowerCase().startsWith(a.toLowerCase()) && !/[\p{L}\p{N}]/u.test(n[a.length] || '') ? n : `${a}${between}${n}`).trim();
}

/** The Thunderhead's size limit (?max_mb=, /th/astra/open.js): a stream whose known size is larger is hidden. */
const overLimit = (s, mb) => !!mb && (factsOf(s).bytes ?? 0) > mb * 1e6;

export class StreamsScreen {
  constructor(app, meta, video = null, {startTime = 0, headless = false} = {}) {
    this.app = app;
    this.meta = meta;
    this.video = video;
    this.startTime = startTime;
    this.groups = new Map();
    this.names = new Map();
    // The owner's last add-on, filters and order when they keep them; the order they start with otherwise.
    const remember = this.setting('streamRemember', true), start = this.setting('streamSort', 'addon'), kept = remember ? app.store.get('streamFilters', null) : null;
    this.filter = remember ? app.store.get('lastAddon', 'all') : 'all';
    this.f = filtersFrom(kept);
    if (!kept || kept.base !== start) this.f = {...this.f, sort: start, small: start === 'smallest'}; // a newer starting order chosen in Settings wins
    if (headless) return;
    this.style = cardStyle(app);
    app.loadPlayer?.().catch(() => {}); import('../app/ready.js').then(({ReadyAhead}) => { this.ahead = new ReadyAhead(app); this.getReady(); }, () => {}); // getting ready before a tap
    // "No compatible add-ons" may change when a late manifest arrives or add-ons are edited.
    this.offAddons = app.onAddons?.(() => { if (this.empty) this.load(); });
    this.kept = measureDetails(app); // Details' backdrop and logo, where Details has them, before this screen covers it
    this.el = h('div', {class: 'screen streams'});
    this.chips = h('div', {class: 'filter-chips', role: 'tablist', 'aria-label': 'Add-ons'});
    this.facts = h('div', {class: 'filter-chips facts', role: 'group', 'aria-label': 'Filters'});
    this.band = h('div', {class: 'chip-band'}, this.chips, this.facts);
    this.list = h('div', {class: 'stream-list', 'aria-live': 'polite'});
    this.notes = new Notes(this.list); // what each card's note needs: signed in, the browser's answers
    this.footer = h('p', {class: 'stream-footer'});
    this.top = streamsHero(meta, video, this.kept);
    this.backButton = h('button', {class: 'float-back solid', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back'));
    this.el.append(...[this.top, this.backButton,
      startTime > 30 ? h('div', {class: 'resume-pill'}, icon('replay', {size: 16}), `Resume from ${clock(startTime)}`) : null,
      this.band, this.list, this.footer].filter(Boolean));
    tint(app, meta, this.el);
    this.load();
  }

  /** A setting from Settings › Streams (settings/streams.js), or `fallback` where the app has no registry (tests). */
  setting(id, fallback) { try { return this.app.setting ? this.app.setting(id) : fallback; } catch { return fallback; } }

  /** The shell's hooks (app/app.js): from Details the list moves itself in and out (streams-settle.js); else null, the shell's push. */
  enter() { const m = settleIn(this); this.settled = !!m; return m; }
  leave(under, layer) { return settleOut(this, layer); }

  /** Pushed by the shell's own motion: what is under the top rises into place. */
  onShow(first) {
    if (!first || !this.el || this.settled) return;
    rise([[this.band], [this.list]], {name: 'rise:streams-open'});
  }

  get id() { return this.video ? this.video.id : this.meta.id; }

  destroy() { this.destroyed = true; this.abort?.abort(); this.offAddons?.(); }

  /** Settings › Streams changed: cards drawn again in the new style (filters and scroll left as they are). */
  restyle() {
    if (this.destroyed || !this.el) return;
    this.style = cardStyle(this.app);
    for (const sec of this.sections?.values() || []) sec.shows = undefined;
    this.render();
  }

  /**
   * The title's full details, when the screen was opened from a saved card (Continue Watching): Play then has
   * the episode list for the next episode, and the episode's own title and art replace the saved ones.
   */
  updateMeta(meta) {
    if (!meta || this.destroyed) return;
    this.meta = {...this.meta, ...meta, videos: meta.videos || this.meta.videos || []};
    const full = this.video && this.meta.videos.find(v => v.id === this.video.id);
    if (full && (full.title !== this.video.title || full.thumbnail !== this.video.thumbnail)) {
      this.video = full;
      if (!this.kept) { const top = streamsHero(this.meta, full, null); this.top.replaceWith(top); this.top = top; }
    }
  }

  /** An add-on's label on this screen: its manifest's name when known, else the name saved with it. Chosen once, so a chip never renames itself on answering. */
  nameOf(addon) {
    if (!this.names.has(addon.url)) this.names.set(addon.url, this.app.manifests.get(addon.url)?.name || addon.name || 'Add-on');
    return this.names.get(addon.url);
  }

  /** Collects every playable stream without drawing (used by the player's episode switch). */
  async collect() {
    await this.app.ready;
    await fetchStreams(this.addons(), this.meta.type, this.id, {onGroup: g => this.groups.set(g.addon.url, keyed(g))});
    return this.sources();
  }

  /** Add-ons that may have streams: those that say so, and those not reached yet (asked again). */
  addons() {
    return this.app.enabledAddons().filter(a => {
      const m = this.app.manifests.get(a.url);
      return !m || supports(m, 'stream', this.meta.type, this.id);
    });
  }

  async load() {
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    this.groups.clear();
    this.loading = true;
    this.empty = false;
    await this.app.ready;
    if (abort.signal.aborted) return;
    const addons = this.addons();
    if (!this.app.enabledAddons().length) { this.renderEmpty('No add-ons installed', 'Install an add-on with streams in Settings.', false, 'extension'); return; }
    if (!addons.length) { this.renderEmpty('No compatible add-ons', 'None of your add-ons offer streams for this title.', true, 'extension'); return; }
    for (const [order, a] of addons.entries()) this.groups.set(a.url, {addon: {...a, name: this.nameOf(a)}, order, streams: null});
    this.render();
    await this.ask(addons, abort.signal);
    if (abort.signal.aborted) return;
    this.loading = false;
    this.render();
  }

  /** Asks these add-ons for streams; each group fills in, or fails, as its add-on answers. One reached only now with no streams for this title is dropped. */
  async ask(addons, signal) {
    await fetchStreams(addons, this.meta.type, this.id, {signal, onGroup: g => {
      const group = this.groups.get(g.addon.url);
      if (signal.aborted || !group) return;
      this.groups.set(g.addon.url, keyed({...g, addon: group.addon, order: group.order}));
      this.render();
    }});
    if (signal.aborted) return;
    for (const a of addons) if (this.groups.get(a.url)?.streams === null) this.groups.delete(a.url);
  }

  /** Asks one add-on again (its Retry), leaving the others as they are. */
  async retry(url) {
    const group = this.groups.get(url), signal = this.abort?.signal;
    if (!group || group.streams === null || !signal) return;
    this.groups.set(url, {addon: group.addon, order: group.order, streams: null});
    this.render();
    await this.ask([group.addon], signal);
    if (!signal.aborted) this.render();
  }

  sources() {
    return [...this.groups.values()].filter(g => g.streams).sort((a, b) => a.order - b.order)
      .flatMap(g => g.streams.filter(s => s.url).map(s => ({id: s.key, addonUrl: g.addon.url,
        label: sourceName(g.addon.name, withoutHash(s.name), ' · '), detail: [withoutHash(s.title).trim(), sizeFrom(s)].filter(Boolean).join('\n'), // shown: no hash
        stream: {...s, name: sourceName(g.addon.name, s.name)}})));
  }

  /** A state with nothing to list. Refresh stays, so a late add-on or a fixed connection can still be tried. */
  renderEmpty(title, body, retry = false, iconName = 'sources') {
    this.loading = false;
    this.empty = true;
    this.sections?.clear();
    syncChips(this.chips, addonChips(this, []).filter(c => c.key === 'refresh'));
    syncChips(this.facts, []);
    this.list.replaceChildren(emptyState(title, body, retry ? {label: 'Refresh', run: () => this.load()} : null, iconName));
    this.footer.textContent = '';
  }

  /** The "nothing found" state for these groups, made once per message (so a redraw does not fade it in again). */
  nothingState(groups) {
    const failed = groups.filter(g => g.error).length;
    const body = failed === groups.length && failed ? 'None of your add-ons answered. Check the connection and try again.' : failed ? 'The add-ons that answered had none for this title.' : 'None of your add-ons returned streams for this title.';
    if (this.nothing?.body !== body) this.nothing = {body, el: emptyState('No streams found', body, {label: 'Try again', run: () => this.load()})};
    return this.nothing.el;
  }

  /**
   * Draws the chips and the list. Each add-on has one section, created in add-on order when the screen opens
   * (with placeholder cards while it is asked) and filled in place when it answers: cards already on screen are
   * never replaced or moved by another add-on's answer, so a press in progress is not lost and nothing jumps.
   */
  render() {
    const groups = [...this.groups.values()].sort((a, b) => a.order - b.order);
    // Listed: add-ons still asking, with streams, or that failed. One that answered with none is left out.
    const listed = groups.filter(g => g.streams === null || g.streams?.length || g.error);
    // The remembered add-on may have nothing for this title: show everything rather than an empty list.
    if (this.filter !== 'all' && !listed.some(g => g.addon.url === this.filter)) this.filter = 'all';
    syncChips(this.chips, addonChips(this, listed));
    syncChips(this.facts, filterChips(this));
    const shownGroups = this.filter === 'all' ? listed : listed.filter(g => g.addon.url === this.filter);
    const asking = groups.some(g => g.streams === null);
    const nothing = !this.loading && !asking && !groups.some(g => g.streams?.length);
    const state = nothing ? this.nothingState(groups) : null;
    this.sections ??= new Map();
    const wanted = shownGroups.map(g => this.section(g));
    for (const [url, sec] of this.sections) if (!wanted.includes(sec)) { sec.el.remove(); if (!this.groups.has(url)) this.sections.delete(url); }
    const order = [state, ...wanted.map(sec => sec.el)].filter(Boolean);
    // Only out-of-place nodes move.
    for (const el of this.list.querySelectorAll(':scope > .state-card')) if (el !== state) el.remove();
    order.forEach((el, i) => { if (this.list.children[i] !== el) this.list.insertBefore(el, this.list.children[i] || null); });
    while (this.list.children.length > order.length) this.list.lastElementChild.remove();
    const hidden = shownGroups.reduce((n, g) => n + (g.streams ? g.streams.length - this.visible(g).length : 0), 0);
    this.footer.textContent = asking ? 'Checking more add-ons…' : hidden ? `${hidden} hidden by your filters` : ''; this.getReady();
  }

  /** An add-on's streams as the owner's filters and the Thunderhead's size limit leave them, each with its place in the add-on's list. */
  visible(g) { return shown(g.streams, this.f).filter(([s]) => !overLimit(s, this.app.maxMb)); }

  /** What a tap on the streams on screen will need is asked for now (app/ready.js: the switch and the saver decide). */
  getReady() { if (!this.destroyed && !this.empty) this.ahead?.listed([...this.groups.values()].filter(g => g.streams && (this.filter === 'all' || g.addon.url === this.filter)).flatMap(g => this.visible(g).map(([s]) => s))); }

  /** A change to the owner's filters or order: saved (the player's next episode follows it; the next title starts from it when remembered), and drawn. */
  setFilters(f) { this.f = f; this.app.store.set('streamFilters', {...f, base: this.setting('streamSort', 'addon')}); this.render(); }

  /** The owner chose an add-on chip. */
  chooseAddon(id) { this.filter = id; this.app.store.set('lastAddon', id); this.render(); }

  /** One add-on's section, updated in place: its headline, then placeholders, its cards, or its error row. */
  section(g) {
    let sec = this.sections.get(g.addon.url);
    if (!sec) {
      const fetching = h('span', {class: 'fetching'}, 'Fetching…'), count = h('span', {class: 'group-count'});
      const head = h('h3', {class: 'group-title'}, h('span', {class: 'group-name'}, g.addon.name), fetching, count);
      const body = h('div', {class: 'group-body'});
      sec = {el: h('section', {class: 'stream-group', 'data-addon': g.addon.url}, head, body), head, fetching, count, body, shows: undefined};
      this.sections.set(g.addon.url, sec);
    }
    sec.head.hidden = this.filter !== 'all' || !!g.error;
    sec.fetching.hidden = g.streams !== null;
    // What the body shows: placeholders, an error, or this exact list of streams.
    const shows = g.error ? g.error : g.streams === null ? 'asking' : g.streams;
    const limit = `${this.app.maxMb || 0}|${JSON.stringify(this.f)}`;
    if (sec.shows !== shows || sec.limit !== limit) {
      const list = Array.isArray(shows) ? this.visible(g).map(([s]) => s) : null;
      // The cards wait (placeholders, or the cards before) until their notes are known, so none arrives under a finger.
      const wait = list && this.notes.pending(list);
      if (wait) { if (sec.waiting !== wait) { sec.waiting = wait; wait.then(() => this.destroyed || this.render()); } return sec; }
      Object.assign(sec, {shows, limit, drawn: (sec.drawn || 0) + 1});
      sec.count.textContent = list ? String(list.length) : '';
      const placeholders = shows !== 'asking' ? placesOf([...sec.body.querySelectorAll(':scope > .stream-skeleton')]) : []; // read before the body changes
      sec.body.replaceChildren(...(g.error ? [failedRow(g, () => this.retry(g.addon.url))] : g.streams === null ? [skeletonStream(), skeletonStream()] : []));
      handOver(placeholders, sec.body);
      const drawn = sec.drawn;
      if (list) drawInSlices(sec.body, list, s => streamCard(this, g, s), () => !this.destroyed && sec.drawn === drawn, made => riseCards(made, this.el));
    }
    return sec;
  }
}
