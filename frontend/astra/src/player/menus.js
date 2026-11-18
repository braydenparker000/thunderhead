// The player's menus: audio, subtitles (subtitle-menu.js), stream info,
// Playback (playback.js) and the subtitle search (find.js) as full-screen
// modals; sources and episodes as side panels. One is open at a time; each is
// a history entry, so back closes it before the player.

import {baseLanguage} from '../engine/languages.js';
import {pushLayer} from '../app/back-stack.js';
import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';
import {savePrefs} from './prefs.js';
import {externalPlayerUrl, canOpenExternally} from './external.js';
import {iconButton} from './view.js';
import {subtitleModal, pickLanguage, pickSubtitleFile} from './subtitle-menu.js';
import {viaName} from './rules.js';
import {addressLine} from './address.js';

const MODAL_LABELS = {audio: 'Audio', subtitles: 'Subtitles', info: 'Stream info', playback: 'Playback', find: 'Find a line'};

export class Menus {
  constructor(p) {
    this.p = p;
    this.modalName = null;
    this.panelName = null;
    this.returnFocus = null;
    this.subtitleSearch = false;
    this.bodies = {}; // more modals by name: () => their content (extras.js)
    this.reset();
  }

  /** The name of the open modal or panel, or null. */
  get open() { return this.modalName || this.panelName || null; }

  /** Choices that belong to one title start fresh with the next. */
  reset() {
    this.panelSeason = null;
    this.showHidden = false;
    this.subLang = null;
    this.subTab = 'tracks';
    this.subTarget = 'first'; // or 'second': the subtitles menu is choosing the second track
    this.audioTab = 'tracks'; // or 'sound' (sound-menu.js)
  }

  subtitleModal() { return subtitleModal(this); }
  pickLanguage(code) { pickLanguage(this, code); }
  pickSubtitleFile() { pickSubtitleFile(this); }

  openModal(name) {
    const p = this.p;
    this.dismiss();
    p.touch.abort(); // a hold or a drag ends with the menu's arrival
    this.modalName = name;
    this.modalClose = pushLayer('player-modal', () => { this.modalClose = null; this.dismiss(); });
    this.renderModal();
    p.modal.hidden = false;
    p.modal.setAttribute('aria-label', MODAL_LABELS[name] || name);
    p.root.classList.add('overlay');
    p.showControls(false);
    this.focusOverlay(p.modal);
  }

  openPanel(name) {
    const p = this.p;
    this.dismiss();
    p.touch.abort();
    this.panelName = name;
    this.panelClose = pushLayer('player-panel', () => { this.panelClose = null; this.dismiss(); });
    this.renderPanel();
    p.panel.hidden = false;
    p.panel.setAttribute('aria-label', name === 'sources' ? 'Sources' : 'Episodes');
    p.root.classList.add('overlay');
    p.showControls(false);
    // The current source or episode is in view, not a screen or two down the list.
    p.panel.querySelector('.current')?.scrollIntoView({block: 'center'});
    this.focusOverlay(p.panel);
  }

  /** Moves focus into a menu or panel (the current row, else its first button); closing gives it back. */
  focusOverlay(el) {
    this.returnFocus ??= document.activeElement;
    (el.querySelector('.current, [aria-pressed="true"], .on') || el.querySelector('button'))?.focus({preventScroll: true});
  }

  /** Closes whatever is open. `silent`: the controls' hide timer is left alone. */
  dismiss(silent = false) {
    const p = this.p;
    const wasOpen = !!this.open;
    if (this.modalName) { this.modalName = null; p.modal.hidden = true; this.modalClose?.(); this.modalClose = null; }
    if (this.panelName) { this.panelName = null; p.panel.hidden = true; this.panelClose?.(); this.panelClose = null; }
    if (wasOpen && this.returnFocus?.isConnected) this.returnFocus.focus({preventScroll: true});
    this.returnFocus = null;
    p.root.classList.remove('overlay');
    if (!silent) p.scheduleHide();
  }

  refresh() {
    const p = this.p;
    if (this.modalName && this.modalName !== 'find') this.renderModal(); // the search keeps its field as typed
    const subs = p.engine.subtitleOptions();
    p.actionButtons.subtitles.classList.toggle('on', subs.some(s => s.selected));
  }

  /** Whether subtitle add-ons are still being asked (shown in the subtitles menu). */
  setSubtitleSearch(on) { this.subtitleSearch = on; this.refresh(); }

  renderModal() {
    const p = this.p, name = this.modalName;
    const close = iconButton('close', 'Close', () => this.dismiss(), {class: 'ap-icon-btn ap-modal-close'});
    let body;
    if (name === 'audio') body = this.audioModal();
    else if (name === 'subtitles') body = this.subtitleModal();
    else if (this.bodies[name]) body = this.bodies[name]();
    else body = this.infoModal();
    // Redrawn after every tap: the lists stay where they were scrolled, and keyboard focus stays on its button.
    const kept = p.modal.hidden ? [] : [...p.modal.querySelectorAll('.ap-modal-body, .ap-rail')].map(el => ['.' + [...el.classList].join('.'), el.scrollTop]);
    const key = el => el.getAttribute('aria-label') || el.textContent;
    const focused = p.modal.contains(document.activeElement) && document.activeElement.matches('button') ? key(document.activeElement) : null;
    // Picking tracks hides the picture; styling leaves it showing, so the change can be seen. The wide menus (Playback, the search) are solid too.
    const scrim = 'ap-modal-scrim' + (name === 'playback' || name === 'find' || (name === 'audio' && this.audioTab === 'sound') ? ' solid' : name !== 'subtitles' ? '' : this.subTab === 'style' ? ' preview' : ' solid');
    p.modal.replaceChildren(h('div', {class: scrim, onclick: () => this.dismiss()}), h('div', {class: 'ap-modal-body ' + name}, close, body));
    for (const [selector, top] of kept) { const el = p.modal.querySelector(selector); if (el) el.scrollTop = top; }
    if (focused != null) [...p.modal.querySelectorAll('button')].find(b => key(b) === focused)?.focus({preventScroll: true});
  }

  audioModal() {
    const p = this.p;
    const options = p.engine.audioOptions();
    const rows = options.length ? options.map(a => h('button', {
      class: 'ap-row' + (a.selected ? ' selected' : ''), type: 'button', disabled: !a.supported, 'aria-pressed': String(a.selected),
      onclick: () => { p.engine.selectAudio(a.id); p.prefs.audioLanguage = baseLanguage(a.language); savePrefs(p.prefs); },
    }, h('span', {class: 'ap-row-text'}, h('b', {}, a.label), a.supported ? (a.delivery === 'rebuilt' ? h('small', {}, 'Converted on this device') : null) : h('small', {}, a.reason || 'Not playable here')), a.selected ? icon('check', {size: 20}) : null))
      : [h('p', {class: 'ap-empty'}, p.engine.mode === 'native' ? 'This source plays directly in Chrome, which does not let pages choose its audio track.' : 'No other audio tracks.')];
    // Two tabs: the tracks, and what can be done to the sound (sound-menu.js).
    const tab = this.audioTab === 'sound' ? 'sound' : 'tracks';
    const tabs = h('div', {class: 'ap-tabs', role: 'tablist'}, ...[['tracks', 'Tracks'], ['sound', 'Sound']].map(([id, label]) =>
      h('button', {class: 'ap-tab' + (id === tab ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { this.audioTab = id; this.renderModal(); }}, label)));
    return [h('div', {class: 'ap-modal-head'}, h('h3', {}, 'Audio'), tabs), tab === 'sound' ? p.extras.sound.body() : h('div', {class: 'ap-rail wide'}, ...rows)];
  }

  infoModal() {
    const p = this.p, e = p.engine, info = e.info, plan = e.plan;
    const rows = [['How it plays', {native: 'Directly in Chrome', remux: 'Unpacked by Astra', software: 'Decoded by Astra (software)', hls: 'HLS stream', dash: 'DASH stream', unsupported: 'Not playable'}[e.mode] || '—']];
    const address = addressLine(p.stream?.resolved, e.mode); // from TorBox directly, or the add-on's link and why (address.js)
    if (address) rows.push(['Address', address]);
    if (info?.video?.[0]) rows.push(['Video', [info.video[0].label, info.video[0].width && `${info.video[0].width}×${info.video[0].height}`, info.video[0].hdr && 'HDR'].filter(Boolean).join(' · ')]);
    const audio = e.audioOptions().find(a => a.selected);
    if (audio) rows.push(['Audio', audio.label + (audio.delivery === 'rebuilt' ? ' (converted)' : '')]);
    if (info?.container) rows.push(['File', info.container + (info.size ? ' · ' + (info.size / 1e9).toFixed(2) + ' GB' : '')]);
    const q = p.video.getVideoPlaybackQuality?.();
    if (q) rows.push(['Frames', `${q.totalVideoFrames} shown, ${q.droppedVideoFrames} dropped`]);
    if (p.video.videoWidth) rows.push(['Picture', `${p.video.videoWidth}×${p.video.videoHeight}`]);
    for (const n of plan?.notes || []) rows.push(['Note', n]);
    const external = canOpenExternally() && externalPlayerUrl(p.stream?.url);
    const extra = p.extras.info; // data used, chapters, save a frame
    rows.push(...extra.rows());
    return [h('h3', {}, 'Stream info'), p.extras.picture.body(), h('dl', {class: 'ap-info'}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])), ...extra.after(),
      external ? h('button', {class: 'ap-chip', type: 'button', onclick: () => p.openExternally()}, 'Play in another app') : null];
  }

  renderPanel() {
    const p = this.p, name = this.panelName;
    let body;
    if (name === 'sources') {
      // Those the viewer's stream filters hide (the next episode's list) are counted, and can be shown.
      const hidden = p.hiddenSources || [], list = this.showHidden ? [...p.sources, ...hidden] : p.sources;
      body = [h('h3', {}, 'Sources'), h('div', {class: 'ap-panel-list'}, ...list.map(s => h('button', {
        class: 'ap-source' + (s.id === p.sourceId ? ' current' : ''), type: 'button', onclick: () => this.pickSource(s),
      }, h('b', {}, viaName(s.label)), s.detail ? h('span', {}, s.detail) : null))),
      hidden.length && !this.showHidden ? h('p', {class: 'ap-panel-note'}, `${hidden.length} hidden by your filters `,
        h('button', {class: 'ap-chip ghost', type: 'button', onclick: () => { this.showHidden = true; this.renderPanel(); }}, 'Show them')) : null];
    } else {
      const ep = p.options.episodes;
      const season = this.panelSeason ?? ep.season;
      body = [h('h3', {}, 'Episodes'),
        h('div', {class: 'ap-seasons'}, ...ep.seasons.map(s => h('button', {class: 'ap-chip' + (s === season ? ' on' : ''), type: 'button', onclick: () => { this.panelSeason = s; this.renderPanel(); }}, s === 0 ? 'Specials' : 'Season ' + s))),
        h('div', {class: 'ap-panel-list'}, ...ep.items.filter(i => i.season === season).map(i => h('button', {
          class: 'ap-episode' + (i.id === ep.current ? ' current' : ''), type: 'button',
          onclick: () => { this.dismiss(); p.emit('episode', {episode: i}); },
        }, i.thumbnail ? h('img', {src: i.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer'}) : h('div', {class: 'ap-episode-thumb'}),
        h('span', {}, h('small', {}, `E${i.episode}`), h('b', {}, i.title || 'Episode ' + i.episode))))) ];
    }
    p.panel.replaceChildren(h('div', {class: 'ap-modal-scrim', onclick: () => this.dismiss()}),
      h('div', {class: 'ap-panel-body'}, iconButton('close', 'Close', () => this.dismiss(), {class: 'ap-icon-btn ap-modal-close'}), body));
  }

  /**
   * Another source, from where the film is (or was asked to start, before its
   * first frame). The app asks its server for the address first, so it is told and
   * loads it itself (it calls preventDefault); without such a listener (the
   * lab), the player loads the address as it is.
   */
  pickSource(s) {
    const p = this.p;
    if (s.id === p.sourceId && p.stream) return this.dismiss();
    const startTime = p.resumePoint();
    p.sourceId = s.id;
    this.dismiss();
    if (p.emit('source', {source: s, startTime}, {cancelable: true})) p.load(s.stream, startTime);
  }

  /**
   * Shows subtitles in the remembered language when nothing is shown yet:
   * the file's own track first, then an exact match for this release, then
   * the first add-on file. Choosing Off in the menu forgets the language.
   */
  autoSubtitle() {
    const p = this.p;
    const want = p.prefs.subtitleLanguage;
    if (!want || !p.ready || p.engine.selectedSubtitle) return;
    const options = p.engine.subtitleOptions().filter(s => s.supported && baseLanguage(s.language) === want);
    const match = options.find(s => !s.forced) || options[0];
    if (match) p.engine.selectSubtitle(match.id);
  }

  /** The player closed. */
  close() { this.dismiss(true); }
}
