// The one quiet note under a stream card: how it will play on THIS phone, said before the tap, the most
// important of what applies (and nothing when all is well):
//   1. 10-bit HEVC (the label says 10-bit, Hi10, Main 10, HDR or Dolby Vision with HEVC) on a phone whose
//      browser has no hardware decoder for it: it goes to the software decoder, which is slow there;
//   2. a link Astra cannot take to TorBox directly: signed in, with a TorBox key on the owner's server, a
//      link that carries no hash (addons/link-facts.js: not in the link, `stream.torrent` or the stream's
//      text) and is not a plain file address Astra reads itself; such films usually end in Chrome's own
//      player (no choice of sound track, no subtitles inside the file), so the words say "may";
//   3. any other codec this phone's browser decodes only in software (addons/device-facts.js).
// It is a note only: nothing is reordered, dimmed, hidden or marked as preferred by it.
//
// The card is drawn once every fact is known, so a note never arrives under a finger: the browser's answers
// (asked once a visit per codec and picture size) and whether this page is signed in (addons/worker-api.js,
// read once a screen) are waited for, at most CAP ms. Whether the owner's server holds a TorBox key is not
// asked of anyone: it is learnt from the server's own steps when a press asks ahead (app/ready.js), and until
// a step says there is none, the key is taken to be there.

import {h} from '../ui/dom.js';
import {SOFTWARE, answerNow, ask, questionOf, wordsFor} from './device-facts.js';
import {linkFacts} from './link-facts.js';
import {session} from './worker-api.js';

export const TEN_BIT = '10-bit HEVC: this phone decodes it in software (slow, more battery)';
export const NO_HASH = "No hash from this source: may open in Chrome's plain player";
/** The longest a list waits for the facts its notes need before it is drawn with what is known. */
export const CAP = 300;

// A file's own address (a CDN's MKV, an HLS playlist) is read by Astra itself, hash or not; an add-on's
// playback or resolve link (the shapes link-facts.js knows) is not a file's address even when it ends in one.
const MEDIA = /\.(mkv|mp4|m4v|webm|mov|avi|ts|m2ts|mts|m3u8|mpd|ogv|wmv|flv|mpe?g|3gp)$/i;
const ADDON_PATH = /^(playback|resolve|strem|streaming_provider|debrid)$/i;

// The hash a stream carries (link-facts.js), read once per stream: a long list is drawn again at every filter change.
const hashes = new WeakMap();
const hashOf = stream => {
  if (!hashes.has(stream)) hashes.set(stream, linkFacts(stream.url, stream).hash);
  return hashes.get(stream);
};

/**
 * Whether the stream's link is one Astra cannot take to TorBox directly (the second note). Pure.
 * @param {{url?: string | null}} stream @param {{signedIn?: boolean, key?: boolean | null}} [state]
 */
export function hashless(stream, {signedIn = false, key = null} = {}) {
  if (!signedIn || key === false || !stream?.url) return false;
  let u;
  try { u = new URL(stream.url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (hashOf(stream)) return false;
  const parts = u.pathname.split('/').filter(Boolean);
  return !(MEDIA.test(parts.at(-1) || '') && !parts.some(p => ADDON_PATH.test(p)));
}

/**
 * The note for a stream's question (device-facts.js questionOf), the browser's answer to it (undefined or
 * null: none) and whether its link is hashless, the most important first; '' when there is nothing to say. Pure.
 */
export function noteFor(question, answer, noHash) {
  const words = question ? wordsFor(question, answer ?? null) : '';
  if (words === SOFTWARE && question.codec === 'hevc' && question.ten) return TEN_BIT;
  if (noHash) return NO_HASH;
  return words === SOFTWARE ? SOFTWARE : '';
}

// What the owner's server said of its TorBox key in this visit: true, false, or null (not said yet).
let keySaid = null;

/** One per Streams screen: knows what the notes need and draws them inside `root` (the list). `read` (the session) is for tests. */
export class Notes {
  constructor(root = null, {read = session} = {}) {
    this.root = root;
    this.signedIn = null;
    this.ready = Promise.resolve().then(read).then(s => { this.signedIn = !!s; }, () => { this.signedIn = false; });
    this.late = new Set(); // questions the browser did not answer within CAP: drawn as unanswered
    this.waiting = null;
  }

  /** Null when every fact for these streams' notes is known, else a promise that settles when they are, or at CAP. */
  pending(streams) {
    const open = [];
    for (const s of streams) {
      const q = s.url ? questionOf(s) : null;
      if (q && answerNow(q) === undefined && !this.late.has(q.key)) open.push(q);
    }
    if (this.signedIn !== null && !open.length) return null;
    this.waiting ??= Promise.race([Promise.all([this.ready, ...open.map(ask)]), new Promise(r => setTimeout(r, CAP))]).then(() => {
      this.waiting = null;
      this.signedIn ??= false; // a session that cannot be read in time: no hashless note, as signed out
      for (const q of open) if (answerNow(q) === undefined) this.late.add(q.key);
    });
    return this.waiting;
  }

  /** The note's words for a stream. */
  of(stream) {
    const q = questionOf(stream);
    return noteFor(q, q ? answerNow(q) : null, hashless(stream, {signedIn: !!this.signedIn, key: keySaid}));
  }

  /** The note's line for a playable stream, or null when there is nothing to say. */
  mark(stream) {
    const words = this.of(stream);
    return words ? h('span', {class: 'stream-plays' + (words === NO_HASH ? ' route' : ' heavy')}, words) : null;
  }

  /** A press's answer from the owner's server (addons/debrid.js): its steps say whether a TorBox key is set. */
  learn(answer) {
    const step = Array.isArray(answer?.steps) ? answer.steps.find(s => s?.step === 'key') : null;
    if (!step) return;
    keySaid = step.ok === true;
    // No key: no link reaches TorBox directly, so "no hash" says nothing; its words go (the line keeps its room).
    if (!keySaid) for (const el of this.root?.querySelectorAll('.stream-plays.route') || []) el.textContent = '';
  }
}
