// Shared by the watchdog suites (watchdogs.test.ts, watchdogs-drill.test.ts): a watchdog pass run
// in the object through commit() at a fake clock, the fixtures that trip each built watchdog, and
// the ledger notes a case wrote. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { expect } from 'vitest';
import * as watchdogs from '../src/areas/watchdogs/ops';
import { commit, type Writer } from '../src/objects/commit';
import type { Core } from '../src/objects/core';
import { core, coreSql, makeAgent } from './helpers';
import { type Principals, principals } from './memory-helpers';

export const stub = () => core() as unknown as DurableObjectStub<Core>;
/** 10:00 UTC on a Tuesday. */
export const T0 = Date.UTC(2026, 9, 20, 10, 0);
export const BIG = 800 * 1024 * 1024;
let mark = 0;
let dayRow: Record<string, unknown> | undefined;

type Ctx = { dbBytes?: number; nightConfigured?: boolean; reflexOn?: boolean };
/** One watchdog pass at `at` (time zone UTC), as the tick runs it. */
export const watch = (at: number, c: Ctx = {}) =>
  runInDurableObject(
    stub(),
    (o: Core, state) =>
      commit(
        state.storage,
        (o as unknown as { db: Writer['db'] }).db,
        (w) =>
          watchdogs.watch(
            w,
            { tz: 'UTC', dbBytes: c.dbBytes ?? 1_000, nightConfigured: c.nightConfigured ?? false },
            c.reflexOn ?? false,
          ),
        at,
      ).value,
  );
/** The watchdog's ledger notes since this case began. */
export const notes = async (name: string) =>
  (
    await coreSql<{ what: string }>(
      'SELECT what FROM ledger WHERE ref = ? AND seq > ? ORDER BY seq',
      `watchdog:${name}`,
      mark,
    )
  ).map((r) => r.what);
export const setDay = (day: string, at: number) =>
  coreSql(
    "INSERT OR REPLACE INTO settings (key, value_json, updated_at, actor) VALUES ('day.current', ?, ?, 'worker')",
    JSON.stringify(day),
    at,
  );
export const errorsAt = (source: string, count: number) =>
  coreSql(
    `INSERT OR REPLACE INTO errors (fingerprint, source, route, code, message, count, first_at, last_at, last_build, resolved_at)
     VALUES (?, ?, '/v1/x', 'internal', 'synthetic', ?, ?, ?, NULL, NULL)`,
    `fp-${source}`,
    source,
    count,
    Date.now(),
    Date.now(),
  );
export const job = (id: string, state: string, updated: number, attempts = 0) =>
  coreSql(
    `INSERT OR REPLACE INTO jobs (id, kind, state, due_at, payload_json, attempts, created_at, updated_at)
     VALUES (?, 'import', ?, 0, '{}', ?, 0, ?)`,
    id,
    state,
    attempts,
    updated,
  );
export const TRIP = (name: string) =>
  expect.stringMatching(new RegExp(`^watchdog ${name.replace('.', '\\.')} tripped: `));
export const CLEAR = (name: string) =>
  expect.stringMatching(new RegExp(`^watchdog ${name.replace('.', '\\.')} cleared after \\d+ min$`));

/** The owner, chat and night keys, and a reflex key; once per suite. */
export async function setupWatchdogs(): Promise<Principals & { R: string }> {
  const p = await principals();
  const R = await makeAgent(p.D, 'mind:reflex');
  [dayRow] = await coreSql("SELECT * FROM settings WHERE key = 'day.current'");
  return { ...p, R };
}

/** Before each case: no watchdog state, reflex wake or error, the real open day, a fresh ledger mark. */
export async function resetWatchdogs(): Promise<void> {
  for (const q of ['DELETE FROM watchdogs', "DELETE FROM wakes WHERE task = 'reflex'", 'DELETE FROM errors'])
    await coreSql(q);
  await coreSql("DELETE FROM jobs WHERE id LIKE 'job-wd-%'");
  if (dayRow)
    await coreSql(
      'INSERT OR REPLACE INTO settings (key, value_json, updated_at, actor) VALUES (?, ?, ?, ?)',
      dayRow.key,
      dayRow.value_json,
      dayRow.updated_at,
      dayRow.actor,
    );
  [{ s: mark }] = await coreSql<{ s: number }>('SELECT coalesce(max(seq), 0) AS s FROM ledger');
}

/** Runs `fn` with mind-reflex connected (its trigger secrets set) and returns what it returned. */
export function connected<T>(fn: (o: Core) => Promise<T>): Promise<T> {
  return runInDurableObject(stub(), async (o: Core) => {
    const self = o as unknown as { env: Env };
    const before = self.env;
    self.env = { ...before, ROUTINE_REFLEX_URL: 'https://api.example.test/reflex', ROUTINE_REFLEX_TOKEN: 'tok' };
    try {
      return await fn(o);
    } finally {
      self.env = before;
    }
  });
}
