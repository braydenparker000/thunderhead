// Which indexed refs still stand in Core (MEMORY.md §10.6): a message present, by the owner or the
// mind and not held (off the record or deleted); a fact still current (not superseded, not
// forgotten); a day with its note. The recall serves only these, so a vector outliving its row
// never brings it back, and the indexer's sweep drops the rest. A book page is the Library's to
// check (library.ts `recall`). Each answer is by key: a few rows a ref.
import type { Db } from '../../objects/base';
import { liveMessages } from '../conversation/recall-rows';
import { liveFacts, liveNotes } from '../memory/recall-rows';

/** The refs (of `msg:`, `fact:`, `day:`) that stand, each with its thread (a message's) or null. */
export function liveRefs(db: Db, refs: string[]): Map<string, string | null> {
  const ids = (kind: string) => refs.filter((r) => r.startsWith(`${kind}:`)).map((r) => r.slice(kind.length + 1));
  const out = new Map<string, string | null>();
  for (const [id, thread] of liveMessages(db, ids('msg'))) out.set(`msg:${id}`, thread);
  for (const id of liveFacts(db, ids('fact'))) out.set(`fact:${id}`, null);
  for (const day of liveNotes(db, ids('day'))) out.set(`day:${day}`, null);
  return out;
}
