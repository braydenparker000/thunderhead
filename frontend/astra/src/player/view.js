// The player's elements, built once and handed back by name, and the two
// things that depend on the screen's size and the title: the meta block with
// its row of buttons, and the measuring that fits subtitles to the picture.
// Every handler calls back into the screen `p` (player-screen.js).

import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';
import {level} from '../ui/motion.js';
import {savePrefs} from './prefs.js';
import {seekStep} from './gestures.js';
import {WAITING} from './loading.js';

const drawn = new WeakMap();
/**
 * Sets a style property (or an aria- attribute) only when its value changes:
 * what runs on every timeupdate then writes nothing to the page. The value
 * is compared with the last one set here, not read back (the browser rewrites
 * "2.50%" as "2.5%").
 */
export function put(el, key, value) {
  const last = drawn.get(el) || {};
  if (last[key] === value) return;
  last[key] = value; drawn.set(el, last);
  if (key.startsWith('aria-')) el.setAttribute(key, value); else el.style[key] = value;
}

export const iconButton = (name, label, onclick, extra = {}) => h('button', {class: 'ap-icon-btn', type: 'button', 'aria-label': label, title: label, onclick, ...extra}, icon(name, {text: extra.iconText}));

// The sleep timer's button (the icon set has no moon): a crescent, drawn here.
const moon = () => {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '24'], ['height', '24'], ['aria-hidden', 'true'], ['class', 'icon']]) svg.setAttribute(k, v);
  path.setAttribute('d', 'M14.5 3a8.5 8.5 0 1 0 6.4 14.1A7 7 0 0 1 14.5 3z');
  svg.append(path);
  return svg;
};
const seekLabel = (sign, s) => `${sign < 0 ? 'Back' : 'Forward'} ${s} seconds`;

/** Builds the player under p.parent (hidden) and returns its elements by name. */
export function build(p) {
  const r = {};
  const video = r.video = h('video', {class: 'ap-video', playsinline: true, preload: 'auto'});
  video.setAttribute('playsinline', '');
  const subs = r.subsEl = h('div', {class: 'ap-subs'});
  r.subs2El = h('div', {class: 'ap-subs second'}); // a second subtitle track, above the first (the engine draws it, where it can)
  r.dim = h('div', {class: 'ap-dim', 'aria-hidden': 'true'}); // darkens the picture (the brightness swipe), not the subtitles
  r.pictureLayer = h('div', {class: 'ap-picture-layer', 'aria-hidden': 'true'}); // over the video, under the subtitles: the picture filter's canvas
  // The video and what is drawn over the picture, in one element: zooming moves them together (zoom.js).
  // The subtitles stay out of it, so a zoomed picture keeps them readable and on screen.
  r.stage = h('div', {class: 'ap-stage'}, video, r.pictureLayer, r.dim);

  // Feedback
  r.feedback = h('div', {class: 'ap-feedback', 'aria-live': 'polite'});
  r.seekPreview = h('div', {class: 'ap-seek-preview', hidden: true}, h('b'), h('span'));
  // The brightness and volume gauges and the double tap's ripples are gauges.js's.

  // Loading
  r.loadingArt = h('div', {class: 'ap-loading-art'});
  r.loadingLogo = h('div', {class: 'ap-loading-logo'});
  r.loadingStatus = h('p', {class: 'ap-loading-status', role: 'status'});
  r.loadingInfo = h('p', {class: 'ap-loading-info'});
  r.loadingSlow = h('div', {class: 'ap-loading-slow', hidden: true});
  r.loading = h('div', {class: 'ap-loading'}, r.loadingArt, r.loadingLogo,
    h('div', {class: 'ap-loading-foot'}, r.loadingStatus, r.loadingInfo, r.loadingSlow),
    iconButton('close', 'Close player', () => p.close('user'), {class: 'ap-icon-btn ap-loading-close'}));

  // Controls
  r.titleEl = h('h2', {class: 'ap-title'});
  r.episodeEl = h('p', {class: 'ap-episode-line'});
  r.releaseEl = h('p', {class: 'ap-release'});
  r.viaEl = h('p', {class: 'ap-via'});
  r.played = h('div', {class: 'ap-played'});
  r.buffered = h('div', {class: 'ap-buffered'});
  // A thumb at the play position, and while dragging a time bubble above the finger.
  r.thumb = h('div', {class: 'ap-thumb', 'aria-hidden': 'true'});
  r.bubble = h('div', {class: 'ap-bubble', 'aria-hidden': 'true', hidden: true});
  r.timeline = h('div', {class: 'ap-timeline', role: 'slider', tabindex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0},
    r.track = h('div', {class: 'ap-track'}, r.buffered, r.played, r.marks = h('div', {class: 'ap-marks', 'aria-hidden': 'true'})), r.thumb, r.bubble);
  // Elapsed and the length, or elapsed and what is left: a tap switches, and is remembered (Settings › Player › Time shows).
  r.timeEl = h('button', {class: 'ap-time', type: 'button', onclick: () => { p.prefs.timeShows = p.prefs.timeShows === 'remaining' ? 'total' : 'remaining'; savePrefs(p.prefs); p.updateTime(); }});
  r.playBtn = iconButton('play', 'Play', () => p.togglePlay(), {class: 'ap-icon-btn ap-play'});
  // Waiting for data mid-film (controls.js setBuffering): a thin moving line at the bar, words after a while.
  r.waitWords = h('p', {class: 'ap-wait-words', role: 'status', hidden: true}, WAITING);
  r.waitBox = h('div', {class: 'ap-wait', hidden: true}, r.waitWords, h('div', {class: 'ap-wait-line', role: 'progressbar', 'aria-label': 'Loading'}, h('i')));
  r.speedBtn = h('button', {class: 'ap-text-btn', type: 'button', 'aria-haspopup': 'dialog', onclick: () => p.menus.openModal('playback')}, 'Speed 1x');
  r.sleepEl = h('p', {class: 'ap-sleep-left', hidden: true}); // the sleep timer's time left, quietly
  r.actions = h('div', {class: 'ap-actions'});
  r.actionButtons = {
    next: iconButton('next', 'Next episode', () => p.markers.playNext()),
    subtitles: iconButton('subtitles', 'Subtitles', () => p.menus.openModal('subtitles')),
    audio: iconButton('audio', 'Audio', () => p.menus.openModal('audio')),
    sources: iconButton('sources', 'Sources', () => p.openPanel('sources')),
    episodes: iconButton('episodes', 'Episodes', () => p.openPanel('episodes')),
    speed: r.speedBtn,
    aspect: iconButton('aspect', 'Picture size', () => p.cycleAspect()),
    info: iconButton('info', 'Stream info', () => p.menus.openModal('info')),
  };
  r.pipBtn = iconButton('pip', 'Picture in picture', () => p.system.togglePip());
  // The top bar's optional buttons (Settings › Player › Top bar): the speed and the sleep timer open the Playback menu.
  r.topSpeedBtn = h('button', {class: 'ap-icon-btn ap-top-speed', type: 'button', 'aria-label': 'Playback speed', 'aria-haspopup': 'dialog', onclick: () => p.menus.openModal('playback')}, '1×');
  r.topSleepBtn = h('button', {class: 'ap-icon-btn', type: 'button', 'aria-label': 'Sleep timer', title: 'Sleep timer', 'aria-haspopup': 'dialog', onclick: () => p.menus.openModal('playback')}, moon());
  r.rotateBtn = iconButton('rotate', 'Rotate', () => p.system.rotate());
  const more = r.moreBtn = iconButton('chevronRight', 'More', () => r.actions.scrollBy({left: 200, behavior: level() === 'full' ? 'smooth' : 'auto'}), {class: 'ap-icon-btn ap-more'});
  r.actions.addEventListener('scroll', () => more.hidden = r.actions.scrollLeft + r.actions.clientWidth >= r.actions.scrollWidth - 4, {passive: true});
  r.lockBtn = iconButton('lock', 'Lock controls', () => p.ctl.setLocked(true));
  r.controls = h('div', {class: 'ap-controls'},
    h('div', {class: 'ap-shade-top'}), h('div', {class: 'ap-shade-bottom'}),
    h('div', {class: 'ap-top'}, r.pipBtn, r.topSpeedBtn, r.topSleepBtn, r.rotateBtn, r.lockBtn, iconButton('back', 'Close player', () => p.close('user'))),
    h('div', {class: 'ap-top-mid'}, r.sleepEl),
    h('div', {class: 'ap-center'},
      r.backBtn = iconButton('replay', seekLabel(-1, 10), () => p.seekBy(-seekStep(p.prefs)), {class: 'ap-icon-btn ap-side', iconText: '10'}),
      iconButton('chevronLeft', 'Previous frame', () => p.extras.frames.step(-1), {class: 'ap-icon-btn ap-frame'}),
      h('div', {class: 'ap-play-wrap'}, r.playBtn),
      iconButton('chevronRight', 'Next frame', () => p.extras.frames.step(1), {class: 'ap-icon-btn ap-frame'}),
      r.forwardBtn = iconButton('forward', seekLabel(1, 10), () => p.seekBy(seekStep(p.prefs)), {class: 'ap-icon-btn ap-side', iconText: '10'})),
    r.bottomEl = h('div', {class: 'ap-bottom'},
      // The release and the add-on share one line that always keeps its room: text arriving later moves nothing.
      h('div', {class: 'ap-meta'}, r.titleEl, r.episodeEl, h('div', {class: 'ap-sub-line'}, r.releaseEl, r.viaEl)),
      r.timeline,
      h('div', {class: 'ap-bar'}, h('div', {class: 'ap-actions-wrap'}, r.actions, more), r.timeEl)));

  // Pause overlay, skip, next episode, lock, error
  r.pauseOverlay = h('div', {class: 'ap-pause', hidden: true});
  r.skipFill = h('i');
  r.skipBtn = h('button', {class: 'ap-skip', type: 'button', hidden: true, onclick: () => p.markers.skipSegment()}, icon('skip', {size: 18}), h('span'), r.skipFill);
  r.nextCard = h('div', {class: 'ap-next', hidden: true});
  r.lockOverlay = h('div', {class: 'ap-lock', hidden: true},
    h('button', {class: 'ap-unlock', type: 'button', onclick: e => { e.stopPropagation(); p.ctl.unlockPressed(e); }}, icon('unlock', {size: 34}), h('span', {}, 'Tap to unlock')),
    h('div', {class: 'ap-lock-track'}, r.lockFill = h('div')));
  r.errorCard = h('div', {class: 'ap-error', hidden: true, role: 'alert'});
  r.noticeEl = h('div', {class: 'ap-notice', hidden: true, role: 'status', onclick: () => { r.noticeEl.hidden = true; }});
  // Sound turned all the way down stays visible, and one tap brings it back.
  r.mutedChip = h('button', {class: 'ap-muted', type: 'button', hidden: true, 'aria-label': 'Sound is off. Turn it on', onclick: () => p.unmute()}, icon('mute', {size: 18}), h('span', {}, 'Sound off'));
  r.modal = h('div', {class: 'ap-modal', hidden: true, role: 'dialog', 'aria-modal': 'true'});
  r.panel = h('div', {class: 'ap-panel', hidden: true, role: 'dialog', 'aria-modal': 'true'});

  r.surface = h('div', {class: 'ap-surface'});
  r.soundCover = h('div', {class: 'ap-sound-only', hidden: true}); // the picture covered (sound-only.js)
  r.root = h('div', {class: 'ap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Player', hidden: true, tabindex: -1},
    r.stage, r.subs2El, subs, r.surface, r.soundCover, r.pauseOverlay, r.feedback, r.seekPreview,
    r.controls, r.waitBox, r.skipBtn, r.nextCard, r.lockOverlay, r.mutedChip, r.noticeEl, r.loading, r.errorCard, r.panel, r.modal);
  p.parent.append(r.root);
  return r;
}

/** The title block, the loading screen's art, and which buttons this title has. */
export function renderMeta(p) {
  const m = p.meta;
  p.titleEl.textContent = m.title || '';
  p.episodeEl.textContent = m.episodeLine || '';
  p.releaseEl.textContent = m.release || '';
  p.loadingArt.style.backgroundImage = m.background ? `url(${JSON.stringify(m.background)})` : '';
  p.loadingLogo.replaceChildren(m.logo ? h('img', {src: m.logo, alt: m.title || '', referrerpolicy: 'no-referrer', onerror: e => e.target.replaceWith(h('span', {}, m.title || ''))}) : h('span', {}, m.title || ''));
  const series = !!p.options.episodes;
  p.actionButtons.episodes.hidden = !series;
  p.actionButtons.sources.hidden = !p.sources.length;
  p.actionButtons.next.hidden = !p.options.next;
  applyLook(p);
  p.actions.replaceChildren(...Object.values(p.actionButtons).filter(b => !b.hidden));
  requestAnimationFrame(() => { p.moreBtn.hidden = p.actions.scrollWidth <= p.actions.clientWidth + 4; });
}

/**
 * What the owner's player settings change on screen, drawn again when one changes (settings/player.js):
 * the top bar's buttons, the ±seconds of the transport (the double tap's step), the clock.
 */
export function applyLook(p) {
  const o = p.prefs;
  p.pipBtn.hidden = !document.pictureInPictureEnabled || o.topPip === false;
  p.topSpeedBtn.hidden = !o.topSpeed;
  p.topSleepBtn.hidden = !o.topSleep;
  p.rotateBtn.hidden = o.topRotate === false;
  p.lockBtn.hidden = o.topLock === false;
  const s = seekStep(o);
  for (const [btn, sign, name] of [[p.backBtn, -1, 'replay'], [p.forwardBtn, 1, 'forward']]) {
    if (btn.dataset.step === String(s)) continue;
    btn.dataset.step = String(s);
    btn.setAttribute('aria-label', seekLabel(sign, s)); btn.title = seekLabel(sign, s);
    btn.replaceChildren(icon(name, {text: String(s)}));
  }
  speedText(p);
  if (p.isOpen) p.updateTime();
}

/** The speed on its buttons (the bar's "Speed 1x" and the top bar's "1×"); while held for speed, the speed chosen. */
export function speedText(p) {
  const s = p.touch?.holding ? p.touch.holdBase : p.video.playbackRate || 1;
  p.speedBtn.textContent = `Speed ${s}x`;
  p.topSpeedBtn.textContent = `${s}×`;
}

/**
 * Portrait or landscape class, and the subtitle layer fitted to the picture
 * (in portrait the picture is a band across the middle of the screen).
 */
export function layout(p) {
  const W = p.root.clientWidth, H = p.root.clientHeight, vw = p.video.videoWidth, vh = p.video.videoHeight;
  p.root.classList.toggle('portrait', H > W);
  // Skip, the next-episode card and lifted subtitles sit above the controls' measured bottom block.
  const bottomH = p.bottomEl?.offsetHeight || 0;
  p.root.style.setProperty('--ap-bottom-h', bottomH + 'px');
  let pictureBottom = H;
  // Both subtitle layers cover the picture (the second track sits at its top).
  for (const box of [p.subsEl.style, p.subs2El.style]) {
    if (!W || !H || !vw || !vh || p.prefs.aspect !== 'fit') box.left = box.top = box.width = box.height = '';
    else {
      const scale = Math.min(W / vw, H / vh), w = vw * scale, h = vh * scale;
      pictureBottom = (H + h) / 2;
      Object.assign(box, {left: ((W - w) / 2).toFixed(1) + 'px', top: ((H - h) / 2).toFixed(1) + 'px', width: w.toFixed(1) + 'px', height: h.toFixed(1) + 'px'});
    }
  }
  // Portrait with room under the picture: subtitles go there, in the black,
  // clear of the picture and of the buttons over it.
  const below = H > W && H - pictureBottom - bottomH > 110;
  p.root.classList.toggle('subs-below', below);
  // Otherwise, when the controls show, bottom subtitles rise just clear of them.
  const zone = p.subsEl.querySelector('.astra-subs-zone.bottom');
  const zoneBottom = pictureBottom - (zone ? parseFloat(getComputedStyle(zone).bottom) || 0 : 0);
  p.root.style.setProperty('--ap-sub-lift', Math.max(0, Math.round(zoneBottom - (H - bottomH - 8))) + 'px');
}
