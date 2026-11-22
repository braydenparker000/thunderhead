// The Worker's own heartbeat and the mind's state in plain words (OPERATIONS.md §8.5): the cron
// records when it ran and which steps failed; deep health carries the last cron, the last day roll,
// schema steps missing, the mind's state and whether a push can reach a phone; a cron not seen for
// 45 minutes, or one whose step failed, is a Briefing line; the mind unable to answer for 2 hours
// is one line, with why, gone when it answers; the outside watcher's word on the site (the CI key
// only) pushes once when it goes down and once when it is back. Synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeepHealthResponse } from '../../../shared/contract/api';
import { limited, maybeWake, setPresence } from '../../src/areas/mind/wake';
import { runCron } from '../../src/areas/ops/cron';
import { alarms, mindWatch } from '../../src/areas/watchdogs/owner';
import { DAY, HOUR, MINUTE } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';
import { commit, type Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { api, apiJson, authSql, coreSql, makeAgent } from '../helpers';
import { setupWatchdogs, stub } from '../watchdog-helpers';

let D = '';
let C = '';
let I = '';
beforeAll(async () => {
  const p = await setupWatchdogs();
  D = p.D;
  C = p.C;
  I = await makeAgent(D, 'ci');
});

/** 10:00 UTC ten days on: clear of the real clock's midnight and of the setup's live chat lease. */
const T = Date.parse(`${new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10)}T10:00:00Z`);
const inCore = <T>(fn: (db: Db) => T) => runInDurableObject(stub(), (o: Core) => fn((o as unknown as { db: Db }).db));
const write = (fn: (w: Writer) => void, at: number) =>
  runInDurableObject(stub(), (o: Core, state) => {
    commit(state.storage, (o as unknown as { db: Db }).db, fn, at);
  });

describe('the heartbeat', () => {
  it('the cron records its run; deep health carries it with the roll, the schema, the mind and push', async () => {
    const t = T;
    expect(await runCron(env, t)).toEqual([]);
    const [beat] = await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'ops.cron'");
    expect(JSON.parse(beat.value_json)).toEqual({ at: t, failed: [] });
    const deep = (await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: D })).body;
    expect(deep.watch).toEqual({
      cron: { at: t, failed: [] },
      roll_at: null, // no day has rolled yet in this suite
      mind: expect.objectContaining({ line: null }),
      push: false,
      missing: [],
      lines: [],
    });
    // 46 minutes without a run: itself a line.
    expect(await inCore((db) => alarms(db, t + 46 * MINUTE, 'UTC').lines)).toEqual([
      `The 15-minute background check hasn't run since 10:00, so reminders and pushes may be late. Nothing needed from you.`,
    ]);
  });

  it('a step that fails no longer stops the run and is named, where before it was only logged', async () => {
    const t = Date.now();
    const failed = await runCron({ ...env, AUTH: undefined } as unknown as Env, t);
    expect(failed).toEqual(expect.arrayContaining(['auth', 'pushes']));
    const [beat] = await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'ops.cron'");
    expect(JSON.parse(beat.value_json).failed).toEqual(failed);
    expect((await inCore((db) => alarms(db, t + MINUTE, 'UTC').lines))[0]).toMatch(
      /^The last background check couldn't finish the sign-in tidy-up\b.*pushes\. It tries again every 15 minutes\.$/,
    );
    await runCron(env, t + MINUTE);
  });
});

describe("the mind's state in plain words", () => {
  const hhmm = (at: number) => new Date(at).toISOString().slice(11, 16);

  it('the plan’s limit, from 2 hours on, with until when; gone when it answers', async () => {
    const t = T;
    await write((w) => limited(w, 'rate_limit'), t);
    expect((await inCore((db) => mindWatch(db, t + HOUR, 'UTC'))).line).toBeNull();
    // A limit that runs on (the hook reports it again near its end).
    await write((w) => limited(w, 'rate_limit'), t + 2 * HOUR - 10 * MINUTE);
    const m = await inCore((db) => mindWatch(db, t + 2 * HOUR, 'UTC'));
    expect(m).toMatchObject({ state: 'limited', since: t, cause: 'limit' });
    expect(m.line).toBe(
      `The mind hasn't answered since ${hhmm(t)}: it reached the plan's limit until ${hhmm(m.until ?? 0)}. Music, reminders and the rest still work, and your messages are kept.`,
    );
    const deep = (await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: D })).body;
    expect(deep.watch?.mind.state).toBe('limited');
    await write((w) => setPresence(w, 'working'), t + 2 * HOUR + MINUTE);
    expect((await inCore((db) => mindWatch(db, t + 2 * HOUR + 2 * MINUTE, 'UTC'))).line).toBeNull();
  });

  it('the routine not set up, and could not be started', async () => {
    const t = T + 4 * HOUR;
    await write((w) => {
      maybeWake(w, 'message', false);
    }, t);
    expect((await inCore((db) => mindWatch(db, t + 2 * HOUR, 'UTC'))).line).toBe(
      `The mind hasn't answered since ${hhmm(t)}: its routine isn't set up. Music, reminders and the rest still work, and your messages are kept.`,
    );
    await write((w) => setPresence(w, 'failed'), t + MINUTE);
    expect(await inCore((db) => alarms(db, t + 3 * HOUR, 'UTC').lines)).toContain(
      `The mind hasn't answered since ${hhmm(t + MINUTE)}: it couldn't be started. Music, reminders and the rest still work, and your messages are kept.`,
    );
    await write((w) => setPresence(w, 'listening'), t + 3 * HOUR);
  });
});

describe("the outside watcher's word on the site", () => {
  it('the CI key only; one push when it goes down and one when it is back', async () => {
    const say = (token: string, state: string) => api('POST', '/v1/ops/site', { token, body: { state } });
    expect((await say(D, 'down')).status).toBe(403);
    expect((await say(C, 'down')).status).toBe(403);
    expect((await api('POST', '/v1/ops/site', { body: { state: 'down' } })).status).toBe(401);
    expect((await say(I, 'sideways')).status).toBe(422);
    const pushed = async (token: string, state: string) =>
      ((await (await say(token, state)).json()) as { pushed: unknown }).pushed;
    expect(await pushed(I, 'up')).toBeNull();
    expect(await pushed(I, 'down')).toBe('down');
    expect(await pushed(I, 'down')).toBeNull();
    expect(await pushed(I, 'up')).toBe('up');
    expect(await pushed(I, 'up')).toBeNull();
    const rows = await authSql<{ body: string }>("SELECT body FROM pushes WHERE kind = 'site' ORDER BY created_at");
    expect(rows.map((r) => r.body)).toEqual([
      "The site isn't loading. Your data is safe.",
      'The site is loading again.',
    ]);
  });
});
