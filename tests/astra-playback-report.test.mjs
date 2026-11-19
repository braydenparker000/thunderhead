// The playback report in plain words (frontend/astra/src/player/playback-report.js) without a browser: where the time
// went from the engine's `timing` entries, the route and why, the tracks, how the address was found (via, each step's
// time, the server's own), the server group, the link's speed and the stalls so far, then the log, where a kind the
// report does not know (the memory entries another part of the engine adds) is a plain line, not dropped; a film that
// never opened says so. Nothing in it may hold an address, hash, key, token or file name, even where a log line
// carried one. The player's own copy (Stream info, the error card) is in astra-resolve-browser.test.mjs. Invented
// hosts, hashes, tokens and films.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackReport, playerReport, plain, thisLoad, timeLines, resolverLines, scrubSecrets } from '../frontend/astra/src/player/playback-report.js';
import { resolveStream, forgetAnswers } from '../frontend/astra/src/addons/debrid.js';

const HASH = 'fedcba9876543210fedcba9876543210fedcba98';
const TOKEN = 'tok_Invented0123456789abcdefABCDEF';
const URL_ = `https://store-7.latm.tb-cdn.example/dl/${TOKEN}/Invented.Film.2024.mkv?token=${TOKEN}`;
const t0 = 50_000;
const LOG = [
  { t: 1000, kind: 'timing', detail: { step: 'open', ms: 200, bytes: 0, requests: 1 } }, // an earlier film
  { t: 1500, kind: 'status', detail: 'An earlier film.' },
  { t: t0 + 310, kind: 'timing', detail: { step: 'open', ms: 310, bytes: 65536, requests: 1 } },
  { t: t0 + 820, kind: 'timing', detail: { step: 'index', ms: 820, bytes: 1_200_000, requests: 2 } },
  { t: t0 + 990, kind: 'timing', detail: { step: 'track', ms: 160, bytes: 1_300_000, requests: 3, track: 2, type: 'audio' } },
  { t: t0 + 1000, kind: 'timing', detail: { step: 'plan', ms: 1000, bytes: 1_300_000, requests: 3 } },
  { t: t0 + 1001, kind: 'plan', detail: { mode: 'remux', notes: [], reason: null } },
  { t: t0 + 1300, kind: 'timing', detail: { step: 'fragment', ms: 1300, bytes: 2_000_000, requests: 4 } },
  { t: t0 + 1500, kind: 'timing', detail: { step: 'picture', ms: 1500, bytes: 2_100_000, requests: 4 } },
  { t: t0 + 9000, kind: 'stall', detail: { at: 61.2, seek: 61.5 } },
  { t: t0 + 9100, kind: 'error', detail: { message: 'The host stopped.', detail: `GET ${URL_} failed for ${HASH}` } },
  { t: t0 + 9200, kind: 'memory', detail: { heap: 182, unit: 'MB', note: 'kept 3 fragments' } },
];
const engine = (more = {}) => ({
  url: URL_, mode: 'remux', plan: { reason: null, notes: ['Sound converted to Opus on this phone.'] }, log: LOG,
  info: { video: [{ label: 'H.264', width: 1920, height: 1080 }] },
  audioOptions: () => [{ label: 'English E-AC-3 5.1', selected: true, supported: true, delivery: 'rebuilt' }],
  subtitleOptions: () => [{ label: 'English', selected: true }, { label: 'Invented.Film.2024.en.srt', selected: false }],
  video: { currentTime: 75, videoWidth: 1920, videoHeight: 1080, getVideoPlaybackQuality: () => ({ totalVideoFrames: 1800, droppedVideoFrames: 3 }) },
  dataUsed: () => 41_000_000, session: { rebuffer: { link: { rate: () => 5_000_000 } } },
  ...more,
});
const ANSWER = { via: 'torbox', reason: null, total: 1407, steps: [{ step: 'cached', ok: true, ms: 300 }, { step: 'add', ok: true, ms: 1000, note: 'TorBox said it added it to your account now.' }, { step: 'link', ok: true, ms: 400 }] };
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

test('where the time went, the route, the tracks, the address’s steps, the server group, speed and stalls, then the log', async () => {
  const text = await playbackReport(engine(), { answer: ANSWER, ua: UA });
  assert.match(text, /^Astra playback report, \d{4}-\d\d-\d\d \d\d:\d\d UTC, Chrome 131, Android 14\n/);
  assert.match(text, /\nHow it plays: remux \(Astra unpacks it\)\n {4}Sound converted to Opus on this phone\.\n/);
  assert.match(text, /\nWhere the time went \(since the film’s load\):\n {4}opened: 310 ms \(\+310 ms\), 64 KiB in 1 request\n {4}index read: 820 ms \(\+510 ms\), 1\.1 MiB in 2 requests\n {4}track 2 \(audio\) read in 160 ms: 990 ms \(\+170 ms\)/);
  assert.match(text, /\n {4}way chosen: 1000 ms .*\n {4}first fragment: 1300 ms .*\n {4}first picture: 1500 ms \(\+200 ms\)/);
  assert.match(text, /\nAddress: from TorBox directly\n {4}your server’s own time: 1407 ms\n {4}cached ✓ 300 ms\n {4}add ✓ 1000 ms: TorBox said it added it to your account now\.\n {4}link ✓ 400 ms\n/);
  assert.match(text, /\nServer: TorBox group latm\n/);
  assert.match(text, /\nSpeed: 40\.0 Mbit\/s while downloading, 41\.0 MB downloaded so far\n/);
  assert.match(text, /\nStalls so far: 1 \(at 1:01\); waits for a slow link: 0\n/);
  assert.match(text, /\nNow: 1:15, 1920×1080, 1800 frames shown, 3 dropped\n/);
  assert.match(text, /\nTracks:\n {4}picture: H\.264 1920×1080\n {4}sound: English E-AC-3 5\.1 \(playing\), converted on this phone\n {4}subtitles: English \(shown\), 2 in all\n/);
  assert.match(text, /\nThis phone:\n {4}decodes H\.264 (yes|no), HEVC/);
  // The log of this film only; a kind the report does not know is a plain line.
  assert.match(text, /\nLog \(seconds since the load\):\n/);
  assert.match(text, /\n {4}\+9\.2 memory: heap 182, unit MB, note kept 3 fragments/);
  assert.ok(!text.includes('An earlier film'), 'the film before is not this one');
  for (const secret of [URL_, TOKEN, HASH, 'tb-cdn', 'store-7', 'Invented.Film', '.mkv', '.srt', 'token=']) assert.ok(!text.includes(secret), `the report holds ${secret}`);
  assert.match(text, /\+9\.1 error: message The host stopped\., detail GET \[removed\] failed for \*\*\*/);
});

test('a film that never opened says so, with how its address was asked for; an address not asked of the server says so', async () => {
  const none = { via: 'none', reason: 'This film is not on TorBox yet, so Astra did not start it.', total: null, steps: [{ step: 'add', ok: false, ms: 1000 }] };
  const text = await playbackReport(engine({ url: null, log: [] }), { opened: false, answer: none, known: [`https://addon.example/${HASH}/Invented.Film.2024.mkv`] });
  assert.match(text, /\nThe film was not opened\.\nAddress: none: not on TorBox yet: This film is not on TorBox yet, so Astra did not start it\.\n {4}add ✗ 1000 ms\n/);
  assert.ok(!/Where the time went|Tracks/.test(text));
  assert.deepEqual(resolverLines(null), ['Address: as given (not asked of your server)']);
});

test('the pieces: plain lines for any detail, this load’s part of the log, and the scrubber', () => {
  assert.equal(plain({ a: 1, b: [1, 2], c: 'x' }), 'a 1, b [1,2], c x');
  assert.equal(plain(['x', { y: 2 }]), 'x, y 2');
  assert.equal(plain(null), '');
  const { entries, start } = thisLoad(LOG);
  assert.equal(entries[0].t, t0 + 310);
  assert.equal(start, t0);
  assert.equal(timeLines(entries, start).length, 6);
  assert.equal(scrubSecrets(`see ${URL_} and Fonts.ttf`, { hosts: false }), 'see [address] [file]');
});

test('the player’s report finds how its own stream was asked for, by its link, and never another film’s steps', async () => {
  forgetAnswers();
  const LINK_A = 'https://addon.example/watch/a', LINK_B = 'https://addon.example/watch/b';
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    const json = body.link === LINK_A
      ? { url: 'https://s.latm.tb-cdn.example/dl/1', via: 'torbox', ready: false, steps: [{ step: 'add', ok: true, ms: 1234 }], total_ms: 1300 }
      : { error: { code: 'unavailable', message: 'x', details: { reason: 'This film is not on TorBox yet, so Astra did not start it.', steps: [{ step: 'add', ok: false, ms: 987 }] } } };
    return new Response(JSON.stringify(json), { status: body.link === LINK_A ? 200 : 503 });
  };
  const read = async () => ({ api: 'https://api.example', token: 'invented-session' });
  await resolveStream({ url: LINK_A }, { fetchFn, read });
  // Film B: picked, never opened (its stream has no address yet), and never asked about: no steps at all.
  const player = (link) => ({ stream: { url: null }, sourceId: 's1', sources: [{ id: 's1', stream: { url: link } }], engine: engine({ url: null, log: [] }) });
  const unasked = await playerReport(player(LINK_B));
  assert.match(unasked, /\nThe film was not opened\.\nAddress: not known\n/);
  assert.ok(!unasked.includes('1234 ms'), 'another film’s steps');
  // Asked and not on TorBox: its own steps.
  await resolveStream({ url: LINK_B }, { fetchFn, read });
  const asked = await playerReport(player(LINK_B));
  assert.match(asked, /\nAddress: none: not on TorBox yet: This film is not on TorBox yet, so Astra did not start it\.\n {4}add ✗ 987 ms/);
  assert.ok(!asked.includes('1234 ms') && !asked.includes('watch/b'));
  // Film A playing: found by the address it plays.
  const a = await playerReport({ stream: { url: 'https://s.latm.tb-cdn.example/dl/1' }, sources: [], engine: engine({ url: 'https://s.latm.tb-cdn.example/dl/1' }) });
  assert.match(a, /\nAddress: from TorBox directly\n {4}your server’s own time: 1300 ms\n {4}add ✓ 1234 ms/);
  forgetAnswers();
});

test('the scrubber: names with spaces, fonts, escaped and encoded addresses, secrets at any word, magnets, hashes; ordinary words stay', () => {
  const cases = [
    ['error loading My Secret Film (2020) 1080p.mkv here', '[file] here'],
    ['file [Group] Some Title 2020 BluRay.mkv', '[file]'],
    ['Sound: (My Secret Film (2020).mkv) ok', 'Sound: ([file]) ok'],
    ['url https:\\/\\/nexus-1.latm.tb-cdn.io\\/dl\\/abc?token=SHORT1', 'url [address]'],
    ['plain token=short-token-value here', 'plain token=*** here'],
    ['encoded https%3A%2F%2Fapi.torbox.app%2Fv1%2Fapi%2Ftorrents%2Frequestdl%3Ftoken%3Dabcdef12%26torrent_id%3D5', 'encoded [address]'],
    ['magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=My+Film', '[magnet]'],
    ['magnet:?xt=urn:btih:abcd&dn=My.Film.2020.1080p', '[magnet]'],
    ['hash split abcdef0123456789abcd ef0123456789abcdef01', 'hash split *** ***'],
    ['b32 MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U', 'b32 ***'],
    ['//nexus.tb-cdn.io/dld/123?token=abc', '[address]'],
    ['nexus.tb-cdn.io/dld/123?x=1\n&token=abc', '[address]\n&token=***'],
    ['https://host/a?x=1\ntoken=abc', '[address]\ntoken=***'],
    ['font Fansub Font Bold.ttf missing; woff Custom Sans.woff2', '[file] missing; [file]'],
    ['fonts Gandhi Sans.woff, Old.TTC and Other.otc', '[file], [file] [file]'],
    ['track title Movie.Name.2020.1080p.BluRay.x264-GRP', 'track title [name]'],
    ['key%3Dabc1234', 'key%3D***'],
    ['apikey: 1234abcd', 'apikey: ***'],
    ['{"url":"https://h/x?token=a"}', '{"url":"[address]"}'],
  ];
  for (const [text, want] of cases) assert.equal(scrubSecrets(text, { hosts: false }), want, text);
  // The lab's and the report's own words read as they were.
  const ordinary = [
    '(b) TorBox key: ok', '    A key is set, accepted by TorBox, plan 2.', 'First 64 KiB: 206, readable, 64 KiB read (first byte 12 ms, all of it 30 ms)',
    'Route: remux (Astra unpacks it): the sound is converted.', '    decodes H.264 yes, HEVC 10-bit no, E-AC-3 no', 'Server group: latm', 'Server: TorBox group latm',
    '    link ✓ 400 ms: The address is on a TorBox file server, came straight from TorBox, and carries your account\'s token.',
    'Speed: 40.0 Mbit/s while downloading, 41.0 MB downloaded so far', 'Picture: H.264 1920×1080 HDR', 'Sound: E-AC-3 6 ch (en)', 'Now: 1:15, 1920×1080',
  ];
  for (const line of ordinary) assert.equal(scrubSecrets(line, { hosts: false }), line);
});
