// Getting ready before the owner's tap, on the Streams screen: what a tap will need is asked for while the
// list is read, so the picture comes sooner. Nothing plays and nothing is chosen here: Astra never ranks,
// picks or pre-selects a stream. When streams are listed, only a connection to the owner's own server is
// opened (signed in); a finger coming down on a stream asks that server for its address with mode 'ahead'
// (addons/debrid.js: it answers only from what is already in the owner's TorBox account, so nothing is
// added to TorBox before a tap) and the tap then takes that answer; and the sound converter a listed stream
// would need is fetched. All of it stays in memory; none of it happens with Settings › Playback › "Get
// ready ahead" off, or with the data saver on.

import {dropHashes} from '../addons/stream-text.js';
import {resolveStream} from '../addons/debrid.js';
import {apiOrigin} from '../addons/worker-api.js';
import {saverOn} from '../engine/player-data.js';
import {loadPrefs} from '../player/prefs.js';

// Sound a label names that Astra converts on most phones, and the codec string the planner would ask about.
const SOUNDS = [
  ['truehd', /true[ ._-]?hd/i, 'mlpa'],
  ['dts', /(?<![a-z])dts/i, 'dtsc'],
  ['eac3', /(?<![a-z0-9])(dd\+|ddp|e-?ac-?3|dolby digital plus)/i, 'ec-3'],
  ['ac3', /(?<![a-z0-9])(dd(?![a-z+])|ac-?3|dolby digital(?! plus))/i, 'ac-3'],
];

/** The setting: on unless the owner turned it off (stored with Astra's settings, so it travels in a backup). */
export const aheadSetting = settings => settings?.readyAhead !== false;

/** Whether the data saver is on now, as the player would put it (player prefs' dataSaver, then the connection). */
export function saverNow(prefs = loadPrefs(), connection = globalThis.navigator?.connection) {
  const d = prefs?.dataSaver;
  return saverOn(d === 'always' ? true : d === 'never' ? false : 'auto', connection);
}

/** The first sound codec a stream's label names that Astra converts, or null. */
export function soundOf(stream) {
  const text = dropHashes(`${stream?.name || ''} ${stream?.title || ''} ${stream?.description || ''}`); // a hash's letters are not a format
  if (/(?<![a-z])(aac|opus|flac)(?![a-z])/i.test(text) && !/true[ ._-]?hd|dts|dd\+|ddp|ac-?3/i.test(text)) return null;
  return SOUNDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

const httpsLink = url => { try { return new URL(url).protocol === 'https:'; } catch { return false; } };

/**
 * What to do ahead for the streams on screen, pure: `preconnect` when any has a link the owner's server
 * could be asked about (https), `sounds` the converters a label asks for (still to be checked against
 * this phone), `metered` when the connection is metered. Nothing at all when the setting is off or the
 * data saver on.
 */
export function readyWork(streams, {ahead = true, saver = false, connection = globalThis.navigator?.connection} = {}) {
  const none = {preconnect: false, sounds: [], metered: false};
  if (!ahead || saver) return none;
  const sounds = [...new Set(streams.filter(s => s?.url).map(soundOf).filter(Boolean))];
  return {preconnect: streams.some(s => httpsLink(s?.url)), sounds, metered: !!(connection?.saveData || connection?.type === 'cellular')};
}

/** Whether the planner would convert this sound on this phone (plan.js audioDelivery), with the engine's own answers. */
async function converted(codec) {
  const [{audioDelivery}, {mseSupports}, {passFailed}] = await Promise.all([import('../engine/plan.js'), import('../engine/capabilities.js'), import('../engine/route-memory.js')]);
  const codecString = SOUNDS.find(([c]) => c === codec)[2];
  return audioDelivery({codec, codecString, channels: 6}, {mse: mseSupports, opusEncode: true, passFailed}).delivery === 'rebuilt';
}

/** Whether a converter is already in the site's saved copy (the service worker's caches), so fetching it costs nothing. */
async function saved(codec) {
  const file = codec === 'dts' ? 'dts' : codec === 'truehd' ? 'truehd' : 'ac3';
  try { return !!await globalThis.caches?.match(new URL(`../../vendor/mediabunny-${file}.js`, import.meta.url).href); } catch { return false; }
}

/** A `<link rel="preconnect">` to an origin, once; anonymous, as the reads that follow are made (no cookies). */
export function preconnect(origin, doc = globalThis.document) {
  if (!doc?.head || !/^https?:\/\/[^/]+$/.test(origin) || doc.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return false;
  const link = doc.createElement('link');
  Object.assign(link, {rel: 'preconnect', href: origin, crossOrigin: 'anonymous'});
  doc.head.append(link);
  return true;
}

const originOf = url => { try { const u = new URL(url); return u.protocol === 'https:' ? u.origin : ''; } catch { return ''; } };

/** One per Streams screen (and the player's episode switch never makes one: it is headless). */
export class ReadyAhead {
  /**
   * @param {{settings: object}} app
   * @param {{prefs?: () => object, connection?: object, doc?: Document, resolve?: typeof resolveStream, origin?: () => Promise<string>}} [options]
   */
  constructor(app, {prefs = () => loadPrefs(), connection = globalThis.navigator?.connection, doc = globalThis.document, resolve = resolveStream, origin = () => apiOrigin()} = {}) {
    Object.assign(this, {app, prefs, connection, doc, resolve, origin});
    this.sounds = new Set(); // converters already decided on for this screen
    this.connecting = false; // the server's connection is opened once a screen
  }

  /** The switch is on and the data saver off. */
  allowed() { return aheadSetting(this.app.settings) && !saverNow(this.prefs(), this.connection); }

  /** The streams on screen changed: whatever they will need is asked for, once. */
  listed(streams) {
    const work = readyWork(streams, {ahead: aheadSetting(this.app.settings), saver: saverNow(this.prefs(), this.connection), connection: this.connection});
    // Only a connection to the owner's server (signed in): nothing is asked of it, or of TorBox, before a press.
    if (work.preconnect && !this.connecting) {
      this.connecting = true;
      this.origin().then(o => { if (o) preconnect(o, this.doc); }, () => {});
    }
    for (const codec of work.sounds) {
      if (this.sounds.has(codec)) continue;
      this.sounds.add(codec);
      (async () => {
        if (!await converted(codec) || (work.metered && !await saved(codec))) return;
        await (await import('../engine/audio-decoders.js')).loadDecoders(codec);
      })().catch(() => {}); // the film that needs it fetches it again
    }
    return work;
  }

  /**
   * A finger came down on a stream card: its address is asked for now with mode 'ahead' (which never adds
   * anything to TorBox), and the tap that follows takes the answer when it has an address (addons/debrid.js
   * keeps it 45 minutes), else asks to play. A press that becomes a scroll or a long-press leaves the answer
   * there and starts nothing else. Returns the answer's promise, or null when nothing was started.
   */
  pressed(stream) {
    if (!httpsLink(stream?.url) || !this.allowed()) return null;
    const answer = this.resolve(stream, {mode: 'ahead'});
    // The file's host is known now: its connection is opened too (an origin only, never the address).
    answer.then(a => { const o = originOf(a?.url); if (o && a.via !== 'addon') preconnect(o, this.doc); }, () => {});
    return answer;
  }
}
