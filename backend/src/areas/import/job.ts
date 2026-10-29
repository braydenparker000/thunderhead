// The import job (JOBS.md §4.4 `import.<dataset>`, DATA.md §12): one part of the dataset's old
// table a step, read from the private bucket and checked against the manifest's SHA-256, its rows
// put by their deterministic ids (a row already there writes nothing), the run's counts kept in
// the same commit. Then one verification step: `imported + skipped` must equal the manifest's
// rows, and 20 source rows chosen with a recorded seed must equal what was written. A run of a
// dataset already imported reports how many rows it changed (`rerun_delta`, 0 expected). Uses
// the bulk lane; three failures in a row fail the run.
import type { ImportDataset } from '../../../../shared/contract/api';
import { IMPORT_SPOT_CHECKS } from '../../../../shared/contract/imports.ts';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { ownerTz } from '../conversation/day';
import * as convo from '../conversation/imported';
import { JobError, type JobHandler } from '../jobs/runner';
import { type Mapped, mapMessage, mapNotebook, mapThread, type NotebookItem, type Refs } from './map';
import * as store from './store';
import { readPart, sha256 } from './vault';

export interface ImportPayload {
  import_id: string;
  run_id: string;
  dataset: Extract<ImportDataset, 'threads' | 'messages' | 'notebook'>;
  instance: string;
  table: string;
  rows: number;
  sha256s: string[];
  /** Each part's rows, when the manifest has them (else 2,000 a part but the last). */
  part_rows?: number[];
  run_started: number;
  /** For messages: the threads table's parts, whose ids a message names. */
  threads?: { sha256s: string[] };
}
type Cursor = { phase: 'rows'; part: number } | { phase: 'verify' };
type AnyMapped = Mapped<convo.ImportedThread | convo.ImportedMessage | NotebookItem>;
type Input = { rows: AnyMapped[] } | { seed: number; samples: AnyMapped[] };

const PART_ROWS = 2_000;
const refCache = new Map<string, Refs>();

async function refs(vault: R2Bucket, p: ImportPayload): Promise<Refs> {
  const hit = refCache.get(p.run_id);
  if (hit) return hit;
  const threads = new Map<string, number>();
  const messages = new Map<string, number>();
  for (const [n, sha] of (p.threads?.sha256s ?? []).entries())
    for (const r of await readPart(vault, p.run_id, p.instance, 'cc_threads', n + 1, sha))
      if (typeof r.id === 'string' && typeof r.created_ms === 'number') threads.set(r.id, r.created_ms);
  for (const [n, sha] of p.sha256s.entries())
    for (const r of await readPart(vault, p.run_id, p.instance, p.table, n + 1, sha))
      if (typeof r.id === 'string' && typeof r.created_ms === 'number') messages.set(r.id, r.created_ms);
  const out = { threads, messages };
  refCache.clear();
  refCache.set(p.run_id, out);
  return out;
}

async function mapAll(rows: Record<string, unknown>[], p: ImportPayload, db: Db, env: Env, vault: R2Bucket) {
  const out: AnyMapped[] = [];
  if (p.dataset === 'threads') {
    const tz = ownerTz(db, env.OWNER_TZ);
    for (const r of rows) out.push(await mapThread(r, tz));
  } else if (p.dataset === 'messages') {
    const r0 = await refs(vault, p);
    for (const r of rows) out.push(await mapMessage(r, r0));
  } else for (const r of rows) out.push(await mapNotebook(r, p.run_started));
  return out;
}

/** The seed of a run's spot checks: from its id, so it is recorded and the same on a retry. */
async function seedOf(importId: string): Promise<number> {
  return Number.parseInt((await sha256(new TextEncoder().encode(importId))).slice(0, 8), 16);
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const first = (c: unknown, p: ImportPayload): Cursor =>
  (c as Cursor | null) ?? (p.sha256s.length ? { phase: 'rows', part: 1 } : { phase: 'verify' });

export const importJob: JobHandler = {
  kind: 'import',
  lane: true,
  maxAttempts: 3,
  async load(env, db, payload, cursor) {
    const p = payload as ImportPayload;
    const vault = env.VAULT;
    if (!vault) throw new JobError('not_configured');
    const c = first(cursor, p);
    if (c.phase === 'rows') {
      const rows = await readPart(vault, p.run_id, p.instance, p.table, c.part, p.sha256s[c.part - 1]);
      return { rows: await mapAll(rows, p, db, env, vault) } satisfies Input;
    }
    // 20 source rows (or all, if fewer), by a seeded draw over the table's rows in part order.
    const seed = await seedOf(p.import_id);
    const rand = mulberry32(seed);
    const picks = new Set<number>();
    while (picks.size < Math.min(IMPORT_SPOT_CHECKS, p.rows)) picks.add(Math.floor(rand() * p.rows));
    // Row i of the table is in the first part whose rows reach past it.
    const sizes = p.part_rows ?? p.sha256s.map(() => PART_ROWS);
    const byPart = new Map<number, number[]>();
    for (const i of picks) {
      let part = 0;
      let before = 0;
      while (part < sizes.length - 1 && i >= before + sizes[part]) before += sizes[part++];
      byPart.set(part, [...(byPart.get(part) ?? []), i - before]);
    }
    const sampled: Record<string, unknown>[] = [];
    for (const [part, offsets] of byPart) {
      const rows = await readPart(vault, p.run_id, p.instance, p.table, part + 1, p.sha256s[part]);
      for (const o of offsets) if (rows[o]) sampled.push(rows[o]);
    }
    return { seed, samples: await mapAll(sampled, p, db, env, vault) } satisfies Input;
  },
  step(w, payload, cursor, input) {
    const p = payload as ImportPayload;
    const c = first(cursor, p);
    const run = store.importRow(w.db, p.import_id);
    if (!run) throw new JobError('no_run');
    const counts = JSON.parse(run.counts_json) as store.RunCounts;
    if (c.phase === 'rows') {
      put(w, p, (input as { rows: AnyMapped[] }).rows, counts);
      const last = c.part >= p.sha256s.length;
      store.setImport(w.db, p.import_id, { state: last ? 'verifying' : 'running', counts });
      return { next: last ? { phase: 'verify' } : { phase: 'rows', part: c.part + 1 } };
    }
    const { seed, samples } = input as { seed: number; samples: AnyMapped[] };
    const failed = samples.filter((s) => !matches(w.db, p.dataset, s)).map((s) => s.old_id);
    const whole = counts.imported + counts.skipped === counts.expected;
    const report = {
      spot_checks: { seed, checked: samples.length, passed: samples.length - failed.length, failed },
      rows_changed: counts.rows_changed,
      rerun_delta: store.doneBefore(w.db, p.run_id, p.dataset, p.import_id) ? counts.rows_changed : null,
    };
    const ok = whole && failed.length === 0;
    store.setImport(w.db, p.import_id, {
      state: ok ? 'done' : 'failed',
      report,
      finished_at: w.at,
      last_error: ok ? null : whole ? 'spot_check_failed' : 'count_mismatch',
    });
    return { done: true };
  },
  failed(w, payload, code) {
    const p = payload as ImportPayload;
    store.setImport(w.db, p.import_id, { state: 'failed', finished_at: w.at, last_error: code });
  },
};

/** One part's rows, put; the counts move in place. */
function put(w: Writer, p: ImportPayload, rows: AnyMapped[], counts: store.RunCounts): void {
  const added = new Map<string, number>();
  for (const m of rows) {
    if ('skip' in m) {
      counts.skipped++;
      counts.skip_reasons[m.skip] = (counts.skip_reasons[m.skip] ?? 0) + 1;
      continue;
    }
    let written = 0;
    if (p.dataset === 'threads') written = convo.putThread(w.db, m.row as convo.ImportedThread);
    else if (p.dataset === 'notebook') {
      const i = m.row as NotebookItem;
      written = store.putItem(w.db, { id: i.id, run_id: p.run_id, dataset: 'notebook', key: i.key, body: i.body });
    } else {
      const msg = m.row as convo.ImportedMessage;
      const had = convo.message(w.db, msg.id);
      if (had && had.thread_id !== msg.thread_id) {
        counts.skipped++;
        counts.skip_reasons.duplicate = (counts.skip_reasons.duplicate ?? 0) + 1;
        continue;
      }
      if (!had) {
        written = convo.insertMessage(w.db, msg);
        added.set(msg.thread_id, (added.get(msg.thread_id) ?? 0) + 1);
      } else if (had.body !== msg.body) written = convo.updateBody(w.db, had.seq, had.body, msg.body);
      if (m.files) counts.files_waiting++;
    }
    counts.imported++;
    if (written > 0) counts.rows_changed++;
  }
  for (const [thread, n] of added) convo.addMessages(w.db, thread, n);
}

/** A sampled source row against what the run wrote, after MIGRATION.md §4's normalisation. */
function matches(db: Db, dataset: string, s: AnyMapped): boolean {
  if ('skip' in s) return true; // counted as skipped, with its reason, and nothing was written
  if (dataset === 'threads') {
    const want = s.row as convo.ImportedThread;
    const got = convo.thread(db, want.id);
    return !!got && got.kind === 'imported' && got.day === want.day && got.title === want.title;
  }
  if (dataset === 'notebook') {
    const want = s.row as NotebookItem;
    return store.item(db, want.id)?.body_json === want.body;
  }
  const want = s.row as convo.ImportedMessage;
  const got = convo.message(db, want.id);
  return (
    !!got &&
    got.body === want.body &&
    got.thread_id === want.thread_id &&
    got.author === want.author &&
    got.created_at === want.created_at
  );
}
