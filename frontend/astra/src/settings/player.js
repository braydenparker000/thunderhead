// Settings › Player: how the player looks and answers on this phone. Every row lives in the player's
// own prefs (where: 'player', player/prefs.js, which keeps them with the device and a restore keeps
// them). The player's older prefs (gestures, the master switch for the gestures below; holdSpeed,
// pauseOverlay, aspect, orientation, autoPip, dataSaver) are rows of the Settings pages already, with
// the same ids: they are not defined again here. A change reaches an open player at once (registry.js
// writes app.player.prefs), and `look` redraws what shows it.

import {define} from './registry.js';

/** Redraws what a setting changes in an open player (its own module is loaded with it: nothing loads here). */
const look = (value, app) => {
  const p = app?.player;
  if (p?.isOpen) import('../player/view.js').then(({applyLook}) => applyLook(p), () => {});
};
const on = (id, title, detail, def = true) => ({id, area: 'player', title, detail, kind: 'switch', where: 'player', default: def, apply: look});
const choice = (id, title, detail, options, def) => ({id, area: 'player', title, detail, kind: 'choice', where: 'player', options, default: def, apply: look});

define([
  // Controls
  choice('controlsHideAfter', 'Hide controls after', 'How long the controls stay after your last touch. They never hide while a menu is open, while you drag, or while the film waits.',
    [[2, '2 s'], [3, '3 s'], [5, '5 s'], [8, '8 s'], [0, 'Never']], 3),
  on('controlsHidePaused', 'Hide while paused', 'Let the controls hide when the film is paused, too.', false),
  choice('timeShows', 'Time shows', 'Beside the seek bar: how far in, and either the length or the time left. Tapping the time switches it.',
    [['total', 'Elapsed and length'], ['remaining', 'Elapsed and time left']], 'total'),
  on('seekSnap', 'Settle on marks', 'Dragging the seek bar settles on chapters and on skip marks near your finger, with a tick you can feel.'),
  // Top bar
  on('topPip', 'Picture in picture button', 'In the top bar.'),
  on('topSpeed', 'Speed button', 'The speed, in the top bar; it opens Playback.', false),
  on('topSleep', 'Sleep timer button', 'In the top bar; it opens Playback, where the timer is.', false),
  on('topLock', 'Lock button', 'In the top bar: locks the screen against touches while you watch.'),
  on('topRotate', 'Rotate button', 'In the top bar: turns the player for this film.'),
  // Gestures
  on('gestureDoubleTap', 'Double tap to seek', 'On the left or right of the picture; taps that follow add up.'),
  choice('seekStep', 'Double tap seconds', 'How far a double tap, an arrow key or the ± buttons jump.', [[5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s']], 10),
  on('gestureSwipeSeek', 'Swipe across to seek', 'Slide left or right over the picture.'),
  on('gestureBrightness', 'Swipe for brightness', 'Up or down on the left of the picture.'),
  on('gestureVolume', 'Swipe for volume', 'Up or down on the right of the picture.'),
  on('gestureHold', 'Hold for speed', 'Press and hold the picture to play faster until you let go.'),
  on('gesturePinch', 'Pinch to zoom', 'Two fingers enlarge the picture; drag to move it.'),
  // Menus and offers
  choice('menuDock', 'Menus held sideways', 'On a wide screen held sideways, menus can dock to the right and leave the film showing beside them.',
    [['auto', 'Dock to the side'], ['bottom', 'Rise from the bottom']], 'auto'),
  choice('nextCountdown', 'Next episode card', 'Near the end, how long the next-episode card stays without the controls before it tucks away (a ring counts it down). It never plays by itself.',
    [[0, 'Stays'], [5, '5 s'], [10, '10 s'], [15, '15 s']], 10),
  on('seekPreviews', 'Seek previews', 'A picture of where a seek lands. Each one downloads a little of the film; none with the data saver on.'),
]);
