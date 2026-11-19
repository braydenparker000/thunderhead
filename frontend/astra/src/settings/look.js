// What must run at start-up for the settings the owner sees before any screen draws (the accent, the
// page's colour, text size, density, the nav bar, the motion level and haptics): it reads their stored
// values and sets the root's properties and attributes. Small on purpose: the full rows (titles,
// details, options) load with the Settings screen (settings/appearance.js, motion.js, general.js).

import {readableAccent, onColour, withAlpha} from './colour.js';
import {setMotionChoice, setHaptics} from '../ui/motion-core.js';

export const BACKGROUNDS = {black: '#000000', near: '#0d0d0d', tinted: '#0d0d0d'};
const TEXT = {small: 0.92, standard: 1, large: 1.12};
const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const oneOf = list => v => list.includes(v);

/** The settings applied at start: where each is kept, its default, and which values it can hold. */
export const LOOK = {
  accent: ['astra', '#f5f5f5', hex],
  background: ['astra', 'near', oneOf(Object.keys(BACKGROUNDS))],
  textSize: ['device', 'standard', oneOf(Object.keys(TEXT))],
  density: ['device', 'comfortable', oneOf(['comfortable', 'compact'])],
  navLabels: ['astra', true, v => typeof v === 'boolean'],
  navStyle: ['astra', 'floating', oneOf(['floating', 'docked'])],
  startTab: ['astra', 'home', oneOf(['home', 'search', 'library', 'settings'])],
  motion: ['device', 'system', oneOf(['system', 'full', 'reduced', 'off'])],
  haptics: ['device', 'subtle', oneOf(['off', 'subtle', 'full'])],
};

const device = app => { const d = app.store?.get('device', {}); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; };
/** A setting's value before its row is defined: one of LOOK's checked, else whatever is stored for it. */
export function lookSetting(app, id) {
  const known = LOOK[id];
  if (!known) return app.settings?.[id] ?? device(app)[id];
  const v = known[0] === 'astra' ? app.settings?.[id] : device(app)[id];
  return known[2](v) ? v : known[1];
}

const root = () => (typeof document !== 'undefined' ? document.documentElement : null);
const setVar = (name, value) => root()?.style.setProperty(name, value);

/** The accent, kept readable on the page's colour, with the text that goes on it and its soft fill. */
export function applyAccent(value, bg = BACKGROUNDS.near) {
  const accent = readableAccent(value, bg);
  setVar('--accent', accent);
  setVar('--on-accent', onColour(accent));
  setVar('--accent-soft', withAlpha(accent, 0.12));
  return accent;
}
/** The page's colour; "tinted" screens wash a title's pages with its --tint, reading data-bg on the root. */
export function applyBackground(value, app) {
  const bg = BACKGROUNDS[value] || BACKGROUNDS.near;
  setVar('--bg', bg);
  if (root()) root().dataset.bg = value;
  if (typeof document !== 'undefined') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  applyAccent(app ? lookSetting(app, 'accent') : LOOK.accent[1], bg); // the accent's contrast is against this colour
}
export const applyTextSize = value => setVar('--text-scale', String(TEXT[value] ?? 1));
export const applyDensity = value => setVar('--density', value === 'compact' ? '0.75' : '1');
export function applyNavLabels(value, app) { if (app?.root) app.root.dataset.navLabels = value ? 'on' : 'off'; }
export function applyNavStyle(value, app) { if (app?.root) app.root.dataset.nav = value; }

/** Applies every stored look setting (at start, and when another window changes them). */
export function applyLook(app) {
  const v = id => lookSetting(app, id);
  applyBackground(v('background'), app); // with the accent
  applyTextSize(v('textSize'));
  applyDensity(v('density'));
  applyNavLabels(v('navLabels'), app);
  applyNavStyle(v('navStyle'), app);
  setMotionChoice(v('motion'));
  setHaptics(v('haptics'));
}
