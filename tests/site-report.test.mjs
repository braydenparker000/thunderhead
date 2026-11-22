// The whole-site report (frontend/th/report/site.js, Settings › About › Copy report; MENU-AND-SETTINGS.md
// §6.8): numbers and states only. Everything the phone and the Worker hand it is planted with the owner's
// kind of words (a message, a title, a name, an address, a song id); none of them reaches the report, and
// the report stays under 60 KB however much it is handed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, LIMIT } from '../frontend/th/report/site.js';
import { dayOf } from '../frontend/th/data/tally.js';

const PLANTED = ['Ada Lovelace', 'ada@example.com', 'Planted Song Title', 'secret words typed here', 'https://private.example.com/x',
  'r2_native_planted', 'planted-branch', 'Elm Street 12', 'a note the mind wrote', 'Planted Thread'];
const [NAME, MAIL, SONG, WORDS, URL_, SONG_ID, BRANCH, ADDRESS, NOTE, THREAD] = PLANTED;

/** Everything the report reads, as the phone and the Worker would hand it, with words planted in every field that has any. */
function raw(n = 1) {
  const now = Date.UTC(2026, 10, 21, 12);
  return {
    now,
    config: { build: 412, commit: '0905e1e4abcdef0123456789abcdef0123456789', preview: BRANCH, api: URL_, repo_url: URL_ },
    health: { ok: true, version: { id: '8c1f0a2b-1111-2222-3333-444455556666', tag: 'v412' }, min_client: 400, at: now },
    deep: {
      ok: false, version: { id: '8c1f0a2b-1111-2222-3333-444455556666', tag: 'v412' }, schema: { core: 31, auth: 7 },
      objects: { core: { ok: false, schema: 31, expected: 32, missing: [32], db_bytes: 1_000_000, jobs_backlog: 2, last_alarm_at: null, note: WORDS } },
      meter_today: { rows_written: 1200, rows_read: 50_000, bulk_rows_written: 0, bulk_lane: WORDS },
      last_backup: { date: '2026-11-20', age_h: 30 }, last_events_export: null, errors_open: 3, wakes_today: 2, min_client: 400,
    },
    workers: Array.from({ length: 3 * n }, (_, i) => ({ scope: ['/', '/music/', '/podcasts/'][i % 3], active: 'activated', waiting: i ? null : 'installed', installing: null, script: `${URL_}/sw.js` })),
    controlled: true,
    caches: Array.from({ length: 6 * n }, (_, i) => ({ name: i ? `th-${400 + i}` : SONG, entries: 300 + i, bytes: 2_400_000 + i, more: false, urls: [SONG, URL_] })),
    storage: { usage: 120_000_000, quota: 2_000_000_000, persisted: true, usageDetails: { [SONG]: 1 } },
    push: { permission: 'granted', subscribed: true, endpoint: URL_ },
    network: { type: 'cellular', effective: '4g', saveData: false, online: true },
    look: 'ink-lamp', theme: 'dark', themeChoice: 'auto',
    errors: Array.from({ length: 50 * n }, (_, i) => ({
      fingerprint: `home:${i}`, source: i % 7 ? 'client' : 'worker', route: `/settings/${NAME}`, code: i % 5 ? 'home.error' : WORDS,
      message: `TypeError: ${WORDS} "${SONG}" at ${MAIL} @ /th/chat/view.js:${10 + i}:5`, count: 2, first_at: now - 1000 * i, last_at: now - 1000 * i, last_build: 412, resolved_at: null,
    })),
    watchdogs: Array.from({ length: 12 * n }, (_, i) => ({
      name: i % 2 ? 'errors.spike' : 'roll.stuck', state: i % 3 ? 'tripped' : 'ok', severity: 'S3', slo: WORDS, trips: WORDS, since: now - 60_000,
      detail: `${NAME} ${ADDRESS}`, handled: { at: now, outcome: 'reported', note: NOTE }, waits: null,
    })),
    tally: { v: 1, since: now - 86_400_000, unsized: 4, days: { [dayOf(now)]: { home: [1000, 2000, 0], 'music.songs': [5_000_000, 0, 0], [SONG]: [9, 9, 9] } } },
    presence: { state: 'working', note: NOTE, since: now - 5000, title: THREAD, using: [{ app: WORDS }], title_at: now },
    usage: { today: { day: '2026-11-21', wakes: { owner: 2, watch: 1 }, minutes: { chat: 14 }, night_min: 30, watches: { refused: 0 } }, days: [], budget: 6, live: 1 },
    sync: {
      music: { v: 1, marks: now - 60_000, lists: now - 30_000, dirty: { [SONG_ID]: 1 }, sent: { [SONG]: 1 }, gone: {} },
      guitar: { v: 1, since: now - 120_000, sent: { [SONG]: 1 } },
      podcasts: { v: 1, since: { progress: now - 10_000, follows: now - 20_000 }, sent: { [SONG]: 1 }, follows: { [URL_]: 1 } },
    },
  };
}

test('the report carries none of the owner\'s words, titles, names or addresses', () => {
  const text = JSON.stringify(build(raw()));
  for (const s of PLANTED) assert.ok(!text.includes(s), `the report carries "${s}"`);
  assert.doesNotMatch(text, /@|https?:/);
});

test('the report has what a repair needs: release, Worker, schema, workers, caches, storage, errors as file:line, trips, meter, mind, sync', () => {
  const r = build(raw());
  assert.equal(r.release.build, 412);
  assert.equal(r.release.commit, '0905e1e4abcdef0123456789abcdef0123456789');
  assert.equal(r.release.preview, true);
  assert.equal(r.worker.tag, 'v412');
  assert.deepEqual(r.worker.deep.objects.core, { ok: false, schema: 31, expected: 32, missing: [32], db_bytes: 1_000_000, jobs_backlog: 2 });
  assert.equal(r.workers.length, 3);
  assert.deepEqual(r.workers[0], { scope: '/', active: 'activated', waiting: 'installed', installing: null });
  assert.deepEqual(r.caches[0], { name: 'other', entries: 300, bytes: 2_400_000, more: false });
  assert.equal(r.caches[1].name, 'th-401');
  assert.deepEqual(r.storage, { usage: 120_000_000, quota: 2_000_000_000, persisted: true });
  assert.deepEqual(r.push, { permission: 'granted', subscribed: true });
  assert.equal(r.errors.length, 20);
  assert.deepEqual(r.errors[0], { code: 'home.error', at: 'th/chat/view.js:11', count: 2, last_at: raw().now - 1000, build: 412 });
  assert.ok(r.errors.every((e) => e.code === null || e.code === 'home.error'));
  assert.ok(r.watchdogs.every((w) => w.since && ['errors.spike', 'roll.stuck'].includes(w.name)));
  assert.equal(r.watchdogs.length, 8);
  assert.deepEqual(r.data.today.parts.home, [1000, 2000, 0]);
  assert.equal(r.mind.state, 'working');
  assert.equal(r.mind.wakes_today, 3);
  assert.deepEqual(r.synced, { music: raw().now - 30_000, guitar: raw().now - 120_000, podcasts: raw().now - 10_000 });
});

test('the report stays under 60 KB however much it is handed, and an empty phone still makes one', () => {
  const big = JSON.stringify(build(raw(40)));
  assert.ok(new TextEncoder().encode(big).length < LIMIT, `${big.length} bytes`);
  assert.equal(LIMIT, 60 * 1024);
  const empty = build({ now: 1, config: {} });
  assert.equal(empty.worker.tag, null);
  assert.deepEqual(empty.errors, []);
  assert.deepEqual(empty.synced, { music: null, guitar: null, podcasts: null });
});
