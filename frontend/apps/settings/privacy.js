// @ts-check
// Settings › Privacy and data (MENU-AND-SETTINGS.md §6.7): the senses each app sends your Worker and
// error reports, kept by the Worker; then, as plain text, what leaves at all; then Export, which
// opens the Export page over this one.
import { group, row } from './components.js';
import { infoRow, renderGroup } from './catalog.js';

/** What goes anywhere but the owner's own Worker: nothing else does. */
const LEAVES = /** @type {const} */ ([
  ['Weather', "The town you set for the weather, by name and as its coordinates, goes to Open-Meteo for the forecast."],
  ['Podcasts', 'The feed addresses of the shows you follow, to fetch their new episodes.'],
  ['Nothing else', 'Messages, memory, music, files and everything else go only to your own Worker.'],
]);

/** @param {HTMLElement} body */
export function page(body) {
  const out = row({ title: 'Export', detail: 'Everything of yours as one file, with your password.', icon: 'download-simple', open: true,
    onClick: () => void import('./settings.js').then((m) => m.openPage('export', { over: true })) });
  out.dataset.page = 'export';
  return renderGroup(body, 'privacy', {
    after: [group('What leaves this phone', LEAVES.map(([title, detail]) => infoRow(title, detail))), group('Your data', [out])],
  });
}
