// Settings › Browse (FEEL.md "Settings"): how Home, Details, Search and Library look and move. Every row
// travels with the owner ('astra'). Most take effect through a class on the page's root (browse.css reads
// it), so a change shows at once, on every screen, with nothing redrawn.

import {define} from './registry.js';
import {tintOfArt} from '../ui/art.js';

const root = () => (typeof document !== 'undefined' ? document.documentElement : null);
const flag = (cls, on) => root()?.classList.toggle(cls, on);
/** Open Details screens redraw what a row changes (their episodes). */
const redrawDetails = app => { for (const e of app?.stack || []) e.screen.settingChanged?.(); };

define([
  {id: 'posterTitles', area: 'appearance', group: 'Posters', title: 'Poster titles', kind: 'switch', where: 'astra', default: true,
    detail: 'The title under each poster.', apply: v => flag('b-no-titles', !v)},
  {id: 'posterYears', area: 'appearance', group: 'Posters', title: 'Poster years', kind: 'switch', where: 'astra', default: true,
    detail: 'The year under each poster.', apply: v => flag('b-no-years', !v)},
  {id: 'artPlaceholder', area: 'appearance', group: 'Posters', title: 'While art loads', kind: 'choice', where: 'astra', default: 'blur',
    detail: 'What a poster shows before its picture arrives. Soft colours are a blurred copy of the poster, once Astra has seen it.',
    options: [['blur', 'Soft colours'], ['colour', 'One colour'], ['plain', 'Plain']],
    apply: v => { flag('b-art-flat', v === 'colour'); flag('b-art-plain', v === 'plain'); }},
  {id: 'rowEntrance', area: 'home', group: 'Rows', title: 'Rows rise in', kind: 'switch', where: 'astra', default: true,
    detail: 'A row’s posters rise into place the first time it appears. Later it shows at once.'},
  {id: 'rowSnap', area: 'home', group: 'Rows', title: 'Rows settle on a poster', kind: 'switch', where: 'astra', default: true,
    detail: 'A row you flick comes to rest with a poster at its edge.', apply: v => flag('b-no-snap', !v)},
  {id: 'heroTurn', area: 'home', group: 'Featured', title: 'Featured turns by itself', kind: 'switch', where: 'astra', default: true,
    detail: 'The banner at the top of Home moves to the next title on its own. Never with reduced motion.',
    apply: (v, app) => app?.screens?.home?.carousel?.restart()},
  {id: 'heroSeconds', area: 'home', group: 'Featured', title: 'Featured turns every', kind: 'steps', where: 'astra', default: 8,
    options: {min: 5, max: 15, step: 1, unit: 's'}, apply: (v, app) => app?.screens?.home?.carousel?.restart()},
  {id: 'cwSize', area: 'home', group: 'Continue Watching', title: 'Continue Watching cards', kind: 'choice', where: 'astra', default: 'standard',
    options: [['standard', 'Standard'], ['large', 'Large']], apply: v => flag('b-cw-large', v === 'large')},
  {id: 'tint', area: 'appearance', group: 'Colour', title: 'Colour from artwork', kind: 'switch', where: 'astra', default: true,
    detail: 'A title’s page, its streams and the player take their colour from its poster.',
    apply: (v, app) => { if (app) app.tintOf = meta => (v ? tintOfArt(meta) : null); redrawDetails(app); }},
  {id: 'spoilerBlur', area: 'appearance', group: 'Episodes', title: 'Hide spoilers', kind: 'switch', where: 'astra', default: false,
    detail: 'An episode you have not watched shows a blurred picture and no story until you tap it.',
    apply: (v, app) => redrawDetails(app)},
]);
