// The subtitles menu (menus.js opens it): a Tracks tab with languages and
// tracks, the second subtitle for language learning, a file from the phone,
// and a Style tab (delay, size, position, colour, background). "Find a line"
// opens the search (find.js) while a text track shows. Each function takes the
// Menus `m`; its p is the screen.

import {decodeSubtitleBytes} from '../engine/player.js';
import {languageName, baseLanguage} from '../engine/languages.js';
import {icon} from '../ui/icons.js';
import {h} from '../ui/dom.js';
import {savePrefs, subtitleStyle, DEFAULTS, SUBTITLE_COLORS, SUBTITLE_COLOR_NAMES, SUBTITLE_BACKGROUNDS} from './prefs.js';

/** Whether the engine can show a second track (the menu's row is offered only then). */
export const hasSecond = engine => typeof engine.selectSecondSubtitle === 'function';

/** "+2.5 s", "−1.0 s", "0.0 s". */
export const delayText = d => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)} s`;

/** Moves the subtitle delay by `by` seconds (±60 at most); `by` null resets it. */
export function nudgeDelay(p, by) {
  const r = p.engine.subtitles;
  r.setDelay(by == null ? 0 : Math.max(-60, Math.min(60, Math.round((r.delay + by) * 10) / 10)));
  return r.delay;
}

export function pickLanguage(m, code) {
  const p = m.p;
  m.subLang = code;
  m.renderModal();
  // Stacked in portrait, the tracks are under the languages: bring them up.
  if (p.root.classList.contains('portrait')) p.modal.querySelector('.ap-rail.tracks')?.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}

export function subtitleModal(m) {
  const p = m.p, e = p.engine;
  // Choosing the second track (shown above the first) uses the same lists.
  const second = m.subTarget === 'second' && hasSecond(e);
  const isOn = s => second ? s.id === e.secondSubtitle : s.selected;
  const options = e.subtitleOptions();
  const pick = s => {
    if (second) { e.selectSecondSubtitle(s ? s.id : null); m.renderModal(); return; }
    e.selectSubtitle(s ? s.id : null); p.prefs.subtitleLanguage = s ? baseLanguage(s.language) : ''; savePrefs(p.prefs);
  };
  // Languages in a useful order: the remembered one, the phone's own, then A to Z (Unknown last).
  const wanted = [baseLanguage(p.prefs.subtitleLanguage), ...navigator.languages.map(baseLanguage)].filter(Boolean);
  const rank = code => code === 'und' ? 1e4 : wanted.includes(code) ? wanted.indexOf(code) : 100;
  const langs = [...new Set(options.map(s => baseLanguage(s.language) || 'und'))]
    .sort((a, b) => rank(a) - rank(b) || (languageName(a) || a).localeCompare(languageName(b) || b));
  const selected = options.find(isOn);
  m.subLang ??= selected ? baseLanguage(selected.language) || 'und' : langs[0] || null;
  if (m.subLang && !langs.includes(m.subLang)) m.subLang = langs[0] || null;
  const langName = code => code === 'und' ? 'Unknown' : languageName(code) || code;
  const secondTrack = hasSecond(e) && options.find(s => s.id === e.secondSubtitle);
  const languageRail = h('div', {class: 'ap-rail languages'},
    h('button', {class: 'ap-row' + (!selected ? ' selected' : ''), type: 'button', 'aria-pressed': String(!selected), onclick: () => pick(null)}, h('b', {}, 'Off'), !selected ? icon('check', {size: 20}) : null),
    ...langs.map(code => h('button', {class: 'ap-row' + (code === m.subLang ? ' current' : ''), type: 'button', 'aria-pressed': String(code === m.subLang), onclick: () => pickLanguage(m, code)}, h('b', {}, langName(code)), h('small', {}, String(options.filter(s => (baseLanguage(s.language) || 'und') === code).length)))),
    second ? null : h('button', {class: 'ap-row file', type: 'button', onclick: () => pickSubtitleFile(m)}, icon('plus', {size: 18}), h('b', {}, 'From this phone…')),
    hasSecond(e) && !second && options.length ? h('button', {class: 'ap-row file', type: 'button', onclick: () => { m.subTarget = 'second'; m.subLang = null; m.renderModal(); }},
      h('span', {class: 'ap-row-text'}, h('b', {}, 'Second subtitle'), h('small', {}, secondTrack ? secondTrack.label : 'Off'))) : null);
  // Picture subtitles cannot be the second track (the engine reads pictures for one track at a time).
  const trackRail = h('div', {class: 'ap-rail tracks'}, ...options.filter(s => (baseLanguage(s.language) || 'und') === m.subLang && !(second && s.image)).map(s => h('button', {
    class: 'ap-row' + (isOn(s) ? ' selected' : ''), type: 'button', disabled: !s.supported || (second && s.selected), 'aria-pressed': String(!!isOn(s)),
    onclick: () => pick(s),
  }, h('span', {class: 'ap-row-text'}, h('b', {}, s.label), s.name ? h('small', {class: 'ap-file'}, s.name) : null,
    h('span', {class: 'ap-tags'}, h('em', {}, s.kind === 'embedded' ? (s.image ? 'Built-in picture' : 'Built-in') : s.kind === 'stream' ? 'Stream' : s.source || 'Add-on'),
      s.exact ? h('em', {class: 'good'}, 'Exact match') : null, s.forced ? h('em', {}, 'Forced') : null, s.loading ? h('em', {}, 'Loading…') : null),
    !s.supported ? h('small', {}, s.reason || '') : second && s.selected ? h('small', {}, 'Already the first subtitle') : null), isOn(s) ? icon('check', {size: 20}) : null)));
  if (!options.length) trackRail.append(h('p', {class: 'ap-empty'}, m.subtitleSearch ? 'Looking for subtitles…'
    : e.mode === 'native' && !e.readable ? 'This host does not let Astra read the file, so subtitles inside it cannot be shown. Subtitles from your add-ons still appear here, and you can load a file from this phone.'
    : 'No subtitles for this source.'));
  else if (m.subtitleSearch) trackRail.append(h('p', {class: 'ap-empty small'}, 'Still asking subtitle add-ons…'));
  const tab = m.subTab === 'style' ? 'style' : 'tracks';
  const tabs = h('div', {class: 'ap-tabs', role: 'tablist'}, ...[['tracks', 'Tracks'], ['style', 'Style']].map(([id, label]) =>
    h('button', {class: 'ap-tab' + (id === tab ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { m.subTab = id; m.renderModal(); p.modal.querySelector('.ap-modal-body').scrollTop = 0; }}, label)));
  const shown = e.selectedSubtitle && options.find(s => s.selected);
  const searchable = shown && !shown.image && (e.cues?.get(e.selectedSubtitle) || []).length > 0;
  const find = searchable ? h('button', {class: 'ap-chip ap-find', type: 'button', onclick: () => p.extras.find.open()}, icon('search', {size: 18}), 'Find a line') : null;
  const banner = second && tab === 'tracks' ? h('div', {class: 'ap-second-note'}, h('span', {}, 'Second subtitle: shown above the first, smaller.'),
    h('button', {class: 'ap-chip ghost', type: 'button', onclick: () => { m.subTarget = 'first'; m.subLang = null; m.renderModal(); }}, 'Back to the first')) : null;
  return [h('div', {class: 'ap-modal-head'}, h('h3', {}, second ? 'Second subtitle' : 'Subtitles'), tabs, find), banner,
    tab === 'style' ? h('div', {class: 'ap-rails'}, styleRail(m)) : h('div', {class: 'ap-rails'}, languageRail, trackRail)];
}

export function styleRail(m) {
  const p = m.p.prefs, r = m.p.engine.subtitles;
  const save = () => { savePrefs(p); r.setStyle(subtitleStyle(p)); m.renderModal(); m.p.layout(); }; // size and position move the bottom line
  const chip = (text, label, onclick, cls = 'ap-chip') => h('button', {class: cls, type: 'button', 'aria-label': label, onclick}, text);
  const stepper = (label, value, minus, plus, reset) => h('div', {class: 'ap-step'}, h('span', {}, label),
    h('div', {}, chip('−', label + ' down', minus), h('b', {}, value), chip('+', label + ' up', plus),
      reset ? h('button', {class: 'ap-chip ghost', type: 'button', onclick: reset}, 'Reset') : null));
  const delay = r.delay, nudge = by => () => { nudgeDelay(m.p, by); m.renderModal(); };
  // Two groups: side by side in landscape, so nothing hides below the fold.
  return h('div', {class: 'ap-rail style'}, h('div', {class: 'ap-style-group'},
    h('div', {class: 'ap-step wrap'}, h('span', {}, 'Delay'),
      h('div', {}, chip('−1', 'Delay down 1 second', nudge(-1)), chip('−', 'Delay down', nudge(-0.1)), h('b', {}, delayText(delay)), chip('+', 'Delay up', nudge(0.1)), chip('+1', 'Delay up 1 second', nudge(1)),
        h('button', {class: 'ap-chip ghost', type: 'button', disabled: !delay, onclick: nudge(null)}, 'Reset'))),
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

/** Loads an .srt, .vtt or .ass file the viewer picks and shows it. */
export function pickSubtitleFile(m) {
  const p = m.p;
  const input = h('input', {type: 'file', accept: '.srt,.vtt,.ass,.ssa,.sub,.txt,text/*', hidden: true});
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file || file.size > 8 << 20) return;
    // The language picked in this menu tells an old (non-UTF-8) file's code page; else the one usually wanted.
    const text = decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer()), m.subLang && m.subLang !== 'und' ? m.subLang : p.prefs.subtitleLanguage || '');
    const id = p.engine.addSubtitleTrack({text, label: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Subtitles', format: file.name, source: 'This phone'});
    const cues = p.engine.cues.get(id) || [];
    if (!cues.length) { p.flash('No subtitles found in that file'); return; }
    m.subLang = 'und';
    p.engine.selectSubtitle(id);
    m.renderModal();
  }, {once: true});
  p.root.append(input);
  input.click();
}
