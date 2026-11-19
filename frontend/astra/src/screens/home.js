// Home: the hero carousel, Continue Watching, then each catalog as a row.

import {h, timeLeft} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {posterCard, setWatchedBadge, image, longPress, liftMenu, skeletonRow, emptyCard, toast, mountTonight} from '../ui/components.js';
import {homeCatalogs, loadRows, heroItems, ROW_ITEMS, episodeCode} from '../app/content.js';
import {Hero} from './hero.js';
import {resumeRemembered, continueNext, playsDirectly, pressCard, videoOf} from '../app/resume.js';
import {press, rise, level, tick} from '../ui/motion.js';
import {artBox} from '../ui/poster.js';
import {setTint} from '../ui/art.js';
import '../settings/browse.js';

/** Opens a title's Details out of the picture that was tapped (screens/details-motion.js). */
export function openDetails(app, m, from = null) {
  return from && app.screenTypes?.details ? app.push(new app.screenTypes.details(app, m, {from})) : app.openTitle(m);
}

const risen = new Set(); // rows that have made their first appearance this visit

/** Long-press actions shared by every poster. */
export function posterMenu(app) {
  return m => [
    app.library.has(m.type, m.id)
      ? {label: 'Remove from library', icon: 'check', run: () => { app.library.toggle(m); toast('Removed from library'); }}
      : {label: 'Add to library', icon: 'plus', run: () => { app.library.toggle(m); toast('Added to library'); }},
    // A circled check for watched, so it never reads as the library's plain ✓.
    app.watched.has(m.type, m.id)
      ? {label: 'Mark as unwatched', icon: 'checkCircleOutline', run: () => app.watched.set(m.type, m.id, null, false)}
      : {label: 'Mark as watched', icon: 'checkCircle', run: () => app.watched.set(m.type, m.id, null, true)},
  ];
}

export function posterContext(app) {
  return {watched: m => app.watched.has(m.type, m.id), onOpen: (m, art) => openDetails(app, m, art), menu: posterMenu(app)};
}

export function rowHeader(title, onAll) {
  return h('div', {class: 'row-head'}, h('h2', {}, title),
    onAll ? press(h('button', {class: 'row-all', type: 'button', 'aria-label': 'View all ' + title, onclick: onAll}, icon('chevronRight', {size: 16}))) : h('span', {class: 'row-all placeholder', 'aria-hidden': 'true'}));
}

/** A row of posters: it settles on a poster's edge (browse.css, Settings › Rows settle) with a tick at Full haptics. */
export function rowScroll(...cards) {
  const el = h('div', {class: 'row-scroll'}, ...cards);
  el.addEventListener('scrollend', () => { if (!document.documentElement.classList.contains('b-no-snap')) tick('snap'); }, {passive: true});
  return el;
}

/** A row's first appearance this visit: its header and first posters rise in (FEEL.md "Loading"); later, at once. */
export function riseRow(app, key, slot) {
  if (risen.has(key)) return;
  risen.add(key);
  if (app.setting?.('rowEntrance') === false || !slot.isConnected) return;
  const r = slot.getBoundingClientRect();
  if (r.top > innerHeight || r.bottom < 0) return; // below the fold: it is simply there when scrolled to
  const cards = [...slot.querySelectorAll('.row-scroll > *')].slice(0, 4);
  rise([[slot.querySelector('.row-head'), cards[0]], ...cards.slice(1)], {name: 'rise:row'});
}

export class HomeScreen {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.hero = h('div', {class: 'hero-slot'});
    this.cw = h('div', {class: 'cw-slot'});
    this.rows = h('div', {class: 'rows'});
    // Without the hero, Home has a title of its own that shrinks into its bar as the page scrolls (browse.css).
    this.title = h('h1', {class: 'page-title home-title'}, 'Home');
    this.tonight = h('div', {class: 'tonight-slot'});
    view.append(h('div', {class: 'home'}, this.title, this.hero, this.tonight, this.cw, this.rows));
    mountTonight(app, this.tonight);
    this.ctx = posterContext(app);
    app.progress.onChange(() => this.renderContinue());
    // On screen: the badges change now; under another tab or screen: when Home shows again.
    app.watched.onChange(() => { if (app.tab === 'home' && !app.covered) this.repaintBadges(); else this.dirty = true; });
    // A late add-on answer, a refreshed manifest or an edit in Settings: redraw without flashing skeletons.
    app.onAddons?.(() => this.load({quiet: true}));
    this.load();
  }

  onShow() { if (this.dirty) { this.dirty = false; this.repaintBadges(); } this.carousel?.resume(); }
  onHide() { this.carousel?.pause(); }
  onCover(covered) { if (covered) this.onHide(); else this.onShow(); }
  reselect() { this.view.scrollTo({top: 0, behavior: level() === 'full' ? 'smooth' : 'auto'}); }

  async load({quiet = false} = {}) {
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    const showHero = this.app.settings.hero !== false;
    this.title.hidden = showHero;
    if (!quiet || !this.rows.childElementCount) {
      this.hero.replaceChildren(...(showHero ? [h('div', {class: 'hero skeleton-hero'}, h('div', {class: 'skeleton hero-logo-ph'}), h('div', {class: 'skeleton hero-line-ph'}), h('div', {class: 'skeleton hero-btn-ph'}))] : []));
      this.rows.replaceChildren(skeletonRow(), skeletonRow(), skeletonRow());
    }
    this.renderContinue();
    await this.app.ready;
    if (abort.signal.aborted) return;
    const hidden = Array.isArray(this.app.settings.hiddenRows) ? this.app.settings.hiddenRows : [];
    const entries = homeCatalogs(this.app.enabledAddons(), this.app.manifests).filter(e => !hidden.includes(e.key));
    if (!entries.length) {
      this.carousel?.destroy?.(); this.carousel = null;
      this.hero.replaceChildren();
      const enabled = this.app.enabledAddons().length;
      if (enabled && !this.app.manifests.size) {
        this.rows.replaceChildren(emptyCard('Can’t reach your add-ons', navigator.onLine === false ? 'This phone is offline. Astra tries again when the connection is back.' : 'They did not answer. Check the connection and try again.',
          {label: 'Retry', run: () => { this.app.reloadAddons(); this.load(); }}));
      } else {
        this.rows.replaceChildren(emptyCard('No content sources', 'Add an add-on with catalogs in Settings to fill Home.', {label: 'Open add-ons', run: () => this.openAddons()}));
      }
      return;
    }
    // A quiet reload keeps the rows already shown (and where they were scrolled to) until their fresh copy is drawn.
    const previous = new Map([...this.rows.querySelectorAll('.row[data-key]')].map(r => [r.dataset.key, r]));
    const slots = new Map(entries.map(e => [e.key, quiet && previous.get(e.key)?.entry ? previous.get(e.key) : h('section', {class: 'row'})]));
    const order = [...slots.values()];
    if (order.length !== this.rows.children.length || order.some((slot, i) => this.rows.children[i] !== slot)) this.rows.replaceChildren(...order);
    for (const slot of order) if (!slot.childElementCount) slot.append(...[...skeletonRow(6).children]);
    const loaded = [];
    let heroDone = quiet && !!this.carousel; // a quiet reload keeps the hero turning
    await loadRows(entries, (entry, items, error) => {
      const slot = slots.get(entry.key);
      if (error || !items.length) {
        if (quiet && slot.entry) { entry.items = slot.entry.items; if (!loaded.includes(entry)) loaded.push(entry); }
        else if (error) { entry.failed = true; this.renderRowError(slot, entry); } // says so, with Retry, instead of vanishing
        else slot.remove(); // an empty catalog
        return;
      }
      entry.items = items;
      if (!loaded.includes(entry)) loaded.push(entry);
      this.renderRow(slot, entry);
      const firstTwo = entries.slice(0, 2).every(e => e.items || e.failed || !slots.get(e.key).isConnected);
      if (!heroDone && firstTwo && showHero) {
        heroDone = true;
        this.renderHero(entries.filter(e => e.items));
      }
    }, {signal: abort.signal});
    if (abort.signal.aborted) return;
    if (!heroDone && showHero) this.renderHero(loaded);
    if (!showHero) { this.carousel?.destroy?.(); this.carousel = null; this.hero.replaceChildren(); }
    if (!loaded.length) this.rows.replaceChildren(emptyCard("Couldn't load Home", 'Your add-ons did not answer. Check the connection and try again.', {label: 'Retry', run: () => { this.app.reloadAddons(); this.load(); }}));
  }

  /** A row whose catalog failed: its title and a one-line note with Retry (that row only). */
  renderRowError(slot, entry) {
    const name = this.rowName(entry);
    slot.entry = null;
    slot.signature = null;
    slot.dataset.key = entry.key;
    const retry = h('button', {class: 'row-retry', type: 'button', 'aria-label': 'Retry ' + name, onclick: () => {
      retry.disabled = true;
      retry.textContent = 'Loading…';
      loadRows([entry], (e, items, error) => {
        if (!slot.isConnected) return;
        if (error) { this.renderRowError(slot, e); return; }
        if (!items.length) { slot.remove(); return; }
        e.items = items; e.failed = false;
        this.renderRow(slot, e);
      });
    }}, 'Retry');
    slot.replaceChildren(rowHeader(name, null), h('p', {class: 'row-error'}, h('span', {}, "Couldn't load this row."), retry));
  }

  rowName(entry) { return this.app.settings.showCatalogType === false ? entry.title.replace(/ - (Movie|Series|\w+)$/, '') : entry.title; }

  renderRow(slot, entry) {
    const items = entry.items.slice(0, ROW_ITEMS);
    const all = entry.items.length > ROW_ITEMS || entry.pageable ? () => this.app.openCatalog(entry) : null;
    const name = this.rowName(entry);
    // Unchanged rows are left as they are: no flash, and a row the user scrolled stays put.
    const signature = [name, !!all, ...items.map(m => m.id)].join('\n');
    slot.entry = entry;
    if (slot.signature === signature) return;
    slot.replaceChildren(rowHeader(name, all), rowScroll(...items.map(m => posterCard(m, this.ctx))));
    slot.dataset.key = entry.key;
    slot.signature = signature;
    riseRow(this.app, 'home:' + entry.key, slot);
  }

  openAddons() {
    this.app.selectTab('settings');
    const settings = this.app.screens.settings;
    settings?.open?.('Add-ons', p => settings.addons(p));
  }

  /** The first loaded row's titles (Settings > Appearance previews them). */
  previewItems() { return [...this.rows.children].map(slot => slot.entry?.items).find(items => items?.length) || []; }

  /**
   * After a watched change or a Home setting: rows whose title or items
   * changed are redrawn; watched badges change in place, so the other rows
   * keep their scroll and their images.
   */
  repaintBadges() {
    for (const slot of this.rows.querySelectorAll('.row')) if (slot.entry) this.renderRow(slot, slot.entry);
    for (const card of this.rows.querySelectorAll('.poster-card[data-item]')) {
      const [type, ...rest] = card.dataset.item.split(':');
      setWatchedBadge(card, !!this.ctx.watched?.({type, id: rest.join(':')}));
    }
  }


  renderHero(rows) {
    const items = heroItems(rows);
    this.carousel?.destroy();
    if (!items.length) { this.hero.replaceChildren(); return; }
    this.carousel = new Hero(items, (m, from) => openDetails(this.app, m, from), this.view, this.app);
    this.hero.replaceChildren(this.carousel.el);
  }

  renderContinue() {
    const items = this.app.progress.continueWatching();
    this.view.classList.toggle('has-cw', items.length > 0);
    if (!items.length) { this.cw.replaceChildren(); return; }
    this.cw.replaceChildren(h('section', {class: 'row cw'}, rowHeader('Continue Watching', null),
      rowScroll(...items.map(e => this.continueCard(e)))));
  }

  /**
   * A Continue Watching entry's tap (app/resume.js): the stream it remembers plays at once from `startTime`, a
   * Next Up continues the release group watched; without either, or with `list` (the long press's "Choose another
   * stream"), its streams open at once, from what was saved with it, the full details (the episode list the
   * player's next episode needs) arriving behind the screen. A second tap while it opens does nothing.
   */
  resume(e, m, card, startTime, {list = false} = {}) {
    if (this.resuming) return;
    this.resuming = true;
    setTimeout(() => { this.resuming = false; }, 600);
    if (!list && (e.kind === 'next' ? continueNext(this.app, e, m, {origin: card}) : resumeRemembered(this.app, e, m, startTime, {origin: card}))) return;
    const video = videoOf(e, m);
    const screen = this.app.openStreams(m, video, {startTime});
    this.app.meta(m).then(meta => screen.updateMeta?.(meta), () => {}); // without the add-ons the saved card still plays: streams are asked by id
  }

  continueCard(e) {
    const m = e.meta || {id: e.id, type: e.type, name: ''};
    const code = episodeCode(e);
    const status = e.kind === 'next' ? 'Next Up' : e.duration ? timeLeft(e.duration - e.time) : '';
    const art = e.thumbnail || m.background || m.poster;
    const open = () => this.resume(e, m, card, e.kind === 'resume' ? e.time : 0);
    // Art, then over it the episode code, the title and what is left; the progress line in the title's own colour.
    const card = press(h('button', {class: 'cw-card', type: 'button', onclick: open, onpointerdown: () => pressCard(this.app, e), 'aria-label': [m.name, code, status].filter(Boolean).join(', ')},
      artBox('cw-art', art, [image(art, '', 'cw-img'), h('div', {class: 'cw-shade'}),
        status ? h('span', {class: 'cw-chip'}, status) : null,
        h('div', {class: 'cw-text'}, code ? h('small', {}, code) : null, h('b', {}, m.name || ''), e.title ? h('span', {}, e.title) : null),
        e.kind === 'resume' ? h('div', {class: 'cw-progress'}, h('i', {style: {transform: `scaleX(${Math.min(1, e.time / e.duration)})`}})) : null])));
    const tint = this.app.tintOf?.(m);
    if (tint) setTint(card, tint);
    longPress(card, () => liftMenu(card.querySelector('.cw-art'), m.name, code, [
      playsDirectly(e) ? {label: 'Choose another stream', icon: 'sources', run: () => this.resume(e, m, card, e.kind === 'resume' ? e.time : 0, {list: true})} : null,
      {label: 'Go to details', icon: 'info', run: () => openDetails(this.app, m, card.querySelector('.cw-art'))},
      e.kind === 'resume' ? {label: 'Start from beginning', icon: 'replay', run: () => this.resume(e, m, card, 0)} : null,
      {label: 'Remove', icon: 'close', destructive: true, run: () => { this.app.progress.remove(e.type, e.id); toast('Removed from Continue Watching'); }},
    ].filter(Boolean)));
    return card;
  }
}

export {episodeCode};
