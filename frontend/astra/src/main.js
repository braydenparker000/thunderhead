// Astra's entry point.

import {App} from './app/app.js';
import {HomeScreen} from './screens/home.js';
import {LibraryScreen} from './screens/library.js';
import {DetailsScreen} from './screens/details.js';
import {StreamsScreen} from './screens/streams.js';
import {CatalogScreen} from './screens/catalog.js';
import {toast} from './ui/components.js';
import {showRecovery} from './app/recovery.js';
import {lazyTab} from './app/lazy-screen.js';

const root = document.getElementById('app');
let app = null;
try {
  app = new App(root, {
    home: HomeScreen, library: LibraryScreen,
    // Loaded on their first visit, to keep start-up light (app/lazy-screen.js).
    search: lazyTab(() => import('./screens/search.js').then(m => m.SearchScreen), 'Search', ['search-page', 'sticky-head']),
    settings: lazyTab(() => import('./screens/settings.js').then(m => m.SettingsScreen), 'Settings', ['settings']),
    details: DetailsScreen, streams: StreamsScreen, catalog: CatalogScreen,
  });
  window.astra = app;
  app.start();
  // A title from the Thunderhead's chat (?find= or ?open=, /th/astra/open.js): its Details, never Streams or the player.
  if (/[?&](find|open)=/.test(location.search)) import('/th/astra/open.js').then(m => m.openFromLink(app)).catch(() => {});
} catch (error) {
  // Never leave the launch screen spinning: offer to export or reset what is saved.
  console.error(error);
  app = null;
  showRecovery(root, error);
}

// The launch screen gives way as soon as Home draws anything, its placeholders
// included: the app's own skeleton says "loading" better than a spinner.
const launch = document.getElementById('launch');
const done = () => { if (!launch.isConnected) return; launch.classList.add('gone'); setTimeout(() => launch.remove(), 250); };
if (app) {
  // The tab Astra opens on (Settings › Appearance), usually Home; a tab other than Home is drawn at once.
  const home = app.views[app.tab], drawn = () => app.tab !== 'home' || home.querySelector('.hero, .row, .state-card');
  if (drawn()) requestAnimationFrame(done);
  else new MutationObserver((_, observer) => { if (drawn()) { observer.disconnect(); done(); } }).observe(home, {childList: true, subtree: true});
  setTimeout(done, 5000);
} else done();

// Over https only; tests switch it on for a local server with localStorage astra.dev.sw = 1.
const workerAllowed = location.protocol === 'https:' || (() => { try { return localStorage.getItem('astra.dev.sw') === '1'; } catch { return false; } })();
if ('serviceWorker' in navigator && workerAllowed) {
  // Save what this visit loaded, so the next one opens from the saved copy.
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(registration => {
    const base = new URL('./', location.href).href;
    // Addresses only, never their query or fragment (lab/?src= can hold a stream address).
    const urls = [location.href, ...performance.getEntriesByType('resource').map(e => e.name)].map(u => u.split(/[?#]/)[0]).filter(u => u.startsWith(base));
    registration.active?.postMessage({type: 'astra-precache', urls});
  }).catch(() => {});
  // A newer release is saved: the offer stays until it is taken or put off (this page keeps its own release meanwhile).
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'astra-updated') toast('Astra has been updated', {action: {label: 'Reload', run: () => location.reload()}, stay: true});
  });
}
