// What memory's rules read about a mind session (MEMORY.md §6–7, API.md §3). A mind may write
// memory only from a session that claimed its briefing in its own role and has not ended:
// otherwise 403 `session_required`, so a fresh or made-up TH-Session can't step around a taint.
// The claim records the constitution hash (M12; `none` when the file was missing); `th taint`
// marks the session for good (M11).
import type { MindRole } from '../../../../shared/contract/api';
import { Fail } from '../../lib/result';
import type { Db } from '../../objects/base';
import { taintedSince } from './store';

export interface Guards {
  tainted: boolean;
  constitution: string;
}

interface Row {
  role: string;
  wake_id: string | null;
  claimed_at: number;
  ended_at: number | null;
  tainted_at: number | null;
  constitution_sha256: string | null;
}

const read = (db: Db, id: string) =>
  db.one<Row>(
    'SELECT role, wake_id, claimed_at, ended_at, tainted_at, constitution_sha256 FROM mind_sessions WHERE session_id = ?',
    id,
  );

/** The session a mind write comes from: claimed (a claim binds a wake), live, and of its role; for
 * chat, also the session that holds the lease (the newest claim). It counts as tainted when it
 * read outside text, and also when any session of its role was tainted after it claimed: an older
 * session id can't be borrowed to step around a newer session's taint. */
export function claimedSession(db: Db, sessionId: string | null, role: MindRole): Guards {
  const s = sessionId ? read(db, sessionId) : null;
  if (!s || s.wake_id === null || s.ended_at !== null || s.role !== role) throw new Fail('session_required');
  if (
    role === 'chat' &&
    db.one<{ session_id: string }>("SELECT session_id FROM leases WHERE task = 'chat'")?.session_id !== sessionId
  )
    throw new Fail('session_required');
  const later = taintedSince(db, role, s.claimed_at);
  return {
    tainted: s.tainted_at !== null || (later !== null && later.session_id !== sessionId),
    constitution: s.constitution_sha256 ?? 'none',
  };
}

/** When a session was marked tainted (null: never, or no such session). */
export function taintedAt(db: Db, sessionId: string): number | null {
  return read(db, sessionId)?.tainted_at ?? null;
}
