// The Playback menu, opened by the Speed button (which keeps showing the
// speed): speed chips from 0.5× to 2×, the sleep timer (sleep.js), A–B
// repeat (repeat.js), Sound only (sound-only.js) and Seek previews (seek-preview.js). The speed is a pref:
// kept for every later film and put back on each load, since a new source
// resets the element's rate. Pitch is kept at any speed. Hold-for-2× plays
// over it and gives it back on release (surface.js).

import {h} from '../ui/dom.js';
import {savePrefs, SPEEDS} from './prefs.js';
import {normalSpeed, SLEEP_CHOICES} from './rules.js';

const SLEEP_LABELS = {0: 'Off', 15: '15 min', 30: '30 min', 45: '45 min', 60: '60 min', episode: 'End of episode'};
const speedText = s => `${s}x`;

export class Playback {
  constructor(p) {
    this.p = p;
    // A new source resets the rate (to defaultPlaybackRate, which is set too): it is put back as soon as the file is known.
    p.video.addEventListener('loadedmetadata', () => this.applySpeed());
  }

  get speed() { return normalSpeed(this.p.prefs.speed); }

  applySpeed() {
    const p = this.p, v = p.video, s = this.speed;
    try {
      v.preservesPitch = true;
      v.defaultPlaybackRate = s;
      if (!p.touch.holding && v.playbackRate !== s) v.playbackRate = s;
    } catch {}
    p.speedBtn.textContent = `Speed ${p.touch.holding ? s : v.playbackRate}x`;
  }

  setSpeed(s) {
    const p = this.p;
    p.prefs.speed = normalSpeed(s);
    savePrefs(p.prefs);
    this.applySpeed();
    p.menus.renderModal();
  }

  setPreviews(on) {
    this.p.prefs.seekPreviews = on;
    savePrefs(this.p.prefs);
    this.p.menus.renderModal();
  }

  body() {
    const p = this.p, x = p.extras, speed = this.speed;
    const chip = (label, on, onclick, extra = {}) => h('button', {class: 'ap-chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), onclick, ...extra}, label);
    const group = (title, ...children) => h('div', {class: 'ap-pb-group'}, h('span', {class: 'ap-label'}, title), ...children);
    const sleepOn = x.sleep.choice, previews = p.prefs.seekPreviews !== false;
    return [h('h3', {}, 'Playback'), h('div', {class: 'ap-pb'},
      group('Speed', h('div', {class: 'ap-chips'}, ...SPEEDS.map(s => chip(speedText(s), s === speed, () => this.setSpeed(s), {'aria-label': `Speed ${s}`})))),
      group('Sleep timer', h('div', {class: 'ap-chips'}, ...SLEEP_CHOICES.map(c => chip(SLEEP_LABELS[c], c === sleepOn, () => { x.sleep.set(c); p.menus.renderModal(); }, {'aria-label': c ? `Sleep timer ${SLEEP_LABELS[c]}` : 'Sleep timer off'}))),
        h('p', {class: 'ap-pb-note ap-sleep-status'}, x.sleep.text())),
      group('Repeat a part', h('div', {class: 'ap-chips'}, chip(x.repeat.label, !!x.repeat.range, () => { x.repeat.press(); p.menus.renderModal(); })),
        h('p', {class: 'ap-pb-note'}, x.repeat.status)),
      group('Sound only', h('div', {class: 'ap-chips'}, chip(x.soundOnly.on ? 'On' : 'Off', x.soundOnly.on, () => x.soundOnly.set(!x.soundOnly.on), {role: 'switch', 'aria-pressed': null, 'aria-checked': String(x.soundOnly.on), 'aria-label': 'Sound only'})),
        h('p', {class: 'ap-pb-note'}, 'Black screen and the phone may sleep; the sound plays on.')),
      group('Seek previews', h('div', {class: 'ap-chips'}, chip(previews ? 'On' : 'Off', previews, () => this.setPreviews(!previews), {role: 'switch', 'aria-pressed': null, 'aria-checked': String(previews), 'aria-label': 'Seek previews'})),
        h('p', {class: 'ap-pb-note'}, 'A picture of where a seek lands. Each one downloads a little of the film; none with the data saver on.')))];
  }
}
