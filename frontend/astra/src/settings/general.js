// The settings Astra had before the registry, as rows (same ids, same stored values: nothing the owner
// set is lost, and a backup or the copy kept between phones keeps its shape), and the areas Settings
// lists. Other areas' new rows live in their own files (settings/browse.js, streams.js, player.js).

import {define, defineArea} from './registry.js';
import {ORIENTATIONS} from '../player/prefs.js';

// The areas, in Settings' order. Home, Stream list and Player show once a row names them.
defineArea({id: 'motion', title: 'Motion and touch', icon: 'aspect', detail: 'Animation and haptics', order: 20});
defineArea({id: 'home', title: 'Home', icon: 'home', detail: 'Hero, rows and posters', order: 30});
defineArea({id: 'streams', title: 'Stream list', icon: 'sources', detail: 'How streams are shown and sorted', order: 40});
defineArea({id: 'player', title: 'Player', icon: 'play', detail: 'Gestures, controls, picture', order: 50});
defineArea({id: 'playback', title: 'Playback', icon: 'next', detail: 'Getting ready, skip intro, subtitles, data', order: 60});
defineArea({id: 'addons', title: 'Add-ons', icon: 'extension', detail: 'Install, order and switch on', order: 70, custom: true});
defineArea({id: 'data', title: 'Your data', icon: 'backup', detail: 'Your phones, back up, restore, clear', order: 80, custom: true});
defineArea({id: 'about', title: 'About', icon: 'info', detail: 'Version, feel report, playback lab', order: 90, custom: true});

const reloadHome = (value, app) => app?.screens?.home?.load?.();

define([
  // Home (Astra settings: they travel in a backup).
  {id: 'hero', area: 'home', title: 'Show hero', detail: 'The large rotating banner at the top', kind: 'switch', where: 'astra', default: true, apply: reloadHome},
  {id: 'showCatalogType', area: 'home', title: 'Show catalog type', detail: 'Adds “- Movie” or “- Series” to row titles', kind: 'switch', where: 'astra', default: true, apply: reloadHome},
  // Player (this phone's player preferences, player/prefs.js).
  {id: 'gestures', area: 'player', title: 'Touch gestures', detail: 'Double tap to seek, swipe for seek, brightness and volume, hold for speed', kind: 'switch', where: 'player', default: true},
  {id: 'holdSpeed', area: 'player', title: 'Hold speed', kind: 'choice', where: 'player', default: 2, options: [[1.25, '1.25x'], [1.5, '1.5x'], [2, '2x'], [3, '3x']]},
  {id: 'pauseOverlay', area: 'player', title: 'Pause overlay', detail: 'Show the title and story after 5 s paused', kind: 'switch', where: 'player', default: true},
  {id: 'aspect', area: 'player', title: 'Picture size', kind: 'choice', where: 'player', default: 'fit', options: [['fit', 'Fit'], ['fill', 'Fill'], ['zoom', 'Zoom']]},
  {id: 'orientation', area: 'player', title: 'Rotation', kind: 'choice', where: 'player', default: 'auto', options: ORIENTATIONS},
  {id: 'autoPip', area: 'player', title: 'Picture-in-picture', detail: 'Keep watching in a small window when you leave Astra, where Chrome allows it. The player’s top bar has a button for it too.', kind: 'switch', where: 'player', default: true},
  // Playback: the engine's and data's choices.
  {id: 'readyAhead', area: 'playback', title: 'Get ready ahead', detail: 'As your finger touches a stream, asks your own server for its address (it asks TorBox; nothing is added to TorBox before you tap), and prepares the next episode, so films start sooner. Uses a little data.', kind: 'switch', where: 'astra', default: true},
  {id: 'dataSaver', area: 'playback', title: 'Save mobile data', detail: 'On mobile data Astra reads less far ahead of the film.', kind: 'choice', where: 'player', default: 'auto', options: [['auto', 'Automatic'], ['always', 'Always'], ['never', 'Never']]},
  {id: 'findIntros', area: 'playback', title: 'Find intros by sound', detail: 'Works out a series’ opening and ending on this phone by comparing episodes. Nothing is sent anywhere.', kind: 'switch', where: 'astra', default: true},
  // Only ever turned on here, by the owner.
  {id: 'skipLookup', area: 'playback', title: 'Look up anime skip times', detail: 'Asks AniSkip for an episode’s opening and ending. Sends the show’s public id, the episode number and the file’s length to api.aniskip.com and api.ani.zip; nothing else.', kind: 'switch', where: 'astra', default: false},
  {id: 'openSubtitles', area: 'playback', title: 'OpenSubtitles', detail: 'Also look for subtitles on OpenSubtitles, Stremio’s subtitle add-on, as well as your installed add-ons', kind: 'switch', where: 'astra', default: true},
  // Your data. Off removes the searches kept, everywhere: an empty list is a change like any other (app/sync.js).
  {id: 'recentSearches', area: 'data', title: 'Recent searches', detail: 'Keep your last 10 searches, on every phone you keep the same', kind: 'switch', where: 'astra', default: true,
    apply: (value, app) => { if (!value && app?.store && (app.store.get('recentSearches', []) || []).length) app.store.set('recentSearches', []); }},
]);
