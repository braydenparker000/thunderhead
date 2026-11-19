// Details' sections below the overview: the cast, the seasons and their episodes, the details table and
// "More like this" (where the add-on gives them), each on the type and space scales (browse.css).

import {h, clock} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {image, longPress, liftMenu, posterCard} from '../ui/components.js';
import {artBox} from '../ui/poster.js';
import {press, rise, tick, level, T} from '../ui/motion.js';
import {go} from '../ui/motion-core.js';
import {seasonsOf, episodeCode, videoTitle, aired, namesOf, runtimeLabel, catalogItems} from '../app/content.js';

const validDate = value => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
const section = (title, ...children) => h('section', {class: 'section'}, h('h2', {class: 'section-title'}, title), ...children);

/** The cast: with photos and characters where the add-on gives them (app_extras.cast), else initials. */
export function cast(m) {
  const extras = Array.isArray(m.app_extras?.cast) ? m.app_extras.cast.filter(c => typeof c?.name === 'string' && c.name.trim()) : [];
  const people = (extras.length ? extras.map(c => ({name: c.name.trim(), role: typeof c.character === 'string' ? c.character : '', photo: typeof c.photo === 'string' ? c.photo : ''})) : namesOf(m.cast).map(name => ({name, role: '', photo: ''}))).slice(0, 20);
  if (!people.length) return null;
  const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('');
  return section('Cast', h('div', {class: 'cast-row'}, ...people.map(p => h('div', {class: 'cast'},
    h('div', {class: 'cast-photo', 'aria-hidden': 'true'}, p.photo ? image(p.photo, '', 'cast-img', {label: initials(p.name)}) : initials(p.name)),
    h('span', {class: 'cast-name'}, p.name), p.role ? h('span', {class: 'cast-role'}, p.role) : null))));
}

/** The details table. */
export function facts(m) {
  const rows = [['Status', m.status], ['Release', m.releaseInfo || m.released?.slice?.(0, 10)], ['Runtime', runtimeLabel(m.runtime)], ['Country', m.country], ['Language', m.language], ['Genres', namesOf(m.genres).join(', ')]].filter(([, v]) => v && typeof v !== 'object');
  if (!rows.length) return null;
  return section('Details', h('dl', {class: 'facts'}, ...rows.map(([k, v]) => h('div', {class: 'fact'}, h('dt', {}, k), h('dd', {}, String(v))))));
}

/** "More like this": titles the add-on lists with this one (meta.similar or meta.recommendations), as a row of posters. */
export function moreLike(screen, m) {
  const list = [m.similar, m.recommendations].find(Array.isArray);
  const items = list ? catalogItems({metas: list}, m.type).filter(x => x.id !== m.id).slice(0, 18) : [];
  if (!items.length) return null;
  return section('More like this', h('div', {class: 'row-scroll like-row'}, ...items.map(x => posterCard(x, screen.posterCtx))));
}

/** Seasons as chips that scroll and settle, and the season's episodes as cards. */
export function episodes(screen, m) {
  const seasons = seasonsOf(m);
  const list = h('div', {class: 'episode-row'});
  // Channels and some anime list videos with no season at all: one flat row of the same cards.
  if (!seasons.length) {
    list.append(...m.videos.map(v => episodeCard(screen, m, v)));
    scrollToNext(screen, list);
    return section('Videos', list);
  }
  const targetSeason = screen.target?.video?.season;
  screen.season ??= seasons.includes(targetSeason) ? targetSeason : seasons.find(s => s > 0) ?? seasons[0];
  const chips = h('div', {class: 'season-chips', role: 'tablist'});
  const buttons = seasons.map(s => press(h('button', {class: 'chip', role: 'tab', type: 'button', onclick: () => { if (s !== screen.season) { tick('select'); show(s, true); } }}, s === 0 ? 'Specials' : `Season ${s}`)));
  chips.append(...buttons);
  const show = (season, moved = false) => {
    screen.season = season;
    buttons.forEach((b, i) => { const on = seasons[i] === season; b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on)); });
    const cards = m.videos.filter(v => v.season === season).map(v => episodeCard(screen, m, v));
    list.replaceChildren(...cards);
    if (moved) { list.scrollLeft = 0; rise(cards.slice(0, 2), {name: 'rise:episodes'}); }
    scrollToNext(screen, list);
  };
  show(screen.season);
  return section('Episodes', chips, list);
}

/** Scrolls an episode row so the episode Play would start is in view. */
function scrollToNext(screen, list) {
  if (screen.keepScroll != null) return;
  const next = list.querySelector('.episode-card.next');
  if (next && next !== list.firstElementChild) requestAnimationFrame(() => {
    const left = next.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft - 16;
    list.scrollTo({left, behavior: level() === 'full' ? 'smooth' : 'auto'});
  });
}

/**
 * An episode: its picture with the code, title, story, runtime and date over it; a progress line and a
 * watched mark. With "Hide spoilers", an unwatched episode's picture is blurred and its story hidden until
 * tapped (the first tap reveals, the next plays).
 */
function episodeCard(screen, m, v) {
  const app = screen.app;
  const watched = app.watched.has(m.type, m.id, v.id);
  const p = app.progress.get(m.type, m.id, v.id);
  const isNext = screen.target?.video?.id === v.id;
  const date = validDate(v.released); // an unreadable date is not shown
  const code = episodeCode(v);
  const runtime = runtimeLabel(v.runtime), day = date ? date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '';
  const art = v.thumbnail || m.background;
  let veiled = !watched && !(p && p.time > 0) && app.setting('spoilerBlur');
  const veil = veiled && art ? h('img', {class: 'episode-veil', alt: '', src: art, decoding: 'async', loading: 'lazy', referrerpolicy: 'no-referrer', draggable: 'false'}) : null;
  const story = v.overview ? h('span', {class: 'episode-overview'}, veiled ? 'Tap to show the story' : v.overview) : null;
  const reveal = () => {
    veiled = false;
    card.classList.remove('veiled');
    if (story) story.textContent = v.overview;
    if (veil) go(veil, {opacity: 0}, {duration: level() === 'off' ? 0 : T.normal, keep: true}).finished.then(() => veil.remove(), () => {}); // the blur fades; its radius never moves
  };
  const open = () => { if (veiled) { tick('select'); reveal(); return; } app.openStreams(m, v, {startTime: p && !p.completed ? p.time : 0}); };
  const card = press(h('button', {class: 'episode-card' + (isNext ? ' next' : '') + (aired(v) ? '' : ' unaired') + (veiled ? ' veiled' : ''), type: 'button', onclick: open},
    artBox('episode-art', art, [image(art, '', 'episode-img'), veil, h('div', {class: 'episode-shade'}),
      watched ? h('span', {class: 'watched-badge'}, icon('check', {size: 12})) : null,
      h('div', {class: 'episode-text'}, code ? h('span', {class: 'episode-code'}, code) : null, h('b', {}, videoTitle(v)), story,
        runtime || day ? h('span', {class: 'episode-meta'}, h('span', {}, runtime), h('span', {}, day)) : null),
      p && !p.completed ? h('div', {class: 'episode-progress'}, h('i', {style: {transform: `scaleX(${Math.min(1, p.time / p.duration)})`}})) : null])));
  card.setAttribute('aria-label', [code, v.title || (code ? '' : videoTitle(v)), watched ? 'watched' : '', p && !p.completed ? `${clock(p.time)} watched` : ''].filter(Boolean).join(', '));
  longPress(card, () => {
    const index = m.videos.indexOf(v);
    liftMenu(card.querySelector('.episode-art'), v.title || episodeCode(v), episodeCode(v), [
      watched ? {label: 'Mark as unwatched', icon: 'checkCircleOutline', run: () => app.watched.set(m.type, m.id, v.id, false)} : {label: 'Mark as watched', icon: 'checkCircle', run: () => app.watched.set(m.type, m.id, v.id, true)},
      {label: 'Mark previous as watched', icon: 'episodes', run: () => app.watched.setMany(m.videos.slice(0, index).filter(x => x.season !== 0).map(x => [m.type, m.id, x.id]), true)},
      v.season != null ? {label: `Mark Season ${v.season} as watched`, icon: 'checkCircle', run: () => app.watched.setMany(m.videos.filter(x => x.season === v.season).map(x => [m.type, m.id, x.id]), true)} : null, // a channel's videos have no season
    ].filter(Boolean));
  });
  return card;
}
