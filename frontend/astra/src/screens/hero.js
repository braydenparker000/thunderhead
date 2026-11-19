// Home's hero: up to eight titles with their art, swipeable, looping, turning every 8 s while visible and
// untouched; the art's parallax follows the page (CSS scroll timelines, else a scroll listener). Each title's
// logo is made readable over its art (screens/logo.js), or its name is shown in text.

import {h, reducedMotion, scrollTimelines} from '../ui/dom.js';
import {image} from '../ui/components.js';
import {logoImage} from './logo.js';

const HERO_INTERVAL = 8000;

/** The hero: swipeable, loops, advances every 8 s while visible and untouched. */
export class Hero {
  constructor(items, onOpen, scroller) {
    this.items = items;
    this.index = 0;
    this.onOpen = onOpen;
    this.track = h('div', {class: 'hero-track'});
    this.slides = items.map((m, i) => this.slide(m, i));
    this.track.append(...this.slides);
    this.dots = h('div', {class: 'hero-dots', role: 'tablist'}, ...items.map((m, i) => h('button', {class: 'hero-dot', type: 'button', role: 'tab', 'aria-label': `${i + 1} of ${items.length}: ${m.name}`, onclick: () => { this.go(i); this.restart(); }})));
    this.el = h('div', {class: 'hero', 'aria-roledescription': 'carousel', 'aria-label': 'Featured'}, this.track, this.dots);
    this.bindSwipe();
    this.onScroll = () => { const y = scroller.scrollTop; this.el.style.setProperty('--parallax', `${Math.min(y, 800) * 0.3}px`); };
    this.scroller = scroller;
    if (!scrollTimelines) scroller.addEventListener('scroll', this.onScroll, {passive: true});
    this.observer = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.resume(); else this.pause(); }, {threshold: 0.3});
    this.observer.observe(this.el);
    this.onVisibility = () => (document.hidden ? this.pause() : this.resume());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.go(0, false);
    this.resume();
  }

  slide(m, i = 1) {
    const meta = [m.type === 'series' ? 'Series' : 'Movie', (m.genres || [])[0], String(m.releaseInfo || m.year || '').slice(0, 4)].filter(Boolean);
    return h('article', {class: 'hero-slide', 'aria-roledescription': 'slide', 'aria-label': m.name},
      h('div', {class: 'hero-bg'}, image(m.background || m.poster, '', 'hero-img', {eager: i === 0})), h('div', {class: 'hero-shade'}),
      h('div', {class: 'hero-content'},
        m.logo ? h('button', {class: 'hero-logo', type: 'button', onclick: () => this.onOpen(m), 'aria-label': m.name}, logoImage(m.logo, m.name, 'hero-logo-img', {onDark: img => img.parentElement?.replaceWith(this.title(m))})) : this.title(m),
        h('p', {class: 'hero-meta'}, ...meta.flatMap((t, i) => i ? [h('i', {class: 'dot', 'aria-hidden': 'true'}), t] : [t])),
        h('button', {class: 'hero-cta', type: 'button', onclick: () => this.onOpen(m)}, 'View Details')));
  }

  /** The title in text, where there is no logo or one too dark to read. */
  title(m) { return h('button', {class: 'hero-title', type: 'button', onclick: () => this.onOpen(m)}, m.name); }

  go(i, animate = true) {
    const n = this.items.length;
    this.index = ((i % n) + n) % n;
    this.track.style.transition = animate && !reducedMotion() ? 'transform 450ms cubic-bezier(.2,0,0,1)' : 'none';
    this.track.style.transform = `translateX(${-this.index * 100}%)`;
    [...this.dots.children].forEach((d, k) => { d.classList.toggle('on', k === this.index); d.setAttribute('aria-selected', String(k === this.index)); });
    this.slides.forEach((s, k) => s.setAttribute('aria-hidden', String(k !== this.index)));
    // The art either side is fetched now, so a swipe or the next turn never shows it arriving.
    for (const k of [this.index - 1, this.index + 1]) {
      const img = this.slides[((k % n) + n) % n]?.querySelector('img[loading="lazy"]');
      if (img) img.loading = 'eager';
    }
  }

  bindSwipe() {
    let start = null;
    this.track.addEventListener('pointerdown', e => { if (e.button !== 0) return; start = {x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, horizontal: null}; this.pause(); });
    this.track.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (start.horizontal == null && Math.hypot(dx, dy) > 8) { start.horizontal = Math.abs(dx) > Math.abs(dy); if (start.horizontal) this.track.setPointerCapture(e.pointerId); }
      if (!start.horizontal) return;
      start.dx = dx;
      this.track.style.transition = 'none';
      this.track.style.transform = `translateX(calc(${-this.index * 100}% + ${dx}px))`;
    });
    const end = () => {
      if (!start) return;
      const {dx, t, horizontal} = start;
      start = null;
      if (horizontal) {
        const w = this.el.clientWidth, v = Math.abs(dx) / Math.max(1, performance.now() - t) * 1000;
        if (Math.abs(dx) > w * 0.16 || v > 300) this.go(this.index + (dx < 0 ? 1 : -1)); else this.go(this.index);
        this.suppressClick = Math.abs(dx) > 8;
      }
      this.restart();
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
    this.track.addEventListener('click', e => { if (this.suppressClick) { e.stopPropagation(); e.preventDefault(); this.suppressClick = false; } }, true);
  }

  pause() { clearInterval(this.timer); this.timer = 0; }
  resume() {
    if (this.timer || reducedMotion() || document.hidden || this.visible === false || this.items.length < 2 || !this.el.isConnected || this.el.closest('[hidden], .off, .covered')) return;
    this.timer = setInterval(() => this.go(this.index + 1), HERO_INTERVAL);
  }
  restart() { this.pause(); this.resume(); }
  destroy() { this.pause(); this.observer.disconnect(); this.scroller.removeEventListener('scroll', this.onScroll); document.removeEventListener('visibilitychange', this.onVisibility); }
}
