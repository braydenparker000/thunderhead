// The eval sandbox and the eval record (EVALS.md §1.1, §8). Behaviour evals run against a scratch
// Core instance (`core-eval`), reached with the same routes and the header `TH-Sandbox: eval` from
// a mind:chat or mind:night key: `th eval` resets it to the synthetic seed (mind/evals/seed.jsonl
// plus a fixture's own rows), a subagent works one fixture there, and the report says what it
// wrote or tried to write. A finished suite is recorded in the owner's Core (`eval_runs`), numbers
// only. Plain data, Node-importable.
import type { Id, Ms } from './api';

export const SANDBOX_HEADER = 'TH-Sandbox';
export const SANDBOX_INSTANCE = 'core-eval';

export const EVAL_LIMITS = {
  /** Seed rows in one reset. */
  seed_rows: 200,
  /** Write attempts the sandbox keeps since its last reset. */
  attempts: 300,
  /** The mind's replies a report carries (each at most `reply_chars`). */
  replies: 20,
  reply_chars: 2_000,
} as const;

/** One synthetic seed row: the owner says something (`say`, `owner`), Muse or an old import does
 * (`muse`, `import`), or a memory op the owner makes (`add`, `supersede`, `forget`; evidence names
 * `say` rows by their `ref`). */
export type SeedRow =
  | { t: 'say' | 'owner'; ref?: string; body: string }
  | { t: 'muse' | 'import'; body: string }
  | { t: 'add'; ref: string; kind: string; subject: string; text: string; evidence: string[] }
  | { t: 'supersede'; of: string; ref: string; text: string; evidence: string[] }
  | { t: 'forget'; of: string };

export interface SandboxResetRequest {
  seed: SeedRow[];
}

/** What a sandbox holds since its last reset, beyond its seed. */
export interface SandboxReport {
  reset_at: Ms | null;
  /** The mind's ledger rows by kind (memory, proposal, verb, arrangement, …). */
  ledger: Record<string, number>;
  /** The mind's messages outside today's thread (the eval thread). */
  messages_outside: number;
  /** The mind's replies in today's thread, newest last. */
  replies: string[];
  /** Every write request since the reset, accepted or refused: `METHOD /route` and its status. */
  attempts: { route: string; status: number; at: Ms }[];
}

export type EvalSuite = 'INJ' | 'LAW' | 'MP' | 'TONE' | 'RT' | 'META';

export interface PutEvalRunRequest {
  id: Id;
  suite: EvalSuite;
  /** The commit of mind/ the run used. */
  git_sha: string;
  n: number;
  passed: number;
  /** Fixture or probe ids that failed (never their text). */
  failures: string[];
  /** Ids not run, with nothing scored. */
  skipped?: string[];
  judged?: number;
}

export interface EvalRun extends PutEvalRunRequest {
  at: Ms;
  score: number;
  skipped: string[];
  judged: number;
}
