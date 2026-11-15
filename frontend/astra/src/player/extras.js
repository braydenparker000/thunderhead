// The player's added capabilities, each in its own module, gathered so the
// screen (player-screen.js) has three calls to make: opened() for each film
// or episode, setSegments() when skip times arrive late, and close().
//   playback.js   the Playback menu and the speed
//   sleep.js      the sleep timer          repeat.js   A–B repeat
//   sound-only.js the black screen         resume.js   "Start over"
//   marks.js      marks on the seek bar    frames.js   frame step, save a still
//   find.js       search the subtitles     info-extras.js  data used, chapters
// The second subtitle's layer is handed to the engine when it can draw one
// (engine.setSecondLayer); zoom lives with the gestures (surface.js).

import {Playback} from './playback.js';
import {Sleep} from './sleep.js';
import {Repeat} from './repeat.js';
import {SoundOnly} from './sound-only.js';
import {Resume} from './resume.js';
import {Marks} from './marks.js';
import {Frames} from './frames.js';
import {Find} from './find.js';
import {InfoExtras} from './info-extras.js';
import {h} from '../ui/dom.js';

export class Extras {
  constructor(p) {
    this.p = p;
    // Their styles, beside player.css (the pages link that one).
    if (!document.querySelector('link[data-ap-extras]')) document.head.append(h('link', {rel: 'stylesheet', href: new URL('./player-extras.css', import.meta.url).href, 'data-ap-extras': ''}));
    this.playback = new Playback(p);
    this.sleep = new Sleep(p);
    this.repeat = new Repeat(p);
    this.soundOnly = new SoundOnly(p);
    this.resume = new Resume(p);
    this.marks = new Marks(p);
    this.frames = new Frames(p);
    this.find = new Find(p);
    this.info = new InfoExtras(p);
    Object.assign(p.menus.bodies, {playback: () => this.playback.body(), find: () => this.find.body()});
    if (typeof p.engine.setSecondLayer === 'function') p.engine.setSecondLayer(p.subs2El);
  }

  /**
   * A film or an episode opens (also the next one, in the same session): the
   * saved volume and speed go on it, a repeat from before is dropped, and a
   * resume is offered a way back to the start. The sleep timer and Sound only
   * carry on until the player closes.
   */
  opened(o) {
    const p = this.p, v = p.video, volume = p.prefs.volume;
    if (Number.isFinite(volume)) v.volume = Math.max(0, Math.min(1, volume)); // 0 shows the "Sound off" chip
    this.playback.applySpeed();
    this.repeat.clear();
    this.resume.opened(o);
    this.soundOnly.named();
    this.marks.render();
  }

  close() {
    for (const part of [this.sleep, this.soundOnly, this.resume, this.find, this.info]) part.close();
    this.repeat.clear();
  }
}
