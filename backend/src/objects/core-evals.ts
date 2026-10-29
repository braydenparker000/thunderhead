// The evals' half of the Core object (P4 stage C, areas/evals): the sandbox's reset, report and
// attempt log, which only the sandbox instance answers (its own name, `core-eval`), and the eval
// record, which only the owner's Core keeps. A code layer of the one Core class.
import type { EvalRun, EvalSuite, PutEvalRunRequest, SandboxReport, SeedRow } from '../../../shared/contract/evals.ts';
import * as evals from '../areas/evals/ops';
import * as store from '../areas/evals/store';
import { attempt, Fail, type Out } from '../lib/result';
import type { Caller } from './caller';
import { CORE_TABLES } from './core.migrations';
import { CoreProposals } from './core-proposals';

export abstract class CoreEvals extends CoreProposals {
  /** Empties the sandbox and writes the seed. Refused anywhere but the sandbox instance. */
  evalReset(seed: SeedRow[]): Out<{ seeded: number; thread_id: string | null }> {
    if (!this.sandboxed) return { ok: false, code: 'forbidden' };
    return this.run((w) => evals.reset(w, Object.keys(CORE_TABLES), Array.isArray(seed) ? seed : [], this.tz()));
  }

  evalReport(): Out<SandboxReport> {
    return attempt(() => {
      if (!this.sandboxed) throw new Fail('forbidden');
      return evals.report(this.db, this.tz(), Date.now());
    });
  }

  evalAttempt(route: string, status: number): void {
    if (this.sandboxed) this.write((w) => evals.attempt(w, route, status));
  }

  putEvalRun(c: Caller, r: PutEvalRunRequest, hash: string): Out<{ run: EvalRun; created: boolean }> {
    if (this.sandboxed) return { ok: false, code: 'forbidden' };
    return this.run((w) => evals.putRun(w, c, r, hash));
  }

  evalRuns(suite: EvalSuite | null, limit: number): EvalRun[] {
    return store.runs(this.db, suite, limit);
  }
}
