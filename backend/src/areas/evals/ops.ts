// The eval sandbox and the eval record (EVALS.md §1.1, §8). A reset empties every Core table of the
// sandbox instance and writes the synthetic seed through the normal paths (owner messages, Muse and
// import lines, the owner's memory ops), so a fixture meets the same rules as the real thing. The
// report is what the mind wrote or tried since then. A finished suite is one row in the owner's
// Core. Only the sandbox instance may be reset (the caller checks the object's own name).
import type { FactKind, MemoryOp } from '../../../../shared/contract/api';
import {
  EVAL_LIMITS,
  type EvalRun,
  type PutEvalRunRequest,
  type SandboxReport,
  type SeedRow,
} from '../../../../shared/contract/evals.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { currentDay } from '../conversation/day';
import * as convo from '../conversation/ops';
import { mindMessages } from '../conversation/stats';
import * as cstore from '../conversation/store';
import { mindKinds } from '../ledger/store';
import * as memory from '../memory/ops';
import { getSetting, putSetting } from '../settings/store';
import * as store from './store';

const OWNER: Caller = { actor: 'owner', who: 'D', session_id: 'eval-seed', device_id: 'eval-seed' };

/** Empties every table (full-text indexes by their own command), then writes the seed. */
export function reset(
  w: Writer,
  tables: string[],
  seed: SeedRow[],
  tz: string,
): { seeded: number; thread_id: string | null } {
  if (seed.length > EVAL_LIMITS.seed_rows) throw invalid('seed', `at most ${EVAL_LIMITS.seed_rows} rows`);
  for (const t of tables) {
    if (t.endsWith('_fts')) w.db.run(`INSERT INTO ${t}(${t}) VALUES('delete-all')`);
    else w.db.run(`DELETE FROM ${t}`);
  }
  putSetting(w.db, 'eval.reset_at', w.at, 'worker', w.at);
  putSetting(w.db, 'eval.attempts', [], 'worker', w.at);
  const ids = new Map<string, string>();
  const ops: MemoryOp[] = [];
  const fact = (ref: string) => ids.get(ref) ?? invalidRef(ref);
  const evidence = (refs: string[]) => refs.map((r) => `msg:${fact(r)}`);
  for (const r of seed) {
    if (r.t === 'say' || r.t === 'owner') {
      const id = uuidv7(w.at);
      convo.putMessage(w, OWNER, { id, body: r.body, req_sha256: id }, tz);
      if (r.ref) ids.set(r.ref, id);
    } else if (r.t === 'muse' || r.t === 'import') {
      const thread = cstore.ensureDaily(w.db, uuidv7(w.at), currentDay(w.db, tz, w.at), w.at);
      const id = uuidv7(w.at);
      cstore.insertMessage(w.db, {
        id,
        thread_id: thread.id,
        author: r.t === 'muse' ? 'muse' : 'system',
        origin: r.t,
        kind: 'text',
        body: r.body,
        meta: null,
        reply_to: null,
        created_at: w.at,
        device_id: null,
        session_id: null,
        req_sha256: id,
      });
    } else if (r.t === 'add') {
      const id = uuidv7(w.at);
      ops.push({
        op: 'add',
        id,
        kind: r.kind as FactKind,
        subject: r.subject,
        text: r.text,
        source: 'user',
        evidence: evidence(r.evidence),
      });
      ids.set(r.ref, id);
    } else if (r.t === 'supersede') {
      const id = uuidv7(w.at);
      ops.push({ op: 'supersede', id: fact(r.of), new: { id, text: r.text, evidence: evidence(r.evidence) } });
      ids.set(r.ref, id);
    } else if (r.t === 'forget') ops.push({ op: 'forget', id: fact(r.of) });
  }
  // One batch per op, in order: a supersede or forget needs the fact it names applied first.
  for (const op of ops) memory.apply(w, OWNER, uuidv7(w.at), [op], uuidv7(w.at));
  return { seeded: seed.length, thread_id: cstore.dailyThread(w.db, currentDay(w.db, tz, w.at))?.id ?? null };
}

function invalidRef(ref: string): never {
  throw invalid('seed', `no earlier row with ref ${ref}`);
}

/** A write request made in the sandbox, accepted or refused (http/auth.ts records it). */
export function attempt(w: Writer, route: string, status: number): void {
  const list = (getSetting(w.db, 'eval.attempts') as SandboxReport['attempts'] | undefined) ?? [];
  if (list.length >= EVAL_LIMITS.attempts) return;
  putSetting(w.db, 'eval.attempts', [...list, { route, status, at: w.at }], 'worker', w.at);
}

export function report(db: Db, tz: string, now: number): SandboxReport {
  const thread = cstore.dailyThread(db, currentDay(db, tz, now));
  const msgs = mindMessages(db, thread?.id ?? null, EVAL_LIMITS.replies);
  return {
    reset_at: (getSetting(db, 'eval.reset_at') as number | undefined) ?? null,
    ledger: mindKinds(db),
    messages_outside: msgs.outside,
    replies: msgs.replies.map((b) => b.slice(0, EVAL_LIMITS.reply_chars)),
    attempts: (getSetting(db, 'eval.attempts') as SandboxReport['attempts'] | undefined) ?? [],
  };
}

/** PUT /v1/evals/runs/:id: one finished suite (idempotent by id and body). */
export function putRun(w: Writer, c: Caller, r: PutEvalRunRequest, hash: string): { run: EvalRun; created: boolean } {
  const found = store.runById(w.db, r.id);
  if (found) {
    if (found.req_sha256 !== hash) throw new Fail('conflict');
    const { req_sha256: _h, ...run } = found;
    return { run, created: false };
  }
  if (r.passed > r.n) throw invalid('passed', 'at most n');
  const run: EvalRun = {
    ...r,
    at: w.at,
    score: r.n ? r.passed / r.n : 0,
    skipped: r.skipped ?? [],
    judged: r.judged ?? 0,
  };
  store.insertRun(w.db, { ...run, session_id: c.session_id, req_sha256: hash });
  w.ledger({
    kind: 'note',
    actor: c.actor,
    session_id: c.session_id,
    what: `eval ${r.suite}: ${r.passed}/${r.n}`,
    why: 'the weekly evals (EVALS.md §7)',
    ref: null,
    undoable: false,
  });
  return { run, created: true };
}
