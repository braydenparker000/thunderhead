// Home's hero: up to eight titles with their art, looping. It follows a finger exactly and settles with
// the smooth spring (taking over from wherever it is, mid-settle included); it turns by itself every few
// seconds while visible and untouched (Settings › Featured turns by itself, and how often; never under
// reduced motion). The art's parallax follows the page (CSS scroll timelines, else a scroll listener).
// Each title's logo is made readable over its art (screens/logo.js), or its name is shown in text.

import {h, scrollTimelines} from '../ui/dom.js';
import {image} from '../ui/components.js';
import {press, level, tick, T, timed} from '../ui/motion.js';
import {go, stop, spring, handle, EASE} from '../ui/motion-core.js';
import {logoImage} from './logo.js';
import {warmArt} from '../ui/poster.js';

const tx = el => { const t = getComputedStyle(el).transform; return t && t !== 'none' ? new DOMMatrixReadOnly(t).m41 : 0; };

export class Hero {
  constructor(items, onOpen, scroller, app = null) {
    this.items = items;
    this.index = 0;
    this.app = app;
    // The picture of the title whose button was tapped, not of whichever slide is current: the hero may have
    // started turning by itself between the finger landing and the tap (a different title's art would fly).
    this.artOf = m => this.slides[this.items.indexOf(m)]?.querySelector('.hero-bg') || null;
    this.onOpen = m => onOpen(m, this.artOf(m));
    this.track = h('div', {class: 'hero-track'});
    this.slides = items.map((m, i) => this.slide(m, i));
    this.track.append(...this.slides);
    this.dots = h('div', {class: 'hero-dots', role: 'tablist'}, ...items.map((m, i) => h('button', {class: 'hero-dot', type: 'button', role: 'tab', 'aria-label': `${i + 1} of ${items.length}: ${m.name}`, onclick: () => { tick('select'); this.go(i); this.restart(); }})));
    this.el = h('div', {class: 'hero', 'aria-roledescription': 'carousel', 'aria-label': 'Featured'}, this.track, this.dots);
    this.bindSwipe();
    this.onScroll = () => { const y = scroller.scrollTop; this.el.style.setProperty('--parallax', `${Math.min(y, 800) * 0.3}px`); };
    this.scroller = scroller;
    if (!scrollTimelines) scroller.addEventListener('scroll', this.onScroll, {passive: true});
    this.observer = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.resume(); else this.pause(); }, {threshold: 0.3});
    this.observer.observe(this.el);
    this.onVisibility = () => (document.hidden ? this.pause() : this.resume());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize = () => this.go(this.index, false); // the track moves in pixels
    addEventListener('resize', this.onResize);
    this.go(0, false);
    this.resume();
  }

  slide(m, i = 1) {
    const meta = [m.type === 'series' ? 'Series' : 'Movie', (m.genres || [])[0], String(m.releaseInfo || m.year || '').slice(0, 4)].filter(Boolean);
    return h('article', {class: 'hero-slide', 'aria-roledescription': 'slide', 'aria-label': m.name, 'data-item': `${m.type}:${m.id}`},
      h('div', {class: 'hero-bg'}, image(m.background || m.poster, '', 'hero-img', {eager: i === 0})), h('div', {class: 'hero-shade'}),
      h('div', {class: 'hero-content'},
        m.logo ? press(h('button', {class: 'hero-logo', type: 'button', onclick: () => this.onOpen(m), 'aria-label': m.name}, logoImage(m.logo, m.name, 'hero-logo-img', {onDark: img => img.parentElement?.replaceWith(this.title(m))}))) : this.title(m),
        h('p', {class: 'hero-meta'}, ...meta.flatMap((t, k) => k ? [h('i', {class: 'dot', 'aria-hidden': 'true'}), t] : [t])),
        press(h('button', {class: 'hero-cta', type: 'button', onclick: () => this.onOpen(m), onpointerdown: () => warmArt(this.artOf(m))}, 'View Details'))));
  }

  /** The title in text, where there is no logo or one too dark to read. */
  title(m) { return press(h('button', {class: 'hero-title', type: 'button', onclick: () => this.onOpen(m)}, m.name)); }

  width() { return this.el.clientWidth || innerWidth; }

  /** Shows slide i: settled by the spring from wherever the track is now (at once when `animate` is off or motion is). */
  go(i, animate = true, {velocity = 0} = {}) {
    const n = this.items.length;
    this.index = ((i % n) + n) % n;
    const to = `translateX(${-this.index * this.width()}px)`;
    const lv = level();
    if (!animate || lv === 'off') { stop(this.track); this.track.style.transform = to; }
    else {
      const from = `translateX(${tx(this.track)}px)`;
      stop(this.track);
      this.track.style.transform = to;
      // A flick's speed shortens the settle a little; never under the card's 220 ms.
      const ms = lv === 'full' ? Math.max(T.normal, T.screen - Math.min(100, Math.abs(velocity) * 60)) : T.fade;
      timed('hero:settle', () => handle([go(this.track, {transform: to}, {from: {transform: from}, duration: ms, easing: lv === 'full' ? spring('smooth') : EASE})]));
    }
    [...this.dots.children].forEach((d, k) => { d.classList.toggle('on', k === this.index); d.setAttribute('aria-selected', String(k === this.index)); });
    this.slides.forEach((s, k) => { s.setAttribute('aria-hidden', String(k !== this.index)); s.inert = k !== this.index; });
    // The art either side is fetched now, so a swipe or the next turn never shows it arriving.
    for (const k of [this.index - 1, this.index + 1]) {
      const img = this.slides[((k % n) + n) % n]?.querySelector('img[loading="lazy"]');
      if (img) img.loading = 'eager';
    }
  }

  bindSwipe() {
    let start = null;
    this.track.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.suppressClick = false; // a drag that ended with no click must not eat the next tap
      // Caught mid-settle, the track stays where it is under the finger.
      const at = tx(this.track);
      stop(this.track);
      this.track.style.transform = `translateX(${at}px)`;
      start = {x: e.clientX, y: e.clientY, at, dx: 0, horizontal: null, samples: [{x: e.clientX, t: e.timeStamp}]};
      this.pause();
    });
    this.track.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (start.horizontal == null && Math.hypot(dx, dy) > 8) { start.horizontal = Math.abs(dx) > Math.abs(dy); if (start.horizontal) this.track.setPointerCapture(e.pointerId); }
      if (!start.horizontal) return;
      start.dx = dx;
      start.samples.push({x: e.clientX, t: e.timeStamp});
      while (start.samples.length > 2 && e.timeStamp - start.samples[0].t > 80) start.samples.shift();
      this.track.style.transform = `translateX(${start.at + dx}px)`;
    });
    const end = e => {
      if (!start) return;
      const {dx, horizontal, samples, at} = start;
      start = null;
      if (horizontal) {
        const w = this.width(), first = samples[0], last = samples.at(-1);
        const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px/ms
        const here = -(at + dx) / w; // slides from the first, fractional
        let next = Math.round(here);
        if (Math.abs(v) > 0.3) next = v < 0 ? Math.floor(here) + 1 : Math.ceil(here) - 1;
        else if (Math.abs(dx) > w * 0.16) next = dx < 0 ? Math.ceil(here) : Math.floor(here);
        if (next !== this.index) tick('select');
        this.go(Math.max(-1, Math.min(this.items.length, next)), true, {velocity: v});
        this.suppressClick = Math.abs(dx) > 8;
      } else if (e?.type === 'pointercancel') this.go(this.index); // a page scroll took the finger: back where it was
      this.restart();
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
    this.track.addEventListener('click', e => { if (this.suppressClick) { e.stopPropagation(); e.preventDefault(); this.suppressClick = false; } }, true);
  }

  turns() { return this.app?.setting ? this.app.setting('heroTurn') : true; }
  pause() { clearInterval(this.timer); this.timer = 0; }
  resume() {
    if (this.timer || !this.turns() || level() !== 'full' || document.hidden || this.visible === false || this.items.length < 2 || !this.el.isConnected || this.el.closest('[hidden], .off, .covered')) return;
    const seconds = this.app?.setting ? this.app.setting('heroSeconds') : 8;
    this.timer = setInterval(() => this.go(this.index + 1), seconds * 1000);
  }
  restart() { this.pause(); this.resume(); }
  destroy() { this.pause(); stop(this.track); this.observer.disconnect(); this.scroller.removeEventListener('scroll', this.onScroll); document.removeEventListener('visibilitychange', this.onVisibility); removeEventListener('resize', this.onResize); }
}
