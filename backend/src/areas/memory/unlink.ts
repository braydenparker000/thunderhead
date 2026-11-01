// A held conversation's purge (conversation/purge.ts) takes its messages, and the evidence links to
// them go too (MEMORY.md §6.1): each purged `msg:` ref leaves every fact version's and every loose
// end's evidence, in place. What the fact says is untouched (its text, kind, source, confidence and
// history), so no new version is written: MEMORY.md rule 3 makes a version for a change in what
// the mind knows, and this is not one (a new version would also keep the old one's link). A fact
// left with no evidence keeps its text and stays until the owner forgets it. Only a deleted
// conversation can have any: memory refuses evidence off the record from the start.
import type { Db } from '../../objects/base';
import { strings } from './store';

/** Removes these refs from facts' and loose ends' evidence. One scan of each table per purge step
 * (evidence has no index; both tables stay small, measured in the cost suite); a row is written
 * only where a ref goes. */
export function unlinkEvidence(db: Db, refs: Set<string>): { facts: number; loose_ends: number } {
  const out = { facts: 0, loose_ends: 0 };
  if (!refs.size) return out;
  const keep = (json: string | null) => {
    const list = strings(json);
    const kept = list.filter((r) => !refs.has(r));
    return kept.length === list.length ? null : JSON.stringify(kept);
  };
  for (const f of db.all<{ seq: number; evidence_json: string }>(
    `SELECT seq, evidence_json FROM facts WHERE evidence_json LIKE '%msg:%'`,
  )) {
    const next = keep(f.evidence_json);
    if (next !== null) out.facts += Math.sign(db.run('UPDATE facts SET evidence_json = ? WHERE seq = ?', next, f.seq));
  }
  for (const t of db.all<{ id: string; evidence_json: string }>(
    `SELECT id, evidence_json FROM open_threads WHERE evidence_json LIKE '%msg:%'`,
  )) {
    const next = keep(t.evidence_json);
    if (next !== null)
      out.loose_ends += Math.sign(db.run('UPDATE open_threads SET evidence_json = ? WHERE id = ?', next, t.id));
  }
  return out;
}
