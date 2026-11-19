// Live previews above an area's rows (FEEL.md "Settings": a row's change shows at once, with a picture
// where one says it better): Appearance's three posters, text samples and accent; Home's posters.

import {h} from '../ui/dom.js';
import {posterCard} from '../ui/components.js';

/** Three posters as Home draws them now: the first row's own, or placeholders before Home has any. */
export function posterStrip(app) {
  const items = app.screens.home?.previewItems?.().slice(0, 3) || [];
  const cards = items.length ? items.map(m => posterCard(m, {onOpen() {}}))
    : ['A', 'B', 'C'].map(t => h('div', {class: 'poster-card'}, h('div', {class: 'poster-art skeleton'}), h('span', {class: 'poster-title'}, 'Title ' + t), h('span', {class: 'poster-year'}, '2026')));
  for (const card of cards) { card.tabIndex = -1; card.setAttribute('aria-hidden', 'true'); }
  return h('div', {class: 'preview-row'}, h('div', {class: 'row-scroll'}, ...cards));
}

/** Appearance: the posters, the type at its size, and the accent on a button, a chip and a progress line. */
export function appearancePreview(app) {
  return h('div', {class: 'set-preview', 'aria-hidden': 'true'},
    posterStrip(app),
    h('div', {class: 'type-samples'},
      h('span', {class: 'type-title'}, 'Invented Film'),
      h('span', {class: 'type-body'}, 'A quiet film about a lighthouse keeper.'),
      h('span', {class: 'type-caption'}, '2026 · 1 h 52 min')),
    h('div', {class: 'accent-samples'},
      h('span', {class: 'btn primary'}, 'Play'),
      h('span', {class: 'chip selected'}, '1080p'),
      h('span', {class: 'accent-line'}, h('i'))));
}

/** The preview each area shows above its rows, if any. */
export const PREVIEWS = {appearance: appearancePreview, home: posterStrip};
