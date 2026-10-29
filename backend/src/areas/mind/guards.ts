// What memory's rules read about a mind session (MEMORY.md §6–7, API.md §3). A mind may write
// memory only from a session that claimed its briefing in its own role and has not ended:
// otherwise 403 `session_required`, so a fresh or made-up TH-Session can't step around a taint.
// The claim records the constitution hash (M12; `none` when the file was missing); `th taint`
// marks the session for good (M11).
import type { MindRole } from '../../../../shared/contract/api';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';

export interface Guards {
  tainted: boolean;
  constitution: string;
}

interface Row {
  role: string;
  wake_id: string | null;
  ended_at: number | null;
  tainted_at: number | null;
  constitution_sha256: string | null;
}

const read = (db: Db, id: string) =>
  db.one<Row>(
    'SELECT role, wake_id, ended_at, tainted_at, constitution_sha256 FROM mind_sessions WHERE session_id = ?',
    id,
  );

/** The session a mind write comes from: claimed (a claim binds a wake), live, and of its role. */
export function claimedSession(db: Db, sessionId: string | null, role: MindRole): Guards {
  const s = sessionId ? read(db, sessionId) : null;
  if (!s || s.wake_id === null || s.ended_at !== null || s.role !== role) throw new Fail('session_required');
  return { tainted: s.tainted_at !== null, constitution: s.constitution_sha256 ?? 'none' };
}

/** When a session was marked tainted (null: never, or no such session). */
export function taintedAt(db: Db, sessionId: string): number | null {
  return read(db, sessionId)?.tainted_at ?? null;
}
