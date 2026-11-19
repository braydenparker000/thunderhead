// A title's page: its backdrop and poster, the title, Play and the actions beside it, the story, then the
// cast, the episodes, the details table and "More like this" (screens/details-parts.js). Opened from a
// picture, the picture travels here (screens/details-motion.js). The page takes the title's own colour
// (--tint, FEEL.md rule 12) when Settings › Colour from artwork is on.

import {h, scrollTimelines} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {image, longPress, toast} from '../ui/components.js';
import {artBox} from '../ui/poster.js';
import {press, rise} from '../ui/motion.js';
import {readTint, setTint} from '../ui/art.js';
import {logoImage} from './logo.js';
import {cast, episodes, facts, moreLike} from './details-parts.js';
import {enter, leave} from './details-motion.js';
import {playTarget, namesOf, runtimeLabel, releaseLabel} from '../app/content.js';

const plain = v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : ''; // text, never "[object Object]"

export class DetailsScreen {
  constructor(app, item, {from = null} = {}) {
    this.app = app;
    this.item = item;
    this.from = from;
    // Fetch the player while the viewer reads, so Play opens it at once.
    (globalThis.requestIdleCallback || (fn => setTimeout(fn, 1200)))(() => app.loadPlayer?.().catch(() => {}));
    this.el = h('div', {class: 'screen details'});
    this.header = h('header', {class: 'details-header', 'aria-hidden': 'true', inert: true});
    this.backBtn = press(h('button', {class: 'float-back', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back', {size: 24})));
    this.body = h('div', {class: 'details-body'}, h('div', {class: 'details-wash', 'aria-hidden': 'true'}));
    this.el.append(this.body, this.header, this.backBtn);
    // Posters in "More like this" open their Details out of themselves too.
    this.posterCtx = {watched: m => app.watched.has(m.type, m.id), onOpen: (m, art) => app.push(new DetailsScreen(app, m, {from: art}))};
    this.renderHero(item);
    // Until the full details arrive: what the card already knows (a catalog item often carries the
    // story), with Play in its final place and size, so nothing moves when the rest lands.
    this.actionsSlot = h('div', {class: 'details-actions'});
    this.overviewEl = plain(item.description) ? this.overview(item) : null;
    this.body.append(this.actionsSlot, ...[this.overviewEl].filter(Boolean));
    this.renderActions();
    this.tint();
    this.el.addEventListener('scroll', () => this.onScroll(), {passive: true});
    // Watched changes redraw at most once a frame, and only what shows them: the actions and the episodes.
    const watchedChanged = () => {
      if (!this.meta || this.watchedFrame) return;
      this.watchedFrame = requestAnimationFrame(() => { this.watchedFrame = 0; if (!this.destroyed) { this.renderActions(); this.redrawEpisodes(); } });
    };
    this.offs = [app.watched.onChange(watchedChanged), app.progress.onChange(() => this.renderActions()), app.library.onChange(() => this.renderActions())];
    // Details that could not load are tried again when the add-ons or the connection come back.
    const retry = () => { if (this.failed && !this.loading) this.load(); };
    addEventListener('online', retry);
    this.offs.push(() => removeEventListener('online', retry));
    if (app.onAddons) this.offs.push(app.onAddons(retry));
    this.load();
  }

  /** What rises when the page opens (FEEL.md: up to 4 groups, 30 ms apart). */
  riseGroups() { return [this.hero.head, this.actionsSlot, this.overviewEl, [...this.body.querySelectorAll(':scope > .section:not(.overview)')].slice(0, 2)].filter(x => x && (!Array.isArray(x) || x.length)); }

  async load() {
    this.loading = true;
    const retry = this.body.querySelector('.details-error .btn');
    if (retry) { retry.disabled = true; retry.textContent = 'Retrying…'; }
    let meta = null;
    try { meta = await this.app.meta(this.item); } catch (error) { this.error = error; }
    this.loading = false;
    if (this.destroyed) return;
    // A failure keeps the poster, title and backdrop the card already had.
    this.failed = !meta;
    this.meta = meta ? {...this.item, ...meta, videos: meta.videos || []} : {...this.item, videos: []};
    this.renderHero(this.meta);
    this.renderBody();
    this.tint();
  }

  destroy() { this.destroyed = true; for (const off of this.offs) off(); }
  onShow(first) { if (!first && this.meta) this.renderActions(); }
  /** The shell's hooks (app/app.js): opened out of a picture, Details moves itself in and out (screens/details-motion.js). */
  enter() { const moving = enter(this, this.from); this.moved = !!moving; return moving; }
  leave(under, layer) { return this.moved ? leave(this, layer) : null; }
  /** A Browse setting changed (Colour from artwork, Hide spoilers): what it changes is redrawn. */
  settingChanged() { if (this.destroyed) return; this.tint(); this.redrawEpisodes(); }

  /** The title's colour on this page (--tint): known at once when its poster was seen, else read and faded in. */
  tint() {
    const m = this.meta || this.item, on = this.app.setting('tint');
    const set = t => { setTint(this.el, t); this.el.classList.add('tinted'); };
    const now = on ? this.app.tintOf?.(m) : null;
    if (now) return set(now);
    if (!on) { setTint(this.el, null); this.el.classList.remove('tinted'); return; }
    readTint(m).then(t => { if (t && !this.destroyed && this.app.setting('tint')) set(t); });
  }

  /**
   * The hero, drawn at once from the card that was tapped (its art is usually already in the browser)
   * and updated in place when the full details arrive: a picture whose address did not change is kept.
   */
  renderHero(m) {
    if (!this.hero) {
      const bg = h('div', {class: 'details-bg'}), poster = h('div', {class: 'details-poster-slot'}), title = h('div', {class: 'details-title-slot'}), genres = h('p', {class: 'details-genres'});
      const head = h('div', {class: 'details-head'}, title, genres);
      this.hero = {bg, poster, title, genres, head, el: h('div', {class: 'details-hero'}, bg, h('div', {class: 'details-shade'}), h('div', {class: 'details-hero-content'}, poster, head))};
      this.body.append(this.hero.el);
    }
    const art = m.background || m.poster || '';
    if (art !== this.hero.art) { this.hero.art = art; this.hero.bg.replaceChildren(image(art, '', 'details-bg-img', {eager: true})); }
    // The same poster the card showed, at the card's size: already decoded, so it lands without a flash.
    if ((m.poster || '') !== this.hero.posterSrc) {
      this.hero.posterSrc = m.poster || '';
      this.posterBox = m.poster ? artBox('details-poster', m.poster, image(m.poster, '', 'poster-img', {eager: true})) : null;
      this.hero.poster.replaceChildren(...[this.posterBox].filter(Boolean));
      this.posterBox?.querySelector('img')?.decode?.().catch(() => {});
    }
    const titleKey = (m.logo || '') + '\n' + (m.name || '');
    if (titleKey !== this.hero.titleKey) {
      this.hero.titleKey = titleKey;
      this.hero.title.replaceChildren(m.logo ? logoImage(m.logo, m.name, 'details-logo', {eager: true, onDark: img => img.replaceWith(h('h1', {class: 'details-title'}, m.name || ''))}) : h('h1', {class: 'details-title'}, m.name || ''));
    }
    const line = [releaseLabel(m), runtimeLabel(m.runtime), ...namesOf(m.genres).slice(0, 2)].filter(Boolean).join(' · ');
    this.hero.genres.textContent = line;
    this.hero.genres.hidden = !line;
    this.header.replaceChildren(press(h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => this.app.back()}, icon('back'))),
      m.logo ? logoImage(m.logo, m.name, 'header-logo', {onDark: img => img.replaceWith(h('b', {class: 'header-title'}, m.name || ''))}) : h('b', {class: 'header-title'}, m.name || ''),
      this.libraryButton(m, 'icon-btn'));
  }

  libraryButton(m, cls) {
    const saved = this.app.library.has(m.type, m.id);
    return press(h('button', {class: cls + ' library-btn' + (saved ? ' active' : ''), type: 'button', 'aria-label': saved ? 'Remove from library' : 'Add to library', 'aria-pressed': String(saved),
      onclick: () => { const on = this.app.library.toggle(this.meta || m); toast(on ? 'Added to library' : 'Removed from library'); }}, icon(saved ? 'check' : 'plus', {size: 22})));
  }

  /** The bar at the top: its look follows the scroll in CSS (browse.css); here only whether it takes touches. */
  onScroll() {
    const y = this.el.scrollTop, h0 = this.hero?.el.offsetHeight || 400;
    const collapsed = y > h0 - 96;
    if (collapsed !== this.collapsed) {
      this.collapsed = collapsed;
      this.header.classList.toggle('show', collapsed);
      this.header.setAttribute('aria-hidden', String(!collapsed));
      this.header.inert = !collapsed;
      this.backBtn.classList.toggle('hide', collapsed);
    }
    if (!scrollTimelines) this.hero?.el.style.setProperty('--parallax', `${Math.min(y, 900) * 0.5}px`);
  }

  /** The rest of the page once the full details arrive: added under what is shown (which stays), rising in. */
  renderBody() {
    const m = this.meta;
    this.target = playTarget(m, this.app); // the episode row scrolls to it
    const desc = plain(m.description);
    if (desc !== plain(this.item.description) || !this.overviewEl) {
      const fresh = this.overview(m);
      if (this.overviewEl) this.overviewEl.replaceWith(fresh); else this.actionsSlot.after(fresh);
      this.overviewEl = fresh;
    }
    for (const el of this.body.querySelectorAll(':scope > .section:not(.overview), :scope > .details-error')) el.remove();
    const sections = [this.failed ? this.failure() : null, cast(m), m.type === 'series' && m.videos.length ? episodes(this, m) : null, moreLike(this, m), facts(m)].filter(Boolean);
    this.body.append(...sections);
    this.renderActions();
    rise(sections.slice(0, 4), {name: 'rise:details-more'});
  }

  redrawEpisodes() {
    if (!this.meta) return;
    // The episode row is redrawn where the viewer left it, not scrolled back to the next episode.
    const row = this.body.querySelector('.episode-row'), old = row?.closest('.section');
    if (!old) return;
    this.keepScroll = row.scrollLeft;
    const fresh = episodes(this, this.meta);
    old.replaceWith(fresh);
    const list = fresh.querySelector('.episode-row');
    if (list) list.scrollLeft = this.keepScroll;
    this.keepScroll = null;
  }

  /** The add-ons could not be reached: say so, with Retry (also tried by itself when they are back). */
  failure() {
    const offline = navigator.onLine === false;
    const reason = offline ? 'This phone is offline.' : this.error?.message || 'Your add-ons did not answer.';
    return h('div', {class: 'state-card details-error', role: 'status'}, h('h3', {}, "Couldn't load details"),
      h('p', {}, `${reason} Episodes and more appear once it loads; Astra tries again when the connection is back.`),
      press(h('button', {class: 'btn primary wide', type: 'button', disabled: !!this.loading, onclick: () => this.load()}, this.loading ? 'Retrying…' : 'Retry')));
  }

  /**
   * Play, the one strong button (in the title's colour), and beside it Watched and Library. Before the
   * full details arrive a series' Play waits (disabled) in its final place: it needs the episode list.
   */
  renderActions() {
    const m = this.meta || {...this.item, videos: []}, target = playTarget(m, this.app);
    this.target = target;
    const watchedTitle = this.app.watched.has(m.type, m.id);
    const blocked = !!target.disabled || ((this.failed || !this.meta) && m.type === 'series');
    const play = press(h('button', {class: 'play-btn', type: 'button', disabled: blocked, onclick: () => this.play(target)}, icon('play', {size: 18}), h('span', {}, target.label)));
    longPress(play, () => { if (!blocked) this.app.openStreams(m, target.video, {startTime: target.startTime}); });
    const watched = press(h('button', {class: 'round-btn watched-btn' + (watchedTitle ? ' active' : ''), type: 'button', 'aria-label': watchedTitle ? 'Mark as unwatched' : 'Mark as watched', 'aria-pressed': String(watchedTitle),
      onclick: () => this.app.watched.set(m.type, m.id, null, !watchedTitle)}, icon('checkCircle', {size: 22})));
    const resume = target.progress ? h('div', {class: 'resume-bar'}, h('i', {style: {transform: `scaleX(${Math.min(1, target.progress.time / target.progress.duration)})`}})) : null;
    this.actionsSlot.replaceChildren(h('div', {class: 'actions-row'}, play, watched, this.libraryButton(m, 'round-btn')), ...[resume].filter(Boolean));
    this.header.querySelector('.library-btn')?.replaceWith(this.libraryButton(m, 'icon-btn'));
  }

  play(target) { this.app.openStreams(this.meta || this.item, target.video, {startTime: target.startTime}); }

  overview(m) {
    const parts = [];
    const age = plain(m.certification) || plain(m.ageRating), rating = plain(m.imdbRating);
    if (age) parts.push(h('span', {class: 'age-badge'}, age));
    if (rating) parts.push(h('span', {class: 'imdb'}, h('b', {}, 'IMDb'), rating));
    const desc = plain(m.description);
    // "Show more" appears only when the story is really cut at three lines (measured, at any width).
    const text = h('p', {class: 'description', onclick: () => { if (!toggle.hidden) flip(); }}, desc);
    const flip = () => { const open = text.classList.toggle('open'); toggle.textContent = open ? 'Show less' : 'Show more'; toggle.setAttribute('aria-expanded', String(open)); };
    const toggle = h('button', {class: 'more-link', type: 'button', 'aria-expanded': 'false', hidden: true, onclick: flip}, 'Show more');
    if (desc && typeof ResizeObserver === 'function') new ResizeObserver(() => {
      if (text.classList.contains('open')) return;
      toggle.hidden = text.scrollHeight <= text.clientHeight + 1;
      text.classList.toggle('clamped', !toggle.hidden);
    }).observe(text);
    const people = [['Director', namesOf(m.director)], ['Writer', namesOf(m.writer)]].filter(([, v]) => v.length);
    return h('section', {class: 'section overview'},
      parts.length ? h('div', {class: 'meta-line'}, ...parts) : null,
      desc ? text : null, desc ? toggle : null,
      ...people.map(([k, v]) => h('p', {class: 'people'}, h('b', {}, k + ' '), v.slice(0, 3).join(', '))));
  }
}
