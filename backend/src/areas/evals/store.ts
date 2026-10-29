// SQL for the eval record and the sandbox's report (EVALS.md §1.1, §8). The report reads only the
// sandbox instance, which a reset keeps small (its seed and one fixture's work).
import type { EvalRun, EvalSuite } from '../../../../shared/contract/evals.ts';
import type { Db } from '../../objects/base';

interface RunRow {
  id: string;
  at: number;
  suite: EvalSuite;
  git_sha: string;
  n: number;
  passed: number;
  score: number;
  failures_json: string;
  skipped_json: string;
  judged: number;
  req_sha256: string | null;
}

export function insertRun(db: Db, r: EvalRun & { session_id: string | null; req_sha256: string }): void {
  db.run(
    `INSERT INTO eval_runs (id, at, suite, git_sha, n, passed, score, failures_json, skipped_json, judged, session_id, req_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.at,
    r.suite,
    r.git_sha,
    r.n,
    r.passed,
    r.score,
    JSON.stringify(r.failures),
    JSON.stringify(r.skipped),
    r.judged,
    r.session_id,
    r.req_sha256,
  );
}

const toRun = (r: RunRow): EvalRun => ({
  id: r.id,
  at: r.at,
  suite: r.suite,
  git_sha: r.git_sha,
  n: r.n,
  passed: r.passed,
  score: r.score,
  failures: JSON.parse(r.failures_json) as string[],
  skipped: JSON.parse(r.skipped_json) as string[],
  judged: r.judged,
});

const COLS = 'id, at, suite, git_sha, n, passed, score, failures_json, skipped_json, judged, req_sha256';

export function runById(db: Db, id: string): (EvalRun & { req_sha256: string | null }) | null {
  const r = db.one<RunRow>(`SELECT ${COLS} FROM eval_runs WHERE id = ?`, id);
  return r ? { ...toRun(r), req_sha256: r.req_sha256 } : null;
}

/** Newest first, through the (suite, at) index when a suite is named. */
export function runs(db: Db, suite: EvalSuite | null, limit: number): EvalRun[] {
  const rows = suite
    ? db.all<RunRow>(`SELECT ${COLS} FROM eval_runs WHERE suite = ? ORDER BY at DESC LIMIT ?`, suite, limit)
    : db.all<RunRow>(`SELECT ${COLS} FROM eval_runs ORDER BY id DESC LIMIT ?`, limit);
  return rows.map(toRun);
}
