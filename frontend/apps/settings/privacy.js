// @ts-check
// Settings › Privacy and data (MENU-AND-SETTINGS.md §6.7): the senses each app sends your Worker and
// error reports, kept by the Worker; the editor's reports as this phone has them (reports.js); then, as plain
// text, what leaves at all; then Export, which opens the Export page over this one, and Bring data from
// the old site (MIGRATION.md §5.3, /import/).
import { el } from '/th/ui.js';
import { group, icon, row } from './components.js';
import { infoRow, renderGroup } from './catalog.js';
import { reportsGroup } from './reports.js';

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
  out.dataset.find = 'export';
  // The phone's app data from the old site's /export/ page.
  const bring = el('a', { class: 'row', href: '/import/', 'data-find': 'import', 'data-action': 'import' }, [icon('download-simple'), el('span', { class: 'row-copy' }, [el('span', { class: 'row-title', text: 'Bring data from the old site' })])]);
  return renderGroup(body, 'privacy', {
    after: [reportsGroup(), group('What leaves this phone', LEAVES.map(([title, detail]) => infoRow(title, detail))), group('Your data', [out, bring])],
  });
}
