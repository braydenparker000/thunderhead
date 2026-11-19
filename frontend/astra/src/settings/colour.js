// Colour sums for Appearance: contrast as WCAG measures it, an accent kept readable on the page's
// colour, and the text colour that goes on top of it. Pure: no DOM.

const channel = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** '#rrggbb' → [r, g, b] (0 to 255). */
export const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexOf = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Relative luminance (0 black to 1 white). */
export const luminance = hex => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** The contrast ratio of two colours (1 to 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Mixes `hex` towards white by `t` (0 to 1). */
export const lighten = (hex, t) => hexOf(rgb(hex).map(v => v + (255 - v) * t));

/**
 * The accent as Astra uses it: the same colour when it reads on `bg` at 4.5:1 or more (it is also
 * the colour of text and icons), otherwise the least lightened copy that does.
 */
export function readableAccent(hex, bg = '#0d0d0d', min = 4.5) {
  for (let t = 0; t <= 1.0001; t += 0.02) { const c = t ? lighten(hex, t) : hex.toLowerCase(); if (contrast(c, bg) >= min) return c; }
  return '#ffffff';
}
/** The text colour on an accent fill: near black or white, whichever reads better. */
export const onColour = hex => contrast(hex, '#111111') >= contrast(hex, '#ffffff') ? '#111111' : '#ffffff';
/** rgba() of a colour at an alpha, for soft fills. */
export const withAlpha = (hex, a) => `rgba(${rgb(hex).join(', ')}, ${a})`;
