// The point-in-time check (OPERATIONS.md §4.4): on each class's scratch copy `pitr-proof` (never
// the owner's objects, never Auth), a row, a bookmark, a marker row, the restore armed the way the
// API requires, the restart, then the marker must be gone and the row before it there. Core's tick
// runs it at the first tick on a new deploy (its version tag differs from the last check's) and on
// every monthly drill. The outcome per class goes to the setting `backups.pitr`, one ledger note,
// and deep health. No restore of a real object exists in the site (OPERATIONS.md §4).
import type { BackupClass, PitrProof, PitrProofs } from '../../../../shared/contract/backups.ts';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { missingMethod } from '../../objects/rpc';
import { getSetting, putSetting } from '../settings/store';
import { PROOF_INSTANCE, type ProofResult, pitrFailure } from './pitr';

export const PROOF_CLASSES: readonly BackupClass[] = ['core', 'music', 'senses', 'library'];
const KEY = 'backups.pitr';

export const readProofs = (db: Db): PitrProofs | null => (getSetting(db, KEY) as PitrProofs | undefined) ?? null;

/** Due at the first tick on a deploy the last check didn't run on, or when the drill asks. */
export const proofDue = (db: Db, tag: string | null, drill: boolean): boolean => {
  const p = readProofs(db);
  return drill || !p || p.tag !== tag;
};

interface ProofStub {
  pitrProofArm(): Promise<ProofResult | { outcome: 'armed'; code: null }>;
  pitrProofCheck(): Promise<ProofResult>;
  pitrProofRestart(): Promise<void> | void;
}

/** Each class's scratch copy (a fresh stub each time: an aborted object's old stub is broken). */
const scratch = (env: Env, cls: BackupClass): ProofStub => {
  const ns = { core: env.CORE, music: env.MUSIC, senses: env.SENSES, library: env.LIBRARY }[cls];
  return ns.get(ns.idFromName(PROOF_INSTANCE)) as unknown as ProofStub;
};

async function proveOne(env: Env, cls: BackupClass): Promise<ProofResult> {
  try {
    const armed = await scratch(env, cls).pitrProofArm();
    if (armed.outcome !== 'armed') return armed;
    // The real restart aborts the object, so this call ends in an error: expected.
    await Promise.resolve(scratch(env, cls).pitrProofRestart()).catch(() => undefined);
    return await scratch(env, cls).pitrProofCheck();
  } catch (e) {
    if (missingMethod(e)) return { outcome: 'failed', code: 'not_deployed' };
    return pitrFailure(e);
  }
}

/** Runs the check on every class, one after another. */
export async function runProofs(env: Env, now: number): Promise<Partial<Record<BackupClass, PitrProof>>> {
  const out: Partial<Record<BackupClass, PitrProof>> = {};
  for (const cls of PROOF_CLASSES) out[cls] = { ...(await proveOne(env, cls)), at: now };
  return out;
}

/** Keeps the outcome and writes the ledger note. */
export function recordProofs(
  w: Writer,
  tag: string | null,
  classes: Partial<Record<BackupClass, PitrProof>>,
): PitrProofs {
  const proofs: PitrProofs = { tag, at: w.at, classes };
  putSetting(w.db, KEY, proofs, 'worker', w.at);
  const parts = PROOF_CLASSES.map((c) => {
    const p = classes[c];
    return `${c} ${p ? p.outcome + (p.code ? ` (${p.code})` : '') : 'not checked'}`;
  });
  w.ledger({
    kind: 'note',
    actor: 'worker',
    what: `point-in-time check on the scratch copies: ${parts.join(', ')}`,
    why: 'whether point-in-time recovery works on this account; no restore exists in the site (OPERATIONS.md §4)',
    ref: `pitr:${tag ?? 'none'}`,
    undoable: false,
  });
  return proofs;
}
