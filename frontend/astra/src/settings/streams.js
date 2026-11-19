// Settings › Streams: how a stream card looks and what it shows, the order the list starts in, whether the
// owner's last filters are kept, and Astra's format for AIOStreams. Every default is the designed one
// (FEEL.md "Settings"). The card style and lines travel with the owner ('astra'); so does the order.

import {define} from './registry.js';
import {SORTS} from '../addons/stream-facts.js';
import {AIO_FORMAT_TEXT} from '../addons/astra-format.js';
import {toast} from '../ui/components.js';

/** Redraws the stream list on screen, if one is open, after a change here. */
const redraw = (value, app) => { for (const e of app?.stack || []) e.screen?.restyle?.(); };

define([
  {id: 'streamCard', area: 'streams', title: 'Stream cards', kind: 'choice', where: 'astra', default: 'designed',
    detail: 'Designed reads each stream into a resolution badge, its release name and its size. Add-on text shows what the add-on wrote, as it wrote it.',
    options: [['designed', 'Designed'], ['addon', 'Add-on text']], apply: redraw},
  {id: 'streamCardBadges', area: 'streams', title: 'Picture, codec and sound', kind: 'switch', where: 'astra', default: true,
    detail: 'HDR, Dolby Vision, the codec and the sound beside the resolution.', apply: redraw},
  {id: 'streamCardRelease', area: 'streams', title: 'Release name', kind: 'switch', where: 'astra', default: true,
    detail: 'The file’s own name on one line, its end always readable.', apply: redraw},
  {id: 'streamCardDetails', area: 'streams', title: 'Size, source and group', kind: 'switch', where: 'astra', default: true,
    detail: 'Size, data an hour, source, release group, indexer, seeders and languages.', apply: redraw},
  {id: 'streamCardReady', area: 'streams', title: 'Ready on your debrid service', kind: 'switch', where: 'astra', default: true,
    detail: 'Marks a stream your debrid service already has, when the add-on says so.', apply: redraw},
  {id: 'streamSort', area: 'streams', title: 'Order', kind: 'choice', where: 'astra', default: 'addon',
    detail: 'The order the list starts in. As sent keeps each add-on’s own order; Astra never reorders by itself.',
    options: SORTS, apply: redraw},
  {id: 'streamRemember', area: 'streams', title: 'Remember my filters', kind: 'switch', where: 'astra', default: true,
    detail: 'Keeps the add-on, filters and order you chose last for the next title.'},
  {id: 'streamAioFormat', area: 'streams', title: 'Copy Astra’s format for AIOStreams', kind: 'action',
    detail: 'In AIOStreams, open Formatter and choose Custom.\nPaste the line under NAME into Name and the lines under DESCRIPTION into Description, then save.\nAstra then reads every stream’s facts exactly instead of guessing them from its text.',
    apply: () => { navigator.clipboard?.writeText(AIO_FORMAT_TEXT).then(() => toast('Format copied'), () => toast('Copy failed')); }},
]);
