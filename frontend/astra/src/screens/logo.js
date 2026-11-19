// A title's logo that can always be read. Logos come from the add-ons' art hosts and are drawn over dark art
// (Home's hero, Details, the Streams header); a black wordmark over a dark still cannot be read. So the logo
// is asked for with CORS (crossorigin="anonymous"), which lets the page draw it to a small canvas and measure
// its own lightness once it has arrived, before it is first painted:
// - dark and of little colour (a black or dark grey wordmark): lifted to light with a filter (.logo-lift);
// - dark and coloured (a deep red wordmark), where that filter would change the brand's colour: the title in
//   text instead, as these screens show when there is no logo (`onDark`);
// - anything else, or an image with its own opaque background: left exactly as it is.
// A host that refuses CORS fails that request; the logo is then asked again plainly (and that host is not
// asked with CORS again this visit) and, since it cannot be measured, gets a soft light rim (.logo-rim) that a
// light logo absorbs into its own edges and that outlines a dark one. Reduced motion and parallax are not
// touched: nothing here moves.

import {h} from '../ui/dom.js';

const SIDE = 48; // the canvas the logo is measured on, at most this wide and tall
const refused = new Set(); // hosts that refused CORS this visit
const tones = new Map(); // logo address -> its tone, once measured

const linear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * The tone of a logo from its pixels (RGBA, as getImageData gives them). Pure.
 * 'dark': mostly dark, little colour; 'dark-colour': dark and coloured; 'light': anything readable on dark art;
 * 'boxed': the image fills its frame (its own background); 'empty': nothing drawn.
 * @param {ArrayLike<number>} data @returns {{tone: 'dark' | 'dark-colour' | 'light' | 'boxed' | 'empty', luminance: number, colour: number}}
 */
export function logoTone(data) {
  let weight = 0, lum = 0, colour = 0, opaque = 0;
  const pixels = Math.floor(data.length / 4);
  for (let i = 0; i < pixels * 4; i += 4) {
    const a = data[i + 3] / 255;
    if (a > 0.9) opaque++;
    if (a < 0.1) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    weight += a;
    lum += a * (0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b));
    colour += a * (Math.max(r, g, b) - Math.min(r, g, b));
  }
  if (!weight) return {tone: 'empty', luminance: 0, colour: 0};
  const luminance = lum / weight, chroma = colour / weight;
  // A light logo stays as it is; so does one drawn on its own opaque box (its background is part of it).
  const tone = opaque > pixels * 0.9 ? 'boxed' : luminance >= 0.12 ? 'light' : chroma < 0.2 ? 'dark' : 'dark-colour';
  return {tone, luminance, colour: chroma};
}

/** The tone of a loaded, readable image, or null when the page may not read it. */
function measure(img) {
  try {
    const w = img.naturalWidth, ht = img.naturalHeight;
    if (!w || !ht) return null;
    const scale = Math.min(1, SIDE / Math.max(w, ht));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(ht * scale));
    const c = canvas.getContext('2d', {willReadFrequently: true});
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    return logoTone(c.getImageData(0, 0, canvas.width, canvas.height).data).tone;
  } catch { return null; } // a tainted canvas: not readable after all
}

const hostOf = src => { try { return new URL(src, location.href).host; } catch { return ''; } };

/**
 * A logo image (as ui/components.js `image()` draws one: lazy unless `eager`, no referrer, fades in on arrival)
 * that is made readable as above. `onDark(img)` swaps the logo for the title in text; without it a dark,
 * coloured logo is lifted like a grey one.
 * @param {string} src @param {string} alt @param {string} cls
 * @param {{eager?: boolean, onDark?: (img: HTMLImageElement) => void}} [options]
 */
export function logoImage(src, alt, cls, {eager = false, onDark} = {}) {
  if (!src) return h('div', {class: 'img-fallback ' + cls});
  const img = h('img', {class: cls, alt, loading: eager ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false'});
  if (eager) img.fetchPriority = 'high';
  const host = hostOf(src);
  const apply = tone => {
    img.dataset.tone = tone ?? 'unread'; // what was decided, for a look in DevTools and for the tests
    if (tone === 'dark' || (tone === 'dark-colour' && !onDark)) img.classList.add('logo-lift');
    else if (tone === 'dark-colour') onDark(img);
    else if (tone === null) img.classList.add('logo-rim');
  };
  // Asked with CORS unless its host refused this visit (the same mode each time, so the browser's copy is reused).
  let cors = !refused.has(host), again = false, fade = false;
  if (cors) img.crossOrigin = 'anonymous';
  img.addEventListener('load', () => {
    // Measured as it arrives (once a visit per logo), so it is painted with what it needs from the start.
    const known = tones.get(src);
    if (cors && known === undefined) { const tone = measure(img); tones.set(src, tone); apply(tone); } else apply(known ?? null);
    if (again) refused.add(host); // it came plainly after failing with CORS: that host does not let a page read it
    if (fade) img.classList.add('loaded');
  });
  img.addEventListener('error', () => {
    if (cors) { // failed with CORS: asked again plainly, once
      cors = false;
      again = fade = true;
      img.removeAttribute('crossorigin');
      img.src = src;
      return;
    }
    img.replaceWith(h('div', {class: 'img-fallback ' + cls}));
  });
  img.src = src;
  fade = !img.complete; // a logo the browser already holds shows at once, with no fade to replay
  return img;
}
