// The Streams screen's filters (frontend/astra/src/addons/stream-facts.js): what a stream's own words
// say (size, picture size, codec), the owner's chips over that (smallest first, a size limit, any of
// the picture sizes and codecs), and what an hour of a stream costs in data. Invented streams only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_FILTERS, anyFilter, bytesOf, factsOf, filtersFrom, minutesOf, passes, perHour, shown } from '../frontend/astra/src/addons/stream-facts.js';

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
});
