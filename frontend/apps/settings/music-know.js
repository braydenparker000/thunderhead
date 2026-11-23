// @ts-check
// "What I know about your music" in Settings › Music (MUSIC.md §19.6), beside "Listening history":
// the proof of the music knowledge. Albums and artists matched out of how many, what each source
// filled, where the job is, the picks made, declined, ordered and added (GET /v1/music/know, counts
// only), and the albums left unmatched with why (GET /v1/music/unmatched: names from the owner's own
// catalog, on the owner's phone). Read when the page opens; nothing here changes anything.
import { api, signedIn } from '/th/client.js';
import { el } from '/th/ui.js';
import { icon } from './components.js';

/** @typedef {import('../../../shared/contract/know.ts').KnowStatus} KnowStatus */
/** @typedef {import('../../../shared/contract/know.ts').UnmatchedResponse} UnmatchedResponse */

const n = (/** @type {number} */ x) => x.toLocaleString('en-GB');
const SOURCES = { musicbrainz: 'MusicBrainz', listenbrainz: 'ListenBrainz', wikidata: 'Wikidata', wikipedia: 'Wikipedia', lastfm: 'Last.fm', discogs: 'Discogs' };
const PHASE = { matching: 'Matching your albums.', facts: 'Gathering facts.', picks: 'Choosing picks.', idle: 'Up to date.' };
const WHY = {
  artist_unknown: 'MusicBrainz doesn’t know the artist',
  artist_unsure: 'not sure which artist',
  no_release_group: 'no album of that name',
  several_release_groups: 'more than one album could be it',
  lookup_failed: 'MusicBrainz didn’t answer',
};

const line = (/** @type {string} */ a, /** @type {string} */ b) =>
  el('div', { class: 'row srow', 'data-info': '' }, [el('div', { class: 'row-copy stext' }, [el('div', { class: 'st1', text: a }), el('div', { class: 'st2', text: b })])]);

const time = (/** @type {number} */ ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
/** Each source: answering, refusing (and when it is asked again), or not asked yet.
 * @param {KnowStatus['hosts']} hosts */
export function hostWords(hosts) {
  return Object.entries(hosts ?? {})
    .map(([k, h]) => {
      const name = SOURCES[/** @type {keyof typeof SOURCES} */ (k)] ?? k;
      if (h.until) return `${name} refusing, asked again at ${time(h.until)}`;
      if (h.ok_at) return `${name} answering`;
      return `${name} not asked yet`;
    })
    .join(' · ');
}

/** The counts, in words. @param {KnowStatus} s */
export function knowParts(s) {
  if (!s.albums.total) return [el('p', { class: 'sempty', text: 'Nothing matched yet. It starts once your library has albums.' })];
  const filled = Object.entries(s.filled)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${SOURCES[/** @type {keyof typeof SOURCES} */ (k)] ?? k} ${n(v)}`);
  const p = s.picks;
  return [
    line('Albums matched', `${n(s.albums.matched)} of ${n(s.albums.total)}, ${n(s.songs.matched)} songs. ${n(s.albums.due)} still to look at.`),
    line('Artists', `${n(s.artists.done)} of ${n(s.artists.total)} with their facts.`),
    line('Filled by', filled.length ? filled.join(', ') : 'Nothing yet.'),
    line('Picks', `${n(p.new)} offered, ${n(p.declined)} declined, ${n(p.ordered)} ordered, ${n(p.added)} added.`),
    line('Sources', hostWords(s.hosts)),
    ...(s.waveforms ? [line('Waveforms', `${n(s.waveforms.rms)} new, ${n(s.waveforms.peak)} old, ${n(s.waveforms.none)} songs with none.`)] : []),
    el('p', { class: 'shelp', 'data-phase': s.phase, text: PHASE[s.phase] ?? '' }),
  ];
}

/** The unmatched albums. @param {UnmatchedResponse} u */
export function unmatchedParts(u) {
  if (!u.items.length) return [];
  return [
    el('p', { class: 'shelp', text: `Not matched (${n(u.total)}):` }),
    ...u.items.map((i) => line(i.album, `${i.artist} · ${WHY[i.reason] ?? i.reason}`)),
  ];
}

export function knowBlock() {
  const counts = el('div', { class: 'mmeters', 'data-know': '', 'aria-busy': 'true' }, [el('p', { class: 'sempty', text: 'Reading…' })]);
  const load = async () => {
    if (navigator.onLine === false) {
      counts.replaceChildren(el('p', { class: 'sempty', text: 'You’re offline. This shows once you’re back.' }));
      counts.removeAttribute('aria-busy');
      return;
    }
    try {
      const [s, u] = await Promise.all([
        signedIn((t) => api.call('/v1/music/know', { token: t })),
        signedIn((t) => api.call('/v1/music/unmatched', { token: t })),
      ]);
      counts.replaceChildren(...knowParts(s), ...unmatchedParts(u));
    } catch {
      counts.replaceChildren(el('p', { class: 'sempty', text: 'I couldn’t read this just now.' }));
    }
    counts.removeAttribute('aria-busy');
  };
  const box = el('div', { class: 'group mfold', id: 'music-know' }, [
    el('div', { class: 'row srow', 'data-info': '' }, [
      icon('book-open-text'),
      el('div', { class: 'row-copy stext' }, [
        el('div', { class: 'st1', text: 'What I know about your music' }),
        el('div', { class: 'st2', text: 'Facts from MusicBrainz, ListenBrainz, Wikidata and Wikipedia (Last.fm and Discogs with their keys), found by each album’s and artist’s id. Only those ids and names leave, never your plays.' }),
      ]),
    ]),
    counts,
  ]);
  window.addEventListener('online', load, { once: true });
  load();
  return box;
}
