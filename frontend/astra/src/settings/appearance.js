// Settings › Appearance (FEEL.md "Settings"): the accent, the page's colour, text size, density, the
// nav bar, the tab Astra opens on, and the poster size and corners that were there before (same ids,
// same stored values). Loaded with the Settings screen; what applies them at start-up is settings/look.js,
// whose defaults these rows share.

import {define, defineArea} from './registry.js';
import {LOOK, BACKGROUNDS, applyAccent, applyBackground, applyTextSize, applyDensity, applyNavLabels, applyNavStyle} from './look.js';

/** Eight designed accents: each reads on near black at 4.5:1 or more. */
export const SWATCHES = [['#f5f5f5', 'White'], ['#8ec5ff', 'Sky'], ['#6fe0b8', 'Mint'], ['#c6e86b', 'Lime'],
  ['#ffc857', 'Amber'], ['#ff8a70', 'Coral'], ['#ff9ec4', 'Rose'], ['#b9a2ff', 'Violet']];

defineArea({id: 'appearance', title: 'Appearance', icon: 'palette', detail: 'Colour, text size, density, the nav bar', order: 10});

define([
  {id: 'accent', area: 'appearance', group: 'Colour', title: 'Accent colour', kind: 'colour', where: 'astra', default: LOOK.accent[1], options: SWATCHES,
    detail: 'Buttons, chips and the progress line. A colour too dark to read on the page is lightened until it reads.',
    apply: (value, app) => applyAccent(value, BACKGROUNDS[app?.setting?.('background')] || BACKGROUNDS.near)},
  {id: 'background', area: 'appearance', group: 'Colour', title: 'Background', kind: 'choice', where: 'astra', default: 'near',
    detail: 'Tinted washes a title’s pages with the colour of its artwork.',
    options: [['black', 'True black'], ['near', 'Near black'], ['tinted', 'Tinted by the title']], apply: applyBackground},
  {id: 'textSize', area: 'appearance', group: 'Text and space', title: 'Text size', kind: 'choice', where: 'device', default: 'standard',
    options: [['small', 'Small'], ['standard', 'Standard'], ['large', 'Large']],
    apply: applyTextSize},
  {id: 'density', area: 'appearance', group: 'Text and space', title: 'Density', kind: 'choice', where: 'device', default: 'comfortable',
    detail: 'Compact tightens the space between things, so more fits on the screen.',
    options: [['comfortable', 'Comfortable'], ['compact', 'Compact']], apply: applyDensity},
  {id: 'posterWidth', area: 'appearance', group: 'Posters', title: 'Poster size', kind: 'choice', where: 'astra', default: 126,
    options: [[104, 'Compact'], [112, 'Dense'], [120, 'Standard'], [126, 'Balanced'], [134, 'Comfort'], [140, 'Large']],
    apply: (value, app) => { app?.applySettings?.(); app?.screens?.home?.repaintBadges?.(); }},
  {id: 'posterRadius', area: 'appearance', group: 'Posters', title: 'Poster corners', kind: 'choice', where: 'astra', default: 12,
    options: [[0, 'Sharp'], [4, 'Subtle'], [8, 'Classic'], [12, 'Rounded'], [16, 'Pill']],
    apply: (value, app) => app?.applySettings?.()},
  {id: 'navLabels', area: 'appearance', group: 'Nav bar', title: 'Tab names under the icons', kind: 'switch', where: 'astra', default: true,
    apply: applyNavLabels},
  {id: 'navStyle', area: 'appearance', group: 'Nav bar', title: 'Nav bar', kind: 'choice', where: 'astra', default: 'floating',
    detail: 'Floating sits above the page as a pill; docked spans the bottom edge.',
    options: [['floating', 'Floating'], ['docked', 'Docked']], apply: applyNavStyle},
  {id: 'startTab', area: 'appearance', group: 'Nav bar', title: 'Open Astra on', kind: 'choice', where: 'astra', default: 'home',
    options: [['home', 'Home'], ['search', 'Search'], ['library', 'Library'], ['settings', 'Settings']]},
]);
