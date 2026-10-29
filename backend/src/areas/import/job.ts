// The import job (JOBS.md §4.4 `import.<dataset>`, DATA.md §12): one part of the dataset's old
// table a step, read from the private bucket and checked against the manifest's SHA-256, its rows
// put by their deterministic ids (a row already there writes nothing), the run's counts kept in
// the same commit. Then one verification step: `imported + skipped` must equal the manifest's
// rows, 20 source rows chosen with a recorded seed must equal what was written, and for messages
// every thread's count and first and last times must equal the source's (carried in the cursor).
// A run of a dataset already imported reports how many rows it changed (`rerun_delta`, 0
// expected). Its end is one ledger row with counts only. Uses the bulk lane; three failures in a
// row fail the run. The music catalog's rows (I7) go to the Music object instead (./music.ts).
import type { ImportDataset } from '../../../../shared/contract/api';
import { IMPORT_SPOT_CHECKS } from '../../../../shared/contract/imports.ts';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { ownerTz } from '../conversation/day';
import * as convo from '../conversation/imported';
import { JobError, type JobHandler } from '../jobs/runner';
import {
  type Mapped,
  mapMessage,
  mapNotebook,
  mapThread,
  messageSkip,
  type NotebookItem,
  type Refs,
  threadKey,
} from './map';
import { failedChecks, isMusic, type MusicPart, putPart, tally } from './music';
import * as store from './store';
import { readPart, sha256 } from './vault';

export interface ImportPayload {
  import_id: string;
  run_id: string;
  dataset: Extract<ImportDataset, 'threads' | 'messages' | 'notebook' | 'music' | 'music_log'>;
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
/** Per new thread id, the source's imported messages: how many, the first and the last time. */
type Shape = Record<string, [n: number, first: number, last: number]>;
type Cursor = { phase: 'rows'; part: number; shape?: Shape } | { phase: 'verify'; shape?: Shape };
type AnyMapped = Mapped<convo.ImportedThread | convo.ImportedMessage | NotebookItem>;
type Input =
  | { rows: AnyMapped[] }
  | { seed: number; samples: AnyMapped[] }
  | { music: MusicPart }
  | { seed: number; checked: number; failed: string[] };

const PART_ROWS = 2_000;
/** What the ledger row calls each dataset's rows. */
const NOUN: Record<ImportPayload['dataset'], string> = {
  threads: 'conversations',
  messages: 'messages',
  notebook: 'notebook rows',
  music: 'songs',
  music_log: 'catalog changes',
};
const refCache = new Map<string, Refs>();

async function refs(vault: R2Bucket, p: ImportPayload): Promise<Refs> {
  const hit = refCache.get(p.run_id);
  if (hit) return hit;
  const threads = new Map<string, number>();
  const messages = new Map<string, number>();
  for (const [n, sha] of (p.threads?.sha256s ?? []).entries())
    for (const r of await readPart(vault, p.run_id, p.instance, 'cc_threads', n + 1, sha)) {
      const key = threadKey(r);
      if (key) threads.set(...key);
    }
  for (const [n, sha] of p.sha256s.entries())
    for (const r of await readPart(vault, p.run_id, p.instance, p.table, n + 1, sha))
      if (!messageSkip(r, threads)) messages.set(r.id as string, r.created_ms as number);
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
      if (isMusic(p.dataset)) return { music: await putPart(env, p.dataset, rows, Date.now()) } satisfies Input;
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
    if (isMusic(p.dataset))
      return { seed, checked: sampled.length, failed: await failedChecks(env, p.dataset, sampled) } satisfies Input;
    return { seed, samples: await mapAll(sampled, p, db, env, vault) } satisfies Input;
  },
  step(w, payload, cursor, input) {
    const p = payload as ImportPayload;
    const c = first(cursor, p);
    const run = store.importRow(w.db, p.import_id);
    if (!run) throw new JobError('no_run');
    const counts = JSON.parse(run.counts_json) as store.RunCounts;
    const shape = p.dataset === 'messages' ? { ...c.shape } : undefined;
    if (c.phase === 'rows') {
      const m = 'music' in (input as object) ? (input as { music: MusicPart }).music : null;
      if (m) tally(counts, m);
      else put(w, p, (input as { rows: AnyMapped[] }).rows, counts, shape);
      const last = c.part >= p.sha256s.length;
      store.setImport(w.db, p.import_id, { state: last ? 'verifying' : 'running', counts });
      const rows = m?.written ?? 0;
      return { next: last ? { phase: 'verify', shape } : { phase: 'rows', part: c.part + 1, shape }, rows };
    }
    const i = input as { seed: number; samples?: AnyMapped[]; checked?: number; failed?: string[] };
    const seed = i.seed;
    const samples = i.samples ?? [];
    const failed = i.failed ?? samples.filter((s) => !matches(w.db, p.dataset, s)).map((s) => s.old_id);
    const checked = i.checked ?? samples.length;
    const shapes = shape ? { checked: Object.keys(shape).length, failed: misshapen(w.db, shape) } : null;
    const whole = counts.imported + counts.skipped === counts.expected;
    const report = {
      spot_checks: { seed, checked, passed: checked - failed.length, failed },
      thread_shapes: shapes,
      rows_changed: counts.rows_changed,
      rerun_delta: store.doneBefore(w.db, p.run_id, p.dataset, p.import_id) ? counts.rows_changed : null,
    };
    const error = !whole
      ? 'count_mismatch'
      : failed.length
        ? 'spot_check_failed'
        : shapes?.failed.length
          ? 'thread_shape_mismatch'
          : null;
    store.setImport(w.db, p.import_id, {
      state: error ? 'failed' : 'done',
      report,
      finished_at: w.at,
      last_error: error,
    });
    const n = report.spot_checks;
    tell(
      w,
      p,
      error
        ? stopped(p, error)
        : `Imported ${counts.imported} of ${counts.expected} ${NOUN[p.dataset]} (${counts.skipped} skipped); ${n.passed} of ${n.checked} spot checks matched; ${counts.rows_changed} rows changed.`,
    );
    if (counts.rows_changed > 0 && (p.dataset === 'threads' || p.dataset === 'messages')) w.change('thread');
    return { done: true };
  },
  failed(w, payload, code) {
    const p = payload as ImportPayload;
    store.setImport(w.db, p.import_id, { state: 'failed', finished_at: w.at, last_error: code });
    tell(w, p, stopped(p, code));
  },
};

const stopped = (p: ImportPayload, code: string) =>
  `The import of ${NOUN[p.dataset]} stopped (${code}). Nothing was lost; the old system still has it.`;

/** The run's end in the ledger (MIGRATION.md §4): counts and codes only, never a row's content. */
function tell(w: Writer, p: ImportPayload, what: string): void {
  w.ledger({ kind: 'note', actor: 'worker', what, why: `the import of run ${p.run_id}`, undoable: false });
}

/** The threads whose messages differ from the source's in count or first or last time (at most
 * 20 listed). */
function misshapen(db: Db, shape: Shape): string[] {
  const ids = Object.keys(shape);
  const got = convo.threadShapes(db, ids);
  return ids
    .filter((id) => {
      const g = got.get(id);
      const [n, first, last] = shape[id];
      return !g || g.n !== n || g.first !== first || g.last !== last;
    })
    .slice(0, 20);
}

/** One part's rows, put; the counts (and, for messages, the threads' shape) move in place. */
function put(w: Writer, p: ImportPayload, rows: AnyMapped[], counts: store.RunCounts, shape?: Shape): void {
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
      if (shape) {
        const s = shape[msg.thread_id];
        shape[msg.thread_id] = s
          ? [s[0] + 1, Math.min(s[1], msg.created_at), Math.max(s[2], msg.created_at)]
          : [1, msg.created_at, msg.created_at];
      }
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
