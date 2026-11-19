// What a stream card shows, read from a stream's own words (frontend/astra/src/addons/release-facts.js), on
// invented lines in the styles real add-ons write: emoji-led lines, pipe-separated facts, bracketed tags and
// plain file names; and Astra's format for AIOStreams (addons/astra-format.js), read exactly. Every name,
// group, indexer and hash here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designedEnough, releaseFacts, releaseName, splitMiddle } from '../frontend/astra/src/addons/release-facts.js';
import { AIO_DESCRIPTION, AIO_FORMAT_TEXT, AIO_NAME, readAstraFormat } from '../frontend/astra/src/addons/astra-format.js';

const HASH = 'c'.repeat(40);
const pick = (f, keys) => Object.fromEntries(keys.map((k) => [k, k === 'sound' ? [f.sound.codec, f.sound.channels, f.sound.atmos].filter(Boolean).join(' ') : f[k]]));

// [what it is like, stream, facts expected (only the keys given are compared)]
const CASES = [
  ['a torrent-style name line and a dotted release', { name: '[RD+] Exampletorrent\n4k DV | HDR', title: `Invented.Film.2019.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.7.1.Atmos-FAKEGRP\n👤 45 💾 58.2 GB ⚙️ ExampleBay\n🇬🇧 / 🇮🇹` },
    { res: '2160p', resLabel: '4K', source: 'Remux', picture: ['DV', 'HDR'], codec: 'HEVC', sound: 'TrueHD 7.1 true', languages: ['English', 'Italian'], bytes: 58.2e9, group: 'FAKEGRP', indexer: 'ExampleBay', ready: true, service: 'RD', seeders: 45 }],
  ['emoji-led facts lines, ready on TorBox', { name: 'AIO\n1080p', title: '📺 1080p · x264 · AAC\n💾 2.1 GB · ⚡ Ready (TB)' },
    { res: '1080p', source: null, codec: 'AVC', sound: 'AAC', bytes: 2.1e9, ready: true, service: 'TB', release: '' }],
  ['one pipe-separated line with languages and an indexer', { name: 'Examplecomet', title: 'Invented Film (2019) 1080p WEB-DL DDP5.1 H.264 ITA ENG | 💾 4.3 GB | 🔎 Exampleindex' },
    { res: '1080p', source: 'WEB-DL', codec: 'AVC', sound: 'DD+ 5.1', languages: ['English', 'Italian'], bytes: 4.3e9, indexer: 'Exampleindex', ready: null }],
  ['an anime file name with the group in brackets', { name: 'Example', title: '', filename: '[InventedSubs] Show - 01 (720p) [ABCD1234].mkv' },
    { res: '720p', group: 'InventedSubs', release: '[InventedSubs] Show - 01 (720p) [ABCD1234].mkv' }],
  ['a title word is not a language; DTS-HD MA with its channels', { name: 'X', title: 'The.Italian.Film.2003.1080p.BluRay.x264.DTS-HD.MA.5.1-INV' },
    { languages: [], source: 'BluRay', sound: 'DTS-HD MA 5.1', group: 'INV' }],
  ['not ready: an hourglass, seeders and a download tag', { name: '[TB download] Example\n720p', title: 'Show.S01E02.720p.HDTV.x265-GRP\n⏳ 👥 1,203 💾 400 MB' },
    { res: '720p', source: 'HDTV', codec: 'HEVC', ready: false, service: 'TB', seeders: 1203, bytes: 400e6 }],
  ['HDR10+ and 10-bit; a size is never a resolution', { name: 'Example', title: 'Film 2160p WEBRip HDR10+ 10bit AV1 Opus 💾 720 MB' },
    { res: '2160p', source: 'WEBRip', picture: ['HDR10+', '10-bit'], codec: 'AV1', sound: 'Opus', bytes: 720e6 }],
  ['a picture size by its width, plain text sound', { name: 'Example', title: 'Film 1920x800 BluRay HEVC AC3 2.0 Multi' },
    { res: '1080p', codec: 'HEVC', sound: 'DD 2.0', languages: ['Multi'] }],
  ['a label that says nothing', { name: 'Example', title: 'An episode' }, { res: null, source: null, picture: [], codec: null, languages: [], bytes: null, ready: null }],
  ['the hash is never read as words ("dd5…", "ac3…")', { name: 'Example', title: `1080p WEB\n${'dd5ac3'.padEnd(40, 'a')}` }, { sound: '' }],
  ['CAM and a 576p DVD', { name: 'Example', title: 'Film.2024.HDCAM.576p.x264' }, { source: 'CAM', res: '576p' }],
];

for (const [what, stream, want] of CASES) {
  test(`reads ${what}`, () => assert.deepEqual(pick(releaseFacts(stream), Object.keys(want)), want));
}

test('the release name: the file name, else a description line shaped like one; emoji and hash gone', () => {
  assert.equal(releaseName({ title: `🎬 Invented.Film.2019.1080p.WEB-DL.x264-GRP\n💾 2 GB\n${HASH}` }), 'Invented.Film.2019.1080p.WEB-DL.x264-GRP');
  assert.equal(releaseName({ title: '📺 1080p · x264 · AAC' }), '', 'a facts line is not a name');
  assert.equal(releaseName({ title: 'whatever', filename: 'Film.2019.mkv' }), 'Film.2019.mkv');
  assert.equal(releaseName({ name: 'Example\nInvented Film 2019 1080p', title: '' }), 'Invented Film 2019 1080p');
});

test('a designed card needs the resolution and two more facts; the middle of a long name gives way', () => {
  assert.equal(designedEnough(releaseFacts({ title: '1080p x264 💾 2 GB' })), true);
  assert.equal(designedEnough(releaseFacts({ title: '1080p' })), false, 'a resolution alone');
  assert.equal(designedEnough(releaseFacts({ title: 'x264 💾 2 GB BluRay' })), false, 'no resolution');
  assert.deepEqual(splitMiddle('Invented.Film.2019.2160p.BluRay-FAKEGRP.mkv'), ['Invented.Film.2019.2160p.BluR', 'ay-FAKEGRP.mkv']);
  assert.deepEqual(splitMiddle('Short.mkv'), ['Short.mkv', '']);
});

test("Astra's format for AIOStreams: the templates use AIOStreams' variables, and the reader takes them exactly", () => {
  for (const v of ['stream.resolution', 'stream.quality', 'stream.visualTags', 'stream.encode', 'stream.audioTags', 'stream.audioChannels', 'stream.languages', 'stream.size',
    'stream.releaseGroup', 'stream.indexer', 'addon.name', 'service.shortName', 'service.cached', 'stream.seeders', 'stream.type', 'stream.filename', 'stream.infoHash']) assert.ok(AIO_DESCRIPTION.includes(`{${v}`) || AIO_DESCRIPTION.includes(`={${v}`), v);
  assert.match(AIO_NAME, /^\{config\.addonName\}/);
  assert.ok(AIO_FORMAT_TEXT.startsWith('NAME\n') && AIO_FORMAT_TEXT.includes('\n\nDESCRIPTION\nAstra/1'));
  // What AIOStreams renders from it (written by hand from its template rules: absent groups vanish, empty lines go).
  const title = `Astra/1|res=2160p|src=BluRay REMUX|vis=HDR+DV,10bit|enc=HEVC|aud=Atmos,TrueHD|ch=5.1,7.1|lang=English,Italian|size=58200000000|grp=FAKEGRP|idx=Exampleindex|via=Exampleinner|svc=TB|ready=1|seed=45|type=debrid
Invented.Film.2019.2160p.BluRay.REMUX.HEVC-FAKEGRP.mkv
${HASH}`;
  const f = readAstraFormat({ name: 'AIOStreams 2160p ⚡', title });
  assert.deepEqual(f, { exact: true, res: '2160p', resLabel: '4K', source: 'Remux', picture: ['DV', 'HDR', '10-bit'], codec: 'HEVC', sound: { codec: 'TrueHD', channels: '7.1', atmos: true },
    languages: ['English', 'Italian'], bytes: 58.2e9, group: 'FAKEGRP', indexer: 'Exampleindex', via: 'Exampleinner', service: 'TB', ready: true, seeders: 45, kind: 'debrid',
    release: 'Invented.Film.2019.2160p.BluRay.REMUX.HEVC-FAKEGRP.mkv', hash: HASH });
  assert.equal(releaseFacts({ name: 'x', title }).exact, true, 'the card reader prefers the exact format');
  // A sparse one: absent facts are simply absent; "Unknown" is nothing; no file name, the hash still found.
  const sparse = readAstraFormat({ title: `Astra/1|res=Unknown|seed=0|type=p2p\n${HASH}` });
  assert.deepEqual([sparse.res, sparse.source, sparse.picture, sparse.seeders, sparse.ready, sparse.release, sparse.hash], [null, null, [], 0, null, '', HASH]);
  assert.equal(readAstraFormat({ title: 'Astra/2|res=1080p' }), null, 'only the version Astra knows');
  assert.equal(readAstraFormat({ title: '📺 1080p · x264' }), null);
});
