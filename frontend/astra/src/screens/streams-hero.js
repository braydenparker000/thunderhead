// The top of the stream list. Opened from Details (FEEL.md "Details → stream list"), it keeps Details'
// backdrop and title logo exactly where Details had them: their places are measured on Details before the
// list is pushed, the very images Details shows are copied (already decoded, so nothing reloads), and during
// the push and the pop the top is held still against the slide (stream-motion.js stayPut). Only what is under
// them changes. Opened from anywhere else (Continue Watching), it is a short header of its own: the backdrop
// (or the episode's still), a shade, and the logo or the title. The title's colour (app.tintOf, else --accent)
// tints the header.

import {h} from '../ui/dom.js';
import {image} from '../ui/components.js';
import {episodeCode, videoTitle} from '../app/content.js';
import {logoImage} from './logo.js';

const MIN_KEPT = 200; // px of Details' hero still on screen for it to be worth keeping; less and the short header is used
const COPIED = ['filter', 'font', 'letterSpacing', 'textAlign', 'color', 'objectFit', 'objectPosition', 'textShadow', 'webkitLineClamp', 'webkitBoxOrient', 'display', 'overflow'];

const rectIn = (el, top) => { const r = el.getBoundingClientRect(); return {left: r.left, top: r.top - top, width: r.width, height: r.height}; };
const place = (el, r) => Object.assign(el.style, {position: 'absolute', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', transform: 'none', animation: 'none'});

/** A copy of `el` at rect `r`, looking as it does there (its own computed look kept, its classes swapped for `cls`). */
function copyAt(el, r, cls) {
  const copy = el.cloneNode(true), look = getComputedStyle(el);
  copy.removeAttribute('id');
  copy.className = [cls, ...[...el.classList].filter(c => /^(logo-lift|logo-rim|loaded)$/.test(c))].join(' ');
  for (const p of COPIED) if (look[p]) copy.style[p] = look[p];
  place(copy, r);
  copy.style.maxWidth = 'none';
  return copy;
}

/**
 * Where Details shows its backdrop, shade, logo and genre line, measured now (before the list is pushed over
 * it), or null when the screen under is not Details or too little of its hero is on screen.
 */
export function measureDetails(app) {
  const under = app?.stack?.at(-1)?.screen, root = under?.el;
  if (!root?.classList?.contains('details')) return null;
  const hero = root.querySelector('.details-hero'), bg = root.querySelector('.details-bg'), title = root.querySelector('.details-logo, .details-title');
  if (!hero || !bg) return null;
  const top = root.getBoundingClientRect().top, heroRect = rectIn(hero, top);
  const bottom = heroRect.top + heroRect.height;
  if (bottom < MIN_KEPT) return null;
  const art = bg.querySelector('img, .img-fallback'), shade = root.querySelector('.details-shade'), genres = root.querySelector('.details-genres');
  return {
    height: Math.round(bottom),
    art: art ? copyAt(art, rectIn(bg, top), 'streams-img kept') : null,
    shade: shade ? {rect: rectIn(shade, top), image: getComputedStyle(shade).backgroundImage} : null,
    title: title ? copyAt(title, rectIn(title, top), title.tagName === 'IMG' ? 'streams-logo kept' : 'streams-name kept') : null,
    line: genres && !genres.hidden ? {rect: rectIn(genres, top), text: genres.textContent} : title ? {rect: {...rectIn(title, top), top: rectIn(title, top).top + rectIn(title, top).height + 8, height: 18}, text: ''} : null,
  };
}

/** The header kept from Details (`kept` from measureDetails); an episode's code and title sit where the genres were. */
function keptHero(kept, meta, video) {
  const shade = h('div', {class: 'streams-shade'});
  if (kept.shade) { place(shade, kept.shade.rect); shade.style.backgroundImage = kept.shade.image; }
  const words = video ? [episodeCode(video), videoTitle(video)].filter(Boolean).join(' · ') : kept.line?.text || '';
  const line = kept.line && words ? h('p', {class: 'streams-line'}, words) : null;
  if (line) place(line, {...kept.line.rect, height: kept.line.rect.height || 18});
  const el = h('div', {class: 'streams-hero kept' + (video ? ' episode' : ' movie')}, h('div', {class: 'streams-art'}, kept.art), shade, kept.title, line);
  el.style.height = kept.height + 'px';
  return el;
}

/** The short header of its own, when the list was not opened from Details. */
function ownHero(meta, video) {
  const m = meta, v = video;
  if (v) {
    return h('div', {class: 'streams-hero episode'}, h('div', {class: 'streams-art'}, image(v.thumbnail || m.background, '', 'streams-img')), h('div', {class: 'streams-shade'}),
      h('div', {class: 'streams-text'}, episodeCode(v) ? h('b', {class: 'code'}, episodeCode(v)) : null, h('h1', {}, videoTitle(v)), h('p', {}, m.name)));
  }
  return h('div', {class: 'streams-hero movie'}, h('div', {class: 'streams-art'}, image(m.background, '', 'streams-img')), h('div', {class: 'streams-shade'}),
    m.logo ? logoImage(m.logo, m.name, 'streams-logo', {onDark: img => img.replaceWith(h('h1', {class: 'streams-name'}, m.name))}) : h('h1', {class: 'streams-name'}, m.name));
}

/** The header for `meta` (and `video`), kept from Details when `kept` is given. */
export const streamsHero = (meta, video, kept) => (kept ? keptHero(kept, meta, video) : ownHero(meta, video));

/**
 * Sets the title's colour on the screen `el` (FEEL.md rule 12): app.tintOf(meta) when the browse area provides
 * it (a colour, or a promise of one), else --accent as tokens.css has it. A real tint adds the header's wash.
 */
export function tint(app, meta, el) {
  let got;
  try { got = app?.tintOf?.(meta); } catch { got = null; }
  const set = c => { if (typeof c === 'string' && c && el.isConnected !== false) { el.style.setProperty('--tint', c); el.classList.add('tinted'); } };
  if (got && typeof got.then === 'function') got.then(set, () => {}); else set(got);
}
