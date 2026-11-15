// The player's menus: audio, subtitles (tracks and style) and stream info as
// full-screen modals; sources and episodes as side panels. One is open at a
// time; each is a history entry, so back closes it before the player.

import {decodeSubtitleBytes} from '../engine/player.js';
import {languageName, baseLanguage} from '../engine/languages.js';
import {pushLayer} from '../app/back-stack.js';
import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';
import {savePrefs, subtitleStyle, DEFAULTS, SUBTITLE_COLORS, SUBTITLE_COLOR_NAMES, SUBTITLE_BACKGROUNDS} from './prefs.js';
import {externalPlayerUrl, canOpenExternally} from './external.js';
import {iconButton} from './view.js';

export class Menus {
  constructor(p) {
    this.p = p;
    this.modalName = null;
    this.panelName = null;
    this.returnFocus = null;
    this.subtitleSearch = false;
    this.reset();
  }

  /** The name of the open modal or panel, or null. */
  get open() { return this.modalName || this.panelName || null; }

  /** Choices that belong to one title start fresh with the next. */
  reset() {
    this.panelSeason = null;
    this.subLang = null;
    this.subTab = 'tracks';
  }

  openModal(name) {
    const p = this.p;
    this.dismiss();
    this.modalName = name;
    this.modalClose = pushLayer('player-modal', () => { this.modalClose = null; this.dismiss(); });
    this.renderModal();
    p.modal.hidden = false;
    p.modal.setAttribute('aria-label', {audio: 'Audio', subtitles: 'Subtitles', info: 'Stream info'}[name] || name);
    p.root.classList.add('overlay');
    p.showControls(false);
    this.focusOverlay(p.modal);
  }

  openPanel(name) {
    const p = this.p;
    this.dismiss();
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
    if (this.modalName) this.renderModal();
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
    else body = this.infoModal();
    // Redrawn after every tap: the lists stay where they were scrolled, and keyboard focus stays on its button.
    const kept = p.modal.hidden ? [] : [...p.modal.querySelectorAll('.ap-modal-body, .ap-rail')].map(el => ['.' + [...el.classList].join('.'), el.scrollTop]);
    const key = el => el.getAttribute('aria-label') || el.textContent;
    const focused = p.modal.contains(document.activeElement) && document.activeElement.matches('button') ? key(document.activeElement) : null;
    // Picking tracks hides the picture; styling leaves it showing, so the change can be seen.
    const scrim = 'ap-modal-scrim' + (name !== 'subtitles' ? '' : this.subTab === 'style' ? ' preview' : ' solid');
    p.modal.replaceChildren(h('div', {class: scrim, onclick: () => this.dismiss()}), h('div', {class: 'ap-modal-body ' + name}, close, body));
    for (const [selector, top] of kept) { const el = p.modal.querySelector(selector); if (el) el.scrollTop = top; }
    if (focused != null) [...p.modal.querySelectorAll('button')].find(b => key(b) === focused)?.focus({preventScroll: true});
  }

  pickLanguage(code) {
    const p = this.p;
    this.subLang = code;
    this.renderModal();
    // Stacked in portrait, the tracks are under the languages: bring them up.
    if (p.root.classList.contains('portrait')) p.modal.querySelector('.ap-rail.tracks')?.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }

  audioModal() {
    const p = this.p;
    const options = p.engine.audioOptions();
    const rows = options.length ? options.map(a => h('button', {
      class: 'ap-row' + (a.selected ? ' selected' : ''), type: 'button', disabled: !a.supported, 'aria-pressed': String(a.selected),
      onclick: () => { p.engine.selectAudio(a.id); p.prefs.audioLanguage = baseLanguage(a.language); savePrefs(p.prefs); },
    }, h('span', {class: 'ap-row-text'}, h('b', {}, a.label), a.supported ? (a.delivery === 'rebuilt' ? h('small', {}, 'Converted on this device') : null) : h('small', {}, a.reason || 'Not playable here')), a.selected ? icon('check', {size: 20}) : null))
      : [h('p', {class: 'ap-empty'}, p.engine.mode === 'native' ? 'This source plays directly in Chrome, which does not let pages choose its audio track.' : 'No other audio tracks.')];
    return [h('h3', {}, 'Audio'), h('div', {class: 'ap-rail wide'}, ...rows)];
  }

  subtitleModal() {
    const p = this.p;
    const options = p.engine.subtitleOptions();
    // Languages in a useful order: the remembered one, the phone's own, then A to Z (Unknown last).
    const wanted = [baseLanguage(p.prefs.subtitleLanguage), ...navigator.languages.map(baseLanguage)].filter(Boolean);
    const rank = code => code === 'und' ? 1e4 : wanted.includes(code) ? wanted.indexOf(code) : 100;
    const langs = [...new Set(options.map(s => baseLanguage(s.language) || 'und'))]
      .sort((a, b) => rank(a) - rank(b) || (languageName(a) || a).localeCompare(languageName(b) || b));
    const selected = options.find(s => s.selected);
    this.subLang ??= selected ? baseLanguage(selected.language) || 'und' : langs[0] || null;
    if (this.subLang && !langs.includes(this.subLang)) this.subLang = langs[0] || null;
    const langName = code => code === 'und' ? 'Unknown' : languageName(code) || code;
    const languageRail = h('div', {class: 'ap-rail languages'},
      h('button', {class: 'ap-row' + (!selected ? ' selected' : ''), type: 'button', 'aria-pressed': String(!selected), onclick: () => { p.engine.selectSubtitle(null); p.prefs.subtitleLanguage = ''; savePrefs(p.prefs); }}, h('b', {}, 'Off'), !selected ? icon('check', {size: 20}) : null),
      ...langs.map(code => h('button', {class: 'ap-row' + (code === this.subLang ? ' current' : ''), type: 'button', 'aria-pressed': String(code === this.subLang), onclick: () => this.pickLanguage(code)}, h('b', {}, langName(code)), h('small', {}, String(options.filter(s => (baseLanguage(s.language) || 'und') === code).length)))),
      h('button', {class: 'ap-row file', type: 'button', onclick: () => this.pickSubtitleFile()}, icon('plus', {size: 18}), h('b', {}, 'From this phone…')));
    const trackRail = h('div', {class: 'ap-rail tracks'}, ...options.filter(s => (baseLanguage(s.language) || 'und') === this.subLang).map(s => h('button', {
      class: 'ap-row' + (s.selected ? ' selected' : ''), type: 'button', disabled: !s.supported, 'aria-pressed': String(!!s.selected),
      onclick: () => { p.engine.selectSubtitle(s.id); p.prefs.subtitleLanguage = baseLanguage(s.language); savePrefs(p.prefs); },
    }, h('span', {class: 'ap-row-text'}, h('b', {}, s.label), s.name ? h('small', {class: 'ap-file'}, s.name) : null,
      h('span', {class: 'ap-tags'}, h('em', {}, s.kind === 'embedded' ? (s.image ? 'Built-in picture' : 'Built-in') : s.kind === 'stream' ? 'Stream' : s.source || 'Add-on'),
        s.exact ? h('em', {class: 'good'}, 'Exact match') : null, s.forced ? h('em', {}, 'Forced') : null, s.loading ? h('em', {}, 'Loading…') : null),
      !s.supported ? h('small', {}, s.reason || '') : null), s.selected ? icon('check', {size: 20}) : null)));
    if (!options.length) trackRail.append(h('p', {class: 'ap-empty'}, this.subtitleSearch ? 'Looking for subtitles…'
      : p.engine.mode === 'native' && !p.engine.readable ? 'This host does not let Astra read the file, so subtitles inside it cannot be shown. Subtitles from your add-ons still appear here, and you can load a file from this phone.'
      : 'No subtitles for this source.'));
    else if (this.subtitleSearch) trackRail.append(h('p', {class: 'ap-empty small'}, 'Still asking subtitle add-ons…'));
    const tab = this.subTab === 'style' ? 'style' : 'tracks';
    const tabs = h('div', {class: 'ap-tabs', role: 'tablist'}, ...[['tracks', 'Tracks'], ['style', 'Style']].map(([id, label]) =>
      h('button', {class: 'ap-tab' + (id === tab ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { this.subTab = id; this.renderModal(); p.modal.querySelector('.ap-modal-body').scrollTop = 0; }}, label)));
    return [h('div', {class: 'ap-modal-head'}, h('h3', {}, 'Subtitles'), tabs),
      tab === 'style' ? h('div', {class: 'ap-rails'}, this.styleRail()) : h('div', {class: 'ap-rails'}, languageRail, trackRail)];
  }

  styleRail() {
    const p = this.p.prefs, r = this.p.engine.subtitles;
    const save = () => { savePrefs(p); r.setStyle(subtitleStyle(p)); this.renderModal(); };
    const stepper = (label, value, minus, plus, reset) => h('div', {class: 'ap-step'}, h('span', {}, label),
      h('div', {}, h('button', {class: 'ap-chip', type: 'button', 'aria-label': label + ' down', onclick: minus}, '−'), h('b', {}, value), h('button', {class: 'ap-chip', type: 'button', 'aria-label': label + ' up', onclick: plus}, '+'),
        reset ? h('button', {class: 'ap-chip ghost', type: 'button', onclick: reset}, 'Reset') : null));
    const delay = r.delay;
    // Two groups: side by side in landscape, so nothing hides below the fold.
    return h('div', {class: 'ap-rail style'}, h('div', {class: 'ap-style-group'},
      stepper('Delay', `${delay > 0 ? '+' : ''}${delay.toFixed(1)} s`, () => { r.setDelay(Math.max(-60, delay - 0.1)); this.renderModal(); }, () => { r.setDelay(Math.min(60, delay + 0.1)); this.renderModal(); }, delay ? () => { r.setDelay(0); this.renderModal(); } : null),
      stepper('Size', String(p.subtitleSize), () => { p.subtitleSize = Math.max(12, p.subtitleSize - 2); save(); }, () => { p.subtitleSize = Math.min(40, p.subtitleSize + 2); save(); }),
      stepper('Position', String(p.subtitleOffset), () => { p.subtitleOffset = Math.max(0, p.subtitleOffset - 5); save(); }, () => { p.subtitleOffset = Math.min(200, p.subtitleOffset + 5); save(); }),
      h('div', {class: 'ap-toggles'},
        h('button', {class: 'ap-chip' + (p.subtitleBold ? ' on' : ''), type: 'button', 'aria-pressed': String(p.subtitleBold), onclick: () => { p.subtitleBold = !p.subtitleBold; save(); }}, 'Bold'),
        h('button', {class: 'ap-chip' + (p.subtitleOutline ? ' on' : ''), type: 'button', 'aria-pressed': String(p.subtitleOutline), onclick: () => { p.subtitleOutline = !p.subtitleOutline; save(); }}, 'Outline'))),
      h('div', {class: 'ap-style-group'},
      h('span', {class: 'ap-label'}, 'Text colour'),
      h('div', {class: 'ap-swatches'}, ...SUBTITLE_COLORS.map(c => h('button', {class: 'ap-swatch' + (c === p.subtitleColor ? ' on' : ''), type: 'button', 'aria-label': SUBTITLE_COLOR_NAMES[c] || c, 'aria-pressed': String(c === p.subtitleColor), style: {background: c}, onclick: () => { p.subtitleColor = c; save(); }}))),
      h('span', {class: 'ap-label'}, 'Background'),
      h('div', {class: 'ap-swatches'}, ...SUBTITLE_BACKGROUNDS.map(a => h('button', {class: 'ap-swatch bg' + (a === p.subtitleBackground ? ' on' : ''), type: 'button', 'aria-label': a ? `Background ${Math.round(a * 100)}%` : 'No background', 'aria-pressed': String(a === p.subtitleBackground), style: {background: a ? `rgba(0,0,0,${a})` : 'transparent'}, onclick: () => { p.subtitleBackground = a; save(); }}))),
      h('button', {class: 'ap-chip ghost', type: 'button', onclick: () => { for (const k of ['subtitleSize', 'subtitleColor', 'subtitleBackground', 'subtitleOutline', 'subtitleBold', 'subtitleOffset']) p[k] = DEFAULTS[k]; r.setDelay(0); save(); }}, 'Reset defaults')));
  }

  infoModal() {
    const p = this.p, e = p.engine, info = e.info, plan = e.plan;
    const rows = [['How it plays', {native: 'Directly in Chrome', remux: 'Unpacked by Astra', software: 'Decoded by Astra (software)', hls: 'HLS stream', dash: 'DASH stream', unsupported: 'Not playable'}[e.mode] || '—']];
    if (info?.video?.[0]) rows.push(['Video', [info.video[0].label, info.video[0].width && `${info.video[0].width}×${info.video[0].height}`, info.video[0].hdr && 'HDR'].filter(Boolean).join(' · ')]);
    const audio = e.audioOptions().find(a => a.selected);
    if (audio) rows.push(['Audio', audio.label + (audio.delivery === 'rebuilt' ? ' (converted)' : '')]);
    if (info?.container) rows.push(['File', info.container + (info.size ? ' · ' + (info.size / 1e9).toFixed(2) + ' GB' : '')]);
    const q = p.video.getVideoPlaybackQuality?.();
    if (q) rows.push(['Frames', `${q.totalVideoFrames} shown, ${q.droppedVideoFrames} dropped`]);
    if (p.video.videoWidth) rows.push(['Picture', `${p.video.videoWidth}×${p.video.videoHeight}`]);
    for (const n of plan?.notes || []) rows.push(['Note', n]);
    const external = canOpenExternally() && externalPlayerUrl(p.stream?.url);
    return [h('h3', {}, 'Stream info'), h('dl', {class: 'ap-info'}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      external ? h('button', {class: 'ap-chip', type: 'button', onclick: () => p.openExternally()}, 'Play in another app') : null];
  }

  renderPanel() {
    const p = this.p, name = this.panelName;
    let body;
    if (name === 'sources') {
      body = [h('h3', {}, 'Sources'), h('div', {class: 'ap-panel-list'}, ...p.sources.map(s => h('button', {
        class: 'ap-source' + (s.id === p.sourceId ? ' current' : ''), type: 'button',
        onclick: () => { if (s.id === p.sourceId) return this.dismiss(); p.sourceId = s.id; this.dismiss(); p.emit('source', {source: s}); p.load(s.stream, p.video.currentTime || 0); },
      }, h('b', {}, s.label), s.detail ? h('span', {}, s.detail) : null)))];
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

  /** The player closed. */
  close() { this.dismiss(true); }

  /** Loads an .srt, .vtt or .ass file the viewer picks and shows it. */
  pickSubtitleFile() {
    const p = this.p;
    const input = h('input', {type: 'file', accept: '.srt,.vtt,.ass,.ssa,.sub,.txt,text/*', hidden: true});
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file || file.size > 8 << 20) return;
      const text = decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer()));
      const id = p.engine.addSubtitleTrack({text, label: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Subtitles', format: file.name, source: 'This phone'});
      const cues = p.engine.cues.get(id) || [];
      if (!cues.length) { p.flash('No subtitles found in that file'); return; }
      this.subLang = 'und';
      p.engine.selectSubtitle(id);
      this.renderModal();
    }, {once: true});
    p.root.append(input);
    input.click();
  }
}
