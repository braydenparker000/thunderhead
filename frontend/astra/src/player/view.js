// The player's elements, built once and handed back by name, and the two
// things that depend on the screen's size and the title: the meta block with
// its row of buttons, and the measuring that fits subtitles to the picture.
// Every handler calls back into the screen `p` (player-screen.js).

import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';

export const iconButton = (name, label, onclick, extra = {}) => h('button', {class: 'ap-icon-btn', type: 'button', 'aria-label': label, title: label, onclick, ...extra}, icon(name, {text: extra.iconText}));

/** Builds the player under p.parent (hidden) and returns its elements by name. */
export function build(p) {
  const r = {};
  const video = r.video = h('video', {class: 'ap-video', playsinline: true, preload: 'auto'});
  video.setAttribute('playsinline', '');
  const subs = r.subsEl = h('div', {class: 'ap-subs'});
  r.dim = h('div', {class: 'ap-dim', 'aria-hidden': 'true'}); // darkens the picture (the brightness swipe), not the subtitles

  // Feedback
  r.feedback = h('div', {class: 'ap-feedback', 'aria-live': 'polite'});
  r.seekPreview = h('div', {class: 'ap-seek-preview', hidden: true}, h('b'), h('span'));
  r.levelBars = {
    brightness: h('div', {class: 'ap-level left', hidden: true}, h('span'), h('div', {class: 'ap-level-track'}, h('i')), icon('brightness', {size: 20})),
    volume: h('div', {class: 'ap-level right', hidden: true}, h('span'), h('div', {class: 'ap-level-track'}, h('i')), icon('volume', {size: 20})),
  };

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
    h('div', {class: 'ap-track'}, r.buffered, r.played), r.thumb, r.bubble);
  r.timeEl = h('button', {class: 'ap-time', type: 'button', onclick: () => { p.remaining = !p.remaining; p.updateTime(); }});
  r.playBtn = iconButton('play', 'Play', () => p.togglePlay(), {class: 'ap-icon-btn ap-play'});
  r.spinner = h('div', {class: 'ap-spinner', hidden: true, role: 'progressbar', 'aria-label': 'Loading'});
  r.speedBtn = h('button', {class: 'ap-text-btn', type: 'button', onclick: () => p.cycleSpeed()}, 'Speed 1x');
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
  r.rotateBtn = iconButton('rotate', 'Rotate', () => p.system.rotate());
  const more = r.moreBtn = iconButton('chevronRight', 'More', () => r.actions.scrollBy({left: 200, behavior: 'smooth'}), {class: 'ap-icon-btn ap-more'});
  r.actions.addEventListener('scroll', () => more.hidden = r.actions.scrollLeft + r.actions.clientWidth >= r.actions.scrollWidth - 4, {passive: true});
  r.lockBtn = iconButton('lock', 'Lock controls', () => p.ctl.setLocked(true));
  r.controls = h('div', {class: 'ap-controls'},
    h('div', {class: 'ap-shade-top'}), h('div', {class: 'ap-shade-bottom'}),
    h('div', {class: 'ap-top'}, r.pipBtn, r.rotateBtn, r.lockBtn, iconButton('back', 'Close player', () => p.close('user'))),
    h('div', {class: 'ap-center'},
      iconButton('replay', 'Back 10 seconds', () => p.seekBy(-10), {class: 'ap-icon-btn ap-side', iconText: '10'}),
      h('div', {class: 'ap-play-wrap'}, r.playBtn),
      iconButton('forward', 'Forward 10 seconds', () => p.seekBy(10), {class: 'ap-icon-btn ap-side', iconText: '10'})),
    r.bottomEl = h('div', {class: 'ap-bottom'},
      h('div', {class: 'ap-meta'}, r.titleEl, r.episodeEl, r.releaseEl, r.viaEl),
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
  r.root = h('div', {class: 'ap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Player', hidden: true, tabindex: -1},
    video, r.dim, subs, r.surface, r.pauseOverlay, r.feedback, r.seekPreview, r.levelBars.brightness, r.levelBars.volume,
    r.controls, h('div', {class: 'ap-buffering'}, r.spinner), r.skipBtn, r.nextCard, r.lockOverlay, r.mutedChip, r.noticeEl, r.loading, r.errorCard, r.panel, r.modal);
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
  p.pipBtn.hidden = !document.pictureInPictureEnabled;
  p.actions.replaceChildren(...Object.values(p.actionButtons).filter(b => !b.hidden));
  requestAnimationFrame(() => { p.moreBtn.hidden = p.actions.scrollWidth <= p.actions.clientWidth + 4; });
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
  const box = p.subsEl.style;
  let pictureBottom = H;
  if (!W || !H || !vw || !vh || p.prefs.aspect !== 'fit') box.left = box.top = box.width = box.height = '';
  else {
    const scale = Math.min(W / vw, H / vh), w = vw * scale, h = vh * scale;
    pictureBottom = (H + h) / 2;
    Object.assign(box, {left: ((W - w) / 2).toFixed(1) + 'px', top: ((H - h) / 2).toFixed(1) + 'px', width: w.toFixed(1) + 'px', height: h.toFixed(1) + 'px'});
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
