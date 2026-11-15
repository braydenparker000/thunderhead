// The Streams screen's filters (frontend/astra/src/addons/stream-facts.js): what a stream's own words
// say (size, picture size, codec), the owner's chips over that (smallest first, a size limit, any of
// the picture sizes and codecs), and what an hour of a stream costs in data. Invented streams only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_FILTERS, anyFilter, bytesOf, factsOf, filtersFrom, minutesOf, passes, perHour, playFactsOf, shown } from '../frontend/astra/src/addons/stream-facts.js';
import { DIRECT, SOFTWARE, SOUND, questionOf, soundNote, wordsFor } from '../frontend/astra/src/addons/device-facts.js';

const s = (name, title, more = {}) => ({ name, title, ...more });

test('a stream is read from its own words: size, picture size, codec', () => {
  assert.deepEqual(factsOf(s('Example 1080p', 'Show.S01E01.1080p.WEB-DL.x265-GRP\n💾 1.4 GB')), { bytes: 1.4e9, res: '1080', codec: 'hevc' });
  assert.deepEqual(factsOf(s('Example 4K', 'Film 2160p UHD HDR HEVC 💾 18,5 GB')), { bytes: 18.5e9, res: '4k', codec: 'hevc' });
  assert.deepEqual(factsOf(s('Example', 'Film.720p.BluRay.x264 [850 MB]')), { bytes: 850e6, res: '720', codec: 'h264' });
  assert.deepEqual(factsOf(s('Example', 'Film AV1 480p 300MiB')), { bytes: 300 * 2 ** 20, res: 'sd', codec: 'av1' });
  assert.deepEqual(factsOf(s('Example', 'An episode')), { bytes: null, res: null, codec: null });
  // The add-on's own number wins over the text; the file name is read too.
  assert.equal(bytesOf(s('Example', '💾 2 GB', { size: 123_000_000 })), 123_000_000);
  assert.deepEqual(factsOf(s('Example', '', { filename: 'Film.2019.1080p.H.265.mkv' })), { bytes: null, res: '1080', codec: 'hevc' });
  // Not fooled by a year or a number that is not a picture size.
  assert.equal(factsOf(s('Example', 'Film 2160 (1999)')).res, '4k');
  assert.equal(factsOf(s('Example', 'Blade Runner 2049')).res, null);
});

test('the chips: a limit hides what is larger or of unknown size; picture sizes and codecs are any-of', () => {
  const list = [s('a', '1080p x264 💾 4 GB'), s('b', '720p x265 💾 600 MB'), s('c', '1080p x265 💾 1.4 GB'), s('d', 'no word of size')];
  const names = (f) => shown(list, f).map(([x]) => x.name).join('');
  assert.equal(names(NO_FILTERS), 'abcd', "nothing chosen: the add-on's own list and order");
  assert.equal(names({ ...NO_FILTERS, maxMb: 1500 }), 'bc', 'the unknown one may be any size, so it is hidden');
  assert.equal(names({ ...NO_FILTERS, maxMb: 700 }), 'b');
  assert.equal(names({ ...NO_FILTERS, res: ['1080'] }), 'ac');
  assert.equal(names({ ...NO_FILTERS, res: ['1080', '720'], codec: ['hevc'] }), 'bc');
  assert.equal(names({ ...NO_FILTERS, codec: ['av1'] }), '');
  // Smallest first: by size, the unknown last, ties in the add-on's order; each keeps its place in the list.
  assert.equal(names({ ...NO_FILTERS, small: true }), 'bcad');
  assert.deepEqual(shown(list, { ...NO_FILTERS, small: true }).map(([, i]) => i), [1, 2, 0, 3]);
  assert.equal(passes(factsOf(list[0]), { ...NO_FILTERS, maxMb: 3000 }), false);
});

test('filters as stored are made safe; data an hour from size and runtime', () => {
  assert.deepEqual(filtersFrom(null), NO_FILTERS);
  assert.deepEqual(filtersFrom({ small: true, maxMb: 1500, res: ['720', 'huge'], codec: 'hevc' }), { small: true, maxMb: 1500, res: ['720'], codec: [] });
  assert.equal(filtersFrom({ maxMb: 42 }).maxMb, 0, 'only the limits the chips offer');
  assert.equal(anyFilter(NO_FILTERS), false);
  assert.equal(anyFilter({ ...NO_FILTERS, res: ['sd'] }), true);
  assert.deepEqual(['118 min', '1h 58m', '2h', '45', '', null].map(minutesOf), [118, 118, 120, 45, null, null]);
  assert.equal(perHour(1.4e9, 118), '710 MB an hour');
  assert.equal(perHour(18.5e9, 118), '9.4 GB an hour');
  assert.equal(perHour(150e6, 24), '380 MB an hour');
  assert.equal(perHour(null, 118), '');
  assert.equal(perHour(1e9, null), '');
  assert.equal(perHour(1e5, 60), '', 'under 1 MB an hour says nothing, not "0 MB an hour"');
  assert.equal(perHour(3e6, 60), '3 MB an hour');
});

test('sizes as people write them: thousands, decimal commas, binary units, terabytes', () => {
  const b = (t) => bytesOf(s('Example', t));
  assert.equal(b('💾 1,400 MB'), 1400e6);
  assert.equal(b('1.400,5 MB'), 1400.5e6);
  assert.equal(b('1,400.5 MB'), 1400.5e6);
  assert.equal(b('1 400 MB'), 1400e6);
  assert.equal(b('1.4 GiB'), Math.round(1.4 * 2 ** 30));
  assert.equal(b('700 MiB'), 700 * 2 ** 20);
  assert.equal(b('Film 1.400 GB'), 1.4e9, 'one separator in GB is a decimal point');
  assert.equal(b('S01E02 400 MB'), 400e6, 'an episode code is not part of the size');
  assert.equal(b('2.1 TB'), 2.1e12);
  // A terabyte file is hidden under any limit; one of unknown size stays unknown (and hidden too).
  assert.equal(passes(factsOf(s('a', '2.1 TB')), { ...NO_FILTERS, maxMb: 3000 }), false);
  assert.equal(b('no size here'), null);
});

test('picture size and codec: a file size is never a picture size; underscores and spaced names read', () => {
  const f = (t) => factsOf(s('Example', t));
  for (const t of ['💾 720 MB', '480 MB', '1080 MB']) assert.equal(f(t).res, null, t);
  assert.deepEqual(factsOf(s('Example', '', { filename: 'Film_2020_1080p_x265_HEVC.mkv' })), { bytes: null, res: '1080', codec: 'hevc' });
  assert.equal(f('UHD BluRay 1080p').res, '1080', 'an explicit 1080 wins over UHD');
  assert.deepEqual(['H 265', 'H-265', 'HEVC10bit'].map((t) => f(t).codec), ['hevc', 'hevc', 'hevc']);
  assert.deepEqual(['3840x2160', '1920x1080', '1920x800'].map((t) => f(t).res), ['4k', '1080', '1080']);
  assert.equal(f('Film 1080p VP9').codec, 'vp9');
  const p = playFactsOf(s('Example', '2160p DV HDR x265 DDP5.1 Atmos HEVC10bit'));
  assert.deepEqual([p.tenBit, p.hdr, p.sound], [true, true, true]);
  assert.equal(playFactsOf(s('Example', 'x264 AAC DTS')).sound, false, 'with AAC named, the sound may play as it is');
});

test('plays on this phone: the label gives the question, the browser answer gives the words', () => {
  const q = (t, more) => questionOf(s('Example', t, more));
  const video = (t, more) => q(t, more)?.config.video;
  assert.deepEqual(video('Ep 1 720p x265'), { contentType: 'video/mp4; codecs="hvc1.1.6.L120.90"', width: 1280, height: 720, bitrate: 4e6, framerate: 24 });
  assert.equal(q('Ep 1 720p x265').config.type, 'media-source');
  assert.equal(video('2160p HDR HEVC').contentType, 'video/mp4; codecs="hvc1.2.4.L150.B0"', 'HDR asks for Main10');
  assert.deepEqual([video('2160p HDR HEVC').width, video('Film AV1').width], [3840, 1920], 'no picture size named: 1080p');
  assert.equal(video('Film AV1 10bit').contentType, 'video/mp4; codecs="av01.0.12M.10"');
  assert.equal(video('Film VP9 HDR').contentType, 'video/mp4; codecs="vp09.02.40.10"');
  assert.equal(video('Film x264').contentType, 'video/mp4; codecs="avc1.640028"');
  assert.equal(video('Anime Hi10P x264').contentType, 'video/mp4; codecs="avc1.6e0028"');
  assert.equal(video('Film HDR x264').contentType, 'video/mp4; codecs="avc1.640028"', 'HDR alone does not make H.264 10-bit');
  assert.equal(video('Ep 1', { filename: 'ep1.mp4' }).contentType, 'video/mp4; codecs="avc1.640028"', 'an unlabelled MP4 is asked as H.264');
  assert.equal(q('Ep 1', { filename: 'ep1.mkv' }), null, 'an unlabelled MKV may hold anything: nothing said');
  assert.equal(q('Ep 1'), null);
  // The words: direct only for a smooth, power-efficient decoder.
  const hevc = q('720p x265'), avc = q('x264'), hi10 = q('Hi10P x264');
  assert.equal(wordsFor(hevc, { supported: true, smooth: true, powerEfficient: true }), DIRECT);
  assert.equal(wordsFor(hevc, { supported: true, smooth: true, powerEfficient: false }), SOFTWARE);
  assert.equal(wordsFor(hevc, { supported: false, smooth: false, powerEfficient: false }), SOFTWARE);
  assert.equal(wordsFor(hevc, null), '', 'no answer: nothing guessed');
  assert.equal(wordsFor(avc, null), DIRECT, 'no answer: 8-bit H.264 still plays directly');
  assert.equal(wordsFor(hi10, null), '');
  assert.equal(wordsFor(null, { supported: true, smooth: true, powerEfficient: true }), '');
  assert.equal(SOFTWARE, 'Needs the software decoder (uses more battery)');
  assert.deepEqual([soundNote(s('a', 'x265 DTS')), soundNote(s('a', 'x265 AAC'))], [SOUND, '']);
});
