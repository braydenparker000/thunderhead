// The top of the stream list. Opened from Details (FEEL.md "Details → stream list"), it is a continuation of
// Details' hero: the very backdrop, poster, logo (or title) and line Details shows are copied (already decoded,
// so nothing reloads) and drawn, in the first frame, exactly where Details had them. Then the header settles
// into a short form with the spring over --t-screen (streams-settle.js): the backdrop is cut to a strip, the
// poster and the title travel together to its foot (scaled, the title's box keeping its width so it never
// rewraps), and the list rises under it, so about three cards are on screen. Back grows it into Details'
// hero again. Opened from anywhere else (Continue Watching), it is a short header of its own: the backdrop
// (or the episode's still), a shade, and the logo or the title. The title's colour (app.tintOf) tints it.

import {h} from '../ui/dom.js';
import {image} from '../ui/components.js';
import {setTint} from '../ui/art.js';
import {episodeCode, videoTitle} from '../app/content.js';
import {logoImage} from './logo.js';

const MIN_KEPT = 200; // px of Details' hero still on screen for it to be worth keeping; less and the short header is used
const COPIED = ['filter', 'font', 'letterSpacing', 'textAlign', 'color', 'objectFit', 'objectPosition', 'textShadow', 'webkitLineClamp', 'webkitBoxOrient', 'display', 'overflow',
  'boxShadow', 'borderRadius', 'backgroundColor', 'backgroundImage', 'maskImage', 'webkitMaskImage', 'whiteSpace'];
/** The short form: the strip's height under the safe area, the poster's width, the title's tallest, the gutter. */
export const SHORT = {strip: 176, poster: 56, title: 40, gutter: 16, gap: 12};

const rectIn = (el, top) => { const r = el.getBoundingClientRect(); return {left: r.left, top: r.top - top, width: r.width, height: r.height}; };
const place = (el, r) => Object.assign(el.style, {position: 'absolute', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', transform: 'none', animation: 'none'});

/** A copy of `el` at rect `r`, looking as it does there (its own computed look kept; `keep` keeps its classes too). */
function copyAt(el, r, cls, keep = false) {
  const copy = el.cloneNode(true), look = getComputedStyle(el);
  copy.removeAttribute('id');
  copy.className = [cls, ...[...el.classList].filter(c => keep || /^(logo-lift|logo-rim)$/.test(c))].join(' ');
  for (const p of COPIED) if (look[p]) copy.style[p] = look[p];
  place(copy, r);
  copy.style.maxWidth = 'none';
  copy.setAttribute('aria-hidden', 'true');
  for (const img of copy.querySelectorAll('img')) img.style.animation = 'none'; // a decoded picture never fades in again
  return copy;
}

/** The phone's safe area at the top, in px. */
function safeTop() {
  const probe = h('div', {style: {position: 'fixed', top: '0', visibility: 'hidden', height: 'env(safe-area-inset-top, 0px)'}});
  document.body.append(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

/**
 * Where Details shows its backdrop, shade, poster, title and line, measured now (before the list covers it),
 * with copies of each, or null when the screen under is not Details or too little of its hero is on screen.
 */
export function measureDetails(app) {
  const under = app?.stack?.at(-1)?.screen, root = under?.el;
  if (!root?.classList?.contains('details')) return null;
  const hero = root.querySelector('.details-hero'), bg = root.querySelector('.details-bg'), title = root.querySelector('.details-logo, .details-title');
  if (!hero || !bg) return null;
  const top = root.getBoundingClientRect().top, width = root.getBoundingClientRect().width, heroRect = rectIn(hero, top);
  const bottom = Math.round(heroRect.top + heroRect.height);
  if (bottom < MIN_KEPT) return null;
  const shade = root.querySelector('.details-shade'), genres = root.querySelector('.details-genres'), poster = root.querySelector('.details-poster');
  const piece = (el, cls, keep) => (el ? {el: copyAt(el, rectIn(el, top), cls, keep), rect: rectIn(el, top)} : null);
  const t = piece(title, title?.tagName === 'IMG' ? 'streams-logo kept' : 'streams-name kept');
  return {
    height: bottom, width, safe: safeTop(),
    bg: piece(bg, 'streams-bg kept'), shade: piece(shade, 'streams-shade kept'), poster: piece(poster, 'kept', true), title: t,
    line: genres && !genres.hidden ? {rect: rectIn(genres, top), look: genres} : t ? {rect: {...t.rect, top: t.rect.top + t.rect.height + 8, height: 18}, look: null} : null,
  };
}

/**
 * The short form's places for the kept pieces: {height, poster, title, line} where each is {left, top, scale}.
 * The title keeps its own box (its width, so its words never rewrap), scaled to at most SHORT.title px tall.
 */
export function shortForm(k) {
  const g = SHORT.gutter, height = Math.min(k.height, SHORT.strip + k.safe), foot = height - SHORT.gap;
  const ps = k.poster ? SHORT.poster / k.poster.rect.width : 0;
  const poster = k.poster ? {left: g, top: foot - k.poster.rect.height * ps, scale: ps} : null;
  const left = poster ? g + SHORT.poster + SHORT.gap : g, room = k.width - left - g;
  const lineH = k.line ? k.line.rect.height : 0;
  const line = k.line ? {left, top: foot - lineH, scale: 1} : null;
  const ts = k.title ? Math.min(1, SHORT.title / k.title.rect.height, room / k.title.rect.width) : 0;
  const title = k.title ? {left, top: foot - lineH - (lineH ? 4 : 0) - k.title.rect.height * ts, scale: ts} : null;
  return {height, poster, title, line, room};
}

/** The header kept from Details (`kept` from measureDetails), drawn in its short form; streams-settle.js moves it. */
function keptHero(k, meta, video) {
  const short = shortForm(k);
  // The backdrop and its shade, where Details had them, seen through a window cut to the strip: the window
  // (overflow hidden) is lifted by what the header loses and the picture in it lowered by as much, so the
  // picture never moves while its foot is cut, by transforms alone (a clip-path would be drawn a frame late).
  const delta = k.height - short.height, inner = h('div', {class: 'streams-artin'}, k.bg?.el, k.shade?.el);
  const art = h('div', {class: 'streams-artbox'}, inner);
  art.style.height = inner.style.height = k.height + 'px';
  art.style.transform = `translateY(${-delta}px)`;
  inner.style.transform = `translateY(${delta}px)`;
  const edge = h('div', {class: 'streams-edge'});
  edge.style.top = short.height - 48 + 'px';
  const pose = (piece, at) => { if (!piece || !at) return null; Object.assign(piece.style, {left: at.left + 'px', top: at.top + 'px', transformOrigin: '0 0', transform: `translate(0px, 0px) scale(${at.scale})`}); return piece; };
  const words = video ? [episodeCode(video), videoTitle(video)].filter(Boolean).join(' · ') : k.line?.look?.textContent || '';
  let line = null;
  if (k.line && words) {
    line = h('p', {class: 'streams-line kept', 'aria-hidden': 'true'}, words);
    place(line, {...k.line.rect, width: Math.min(k.line.rect.width, short.room)});
    if (k.line.look) for (const p of ['font', 'color', 'letterSpacing', 'textAlign']) line.style[p] = getComputedStyle(k.line.look)[p];
  }
  const el = h('div', {class: 'streams-hero kept' + (video ? ' episode' : ' movie')}, art, edge, pose(k.poster?.el, short.poster), pose(k.title?.el, short.title), pose(line, short.line));
  el.style.height = short.height + 'px';
  // What streams-settle.js needs: each piece with its place on Details and in the short form.
  el.settle = {art, inner, edge, delta,
    pieces: [[k.poster?.el, k.poster?.rect, short.poster], [k.title?.el, k.title?.rect, short.title], [line, k.line?.rect, short.line]].filter(([p, r, at]) => p && r && at)};
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
 * Sets the title's colour on the screen `el` (FEEL.md rule 12): app.tintOf(meta) (a colour, a promise of one, or
 * null), else --accent as tokens.css has it. A real tint adds the header's wash.
 */
export function tint(app, meta, el) {
  let got;
  try { got = app?.tintOf?.(meta); } catch { got = null; }
  const set = c => { if (typeof c === 'string' && c) { setTint(el, c); el.classList.add('tinted'); } }; // --tint and --on-tint together (ui/art.js)
  if (got && typeof got.then === 'function') got.then(set, () => {}); else set(got);
}
