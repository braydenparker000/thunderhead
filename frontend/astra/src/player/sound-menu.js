// The Sound tab of the audio menu: volume boost, night mode, clearer speech,
// even loudness, headphone surround and the sound's timing against the
// picture (enhance/sound.js does the work). All but the timing are prefs, put
// back on every film they can be; the timing belongs to one title and starts
// at 0 with the next, like the subtitle delay. Even loudness remembers each
// title's settled gain (prefs.levels), so the next play starts at it. One
// Sound per player, made on the first change that needs it.
//
// Headphone surround is offered only for sound that reaches the page with a
// centre and surrounds: not for a track the engine converts (it arrives mixed
// to stereo) nor for the software decoder (its chain gets stereo).
//
// Where the engine does part of the job, it is asked to (each call only when
// the engine has the method): a track the engine converts (Dolby Digital,
// DTS: delivery 'rebuilt') reaches the page already mixed to stereo, so its
// centre is lifted by engine.setDialogue; sound EARLIER than the picture is
// engine.setAudioAdvance (the page's own delay can only make it later); and
// the software decoder, whose sound never passes through the <video>, takes
// the same chain into its own sound path through engine.routeSoftwareSound.
//
// The level bar and the remembered volume stay 0-100 %: a boost shows as its
// own small chip ("Boost 200 %") where the "Sound off" chip sits, so loud
// sound never comes as a surprise; a tap on it opens this tab.

import {h} from '../ui/dom.js';
import {Sound, whyNot} from '../enhance/sound.js';
import {SoundChain, settle, isOff} from '../enhance/sound-chain.js';
import {savePrefs} from './prefs.js';
import {startLevel, remember} from '../enhance/loudness.js';
import {placeable} from '../enhance/headphone.js';

export const BOOSTS = [1, 1.5, 2, 3];
export const DIALOGUE = [[0, 'Off'], [1, '+1'], [2, '+2']];
const STEP = 0.05;
const has = (e, name) => typeof e?.[name] === 'function';
/** The timing shown: "0.00 s", "+0.25 s" (later), "−0.50 s" (earlier). */
export const delayLabel = d => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(2) + ' s';
/** One step of the timing stepper, kept on the 0.05 s grid and inside [min, 1]. */
export const nudgeDelay = (d, by, min = -1) => Math.min(1, Math.max(min, Math.round((d + by) * 20) / 20)) || 0;

/** whyNot()'s reason in the owner's words. */
export function plainWhy(why) {
  if (!why) return '';
  if (/software decoder/i.test(why)) return 'The software decoder playing this film cannot change its sound yet.';
  if (/host/i.test(why)) return 'This film comes straight from its host, which does not let Astra change its sound.';
  return why;
}

export class SoundControl {
  constructor(p) {
    this.p = p;
    this.sound = null; this.chain = null; // the chain inside the software decoder, when it took one
    this.delay = 0; this.title = null;
    this.chip = h('button', {class: 'ap-boost', type: 'button', hidden: true, onclick: () => this.openTab()});
    p.root.append(this.chip);
    p.engine.addEventListener('ready', () => this.apply());
    p.engine.addEventListener('tracks', () => { if (p.ready) this.apply(); }); // another track: rebuilt or not
  }

  /** What the owner asked for: the saved prefs and this title's timing. */
  get wanted() { const s = this.p.prefs; return {boost: settle(s).boost, night: !!s.night, dialogue: settle(s).dialogue, delay: this.delay, loudness: !!s.loudness, headphones: !!s.headphones}; }
  get rebuilt() { return this.p.engine.audioOptions?.().find(a => a.selected)?.delivery === 'rebuilt'; }
  // Only where the engine fills the sound buffer itself (remux): elsewhere it accepts the value and does nothing.
  get advance() { return has(this.p.engine, 'setAudioAdvance') && this.p.engine.mode === 'remux'; }

  /** '' when the sound can be changed now, else why not (plain words). */
  why() {
    const p = this.p, e = p.engine;
    if (!p.ready) return 'The sound can be changed once the film has started.';
    if (e.mode === 'software') return has(e, 'routeSoftwareSound') ? '' : plainWhy('software decoder');
    return plainWhy(whyNot(p.video, e.mode));
  }

  /** A film or episode opens: a new title starts with the sound on time. */
  opened(o) {
    const key = o.meta?.id || o.meta?.title || '';
    if (key !== this.title) { this.title = key; this.delay = 0; }
    this.fresh = true; // the loudness measure starts again with each film or episode
    this.chip.hidden = true; // until this film is ready and the boost is on its sound
  }

  /** Puts the wanted sound on the film playing; one that cannot take it simply plays as it is. */
  apply() {
    const p = this.p, e = p.engine, w = this.wanted;
    const engineDialogue = this.rebuilt && has(e, 'setDialogue');
    if (has(e, 'setDialogue')) e.setDialogue(engineDialogue ? w.dialogue : 0);
    if (this.advance) e.setAudioAdvance(w.delay < 0 ? -w.delay : 0);
    const chain = this.chainSettings();
    if (this.load !== e.load_) { this.load = e.load_; this.chain = null; this.routed = false; } // a new load builds a new sound path
    if (this.sound) this.sound.mode = e.mode;
    if (e.mode === 'software') {
      if (this.chain) this.chain.apply(chain, 2);
      else if (!this.routed && !isOff(settle(chain)) && has(e, 'routeSoftwareSound')) {
        // Once per load (the engine keeps makeChain for every sound path it builds), or again later if the film had no sound path yet.
        this.routed = e.routeSoftwareSound(ctx => {
          this.chain = new SoundChain(ctx, {onSettle: (id, db) => this.settled(id, db)}); // libmedia's volume comes after the chain: nothing to take out
          this.chain.film(this.title, startLevel(p.prefs.levels, this.title)); this.fresh = false;
          this.chain.apply(this.chainSettings(), 2); this.showChip(); return this.chain;
        }) !== false;
      }
    } else if (!this.why() && (this.sound || !isOff(settle(chain)))) {
      this.sound ??= new Sound(p.video, {onReport: r => this.reported(r), onSettle: (id, db) => this.settled(id, db)});
      this.sound.mode = e.mode;
      this.sound.set(chain);
    }
    const target = e.mode === 'software' ? this.chain : this.sound;
    if (this.fresh && target) { this.fresh = false; target.film(this.title, startLevel(p.prefs.levels, this.title)); }
    this.showChip();
  }

  chainSettings() { const w = this.wanted; return {...w, dialogue: this.rebuilt && has(this.p.engine, 'setDialogue') ? 0 : w.dialogue, delay: Math.max(0, w.delay)}; }

  /** A title's loudness gain has settled: remembered, so its next play starts there. */
  settled(id, db) { const p = this.p; p.prefs.levels = remember(p.prefs.levels, id, db); savePrefs(p.prefs); }

  /** Whether the sound reaching the page has a centre and surrounds to place: what the chain counted, else what the track says. */
  surround() {
    const e = this.p.engine;
    if (!this.p.ready || e.mode === 'software' || this.rebuilt) return false;
    const counted = this.sound?.state().channels;
    if (counted) return placeable(counted);
    const track = e.audio?.find?.(a => a.id === e.selectedAudio), n = track?.option?.track?.channels;
    return n ? placeable(n) : /\b[5-7]\.1\b/.test(track?.label || '');
  }

  // The Sound object's own reports: only one that changes what is heard is worth a notice.
  reported(reason) { if (/without sound|silent/i.test(reason)) this.p.notice(reason); }

  /** A change from this tab: saved (boost, night, dialogue) or kept for this title (timing), then applied. */
  change(patch) {
    const p = this.p;
    if ('delay' in patch) this.delay = patch.delay;
    const prefs = Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'delay'));
    if (Object.keys(prefs).length) { Object.assign(p.prefs, prefs); savePrefs(p.prefs); }
    this.apply();
    p.menus.renderModal();
  }

  /** Whether a boost is on the sound being heard now. */
  boosted() {
    const b = this.wanted.boost;
    if (b <= 1 || !this.p.ready) return false;
    return this.p.engine.mode === 'software' ? !!this.chain : !!this.sound && !this.why() && this.sound.state().settings.boost > 1;
  }

  showChip() {
    const on = this.boosted(), text = `Boost ${Math.round(this.wanted.boost * 100)} %`;
    if (this.chip.hidden === on) this.chip.hidden = !on;
    if (on && this.chip.textContent !== text) { this.chip.textContent = text; this.chip.setAttribute('aria-label', `${text}. Open the sound settings`); }
    this.p.root.classList.toggle('boosted', on);
  }

  openTab() { this.p.menus.audioTab = 'sound'; this.p.menus.openModal('audio'); }

  /** The tab's content. */
  body() {
    const w = this.wanted, why = this.why(), off = !!why;
    const chip = (label, on, onclick, extra = {}) => h('button', {class: 'ap-chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), disabled: off, onclick, ...extra}, label);
    const group = (title, ...children) => h('div', {class: 'ap-pb-group'}, h('span', {class: 'ap-label'}, title), ...children);
    // A switch with its line beside it rather than under it: six groups fit a landscape phone with less scrolling.
    const toggle = (key, title, note) => h('div', {class: 'ap-pb-group'}, h('span', {class: 'ap-label'}, title), h('div', {class: 'ap-sound-switch'},
      chip(w[key] ? 'On' : 'Off', w[key], () => this.change({[key]: !w[key]}), {role: 'switch', 'aria-pressed': null, 'aria-checked': String(w[key]), 'aria-label': title}), h('p', {class: 'ap-pb-note'}, note)));
    const min = this.advance ? -1 : 0, d = this.delay, nudge = by => () => this.change({delay: nudgeDelay(d, by, min)});
    return h('div', {class: 'ap-sound'}, why ? h('p', {class: 'ap-sound-why', role: 'note'}, why) : null, h('div', {class: 'ap-pb'},
      group('Volume boost', h('div', {class: 'ap-chips'}, ...BOOSTS.map(b => chip(`${b * 100} %`, b === w.boost, () => this.change({boost: b}), {'aria-label': `Volume boost ${b * 100} %`})))),
      toggle('night', 'Night mode', 'Quiet sound comes up and loud bangs go down, for watching late.'),
      toggle('loudness', 'Even loudness', 'Every film at the same loudness, so the volume can stay put.'),
      this.surround() ? toggle('headphones', 'Headphone surround', 'For headphones: places the film\'s speakers around you.') : null,
      group('Dialogue', h('div', {class: 'ap-chips'}, ...DIALOGUE.map(([v, label]) => chip(label, v === w.dialogue, () => this.change({dialogue: v}), {'aria-label': v ? `Dialogue ${label}` : 'Dialogue off'}))),
        h('p', {class: 'ap-pb-note'}, 'Lifts voices over music and effects.')),
      group('Sound delay', h('div', {class: 'ap-step wrap'}, h('div', {},
        chip('−', false, nudge(-STEP), {'aria-label': 'Sound earlier', 'aria-pressed': null, disabled: off || d <= min}), h('b', {class: 'ap-sound-delay'}, delayLabel(d)),
        chip('+', false, nudge(STEP), {'aria-label': 'Sound later', 'aria-pressed': null, disabled: off || d >= 1}),
        h('button', {class: 'ap-chip ghost', type: 'button', disabled: off || !d, onclick: () => this.change({delay: 0})}, 'Reset'))),
        h('p', {class: 'ap-pb-note'}, this.advance ? 'Minus: the sound comes earlier. Plus: later. For this film only.' : 'Plus: the sound comes later. For this film only.'))));
  }

  close() { this.chip.hidden = true; }
}
