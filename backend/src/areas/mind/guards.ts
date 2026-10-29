// What memory's rules read about a mind session (MEMORY.md §6): its taint (M11, set by
// `th taint`) and the constitution hash it claimed with (M12; `none` when its file was missing).
import type { Db } from '../../objects/base';

export function sessionGuards(db: Db, id: string): { tainted: boolean; constitution: string | null } {
  const r = db.one<{ tainted_at: number | null; constitution_sha256: string | null }>(
    'SELECT tainted_at, constitution_sha256 FROM mind_sessions WHERE session_id = ?',
    id,
  );
  return { tainted: r?.tainted_at != null, constitution: r?.constitution_sha256 ?? null };
}
