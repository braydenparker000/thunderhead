// One fact as the Memory page opens it (MENU-AND-SETTINGS.md §4.4): the version, its earlier
// versions, its evidence with what was said, and the why of the ledger row that wrote it. Reads
// are bounded: one lineage (≤ 200 versions) and ≤ 20 evidence lookups, each by key.
import type { EvidenceItem, FactDetail } from '../../../../shared/contract/memory.ts';
import type { Db } from '../../objects/base';
import { messageById } from '../conversation/store';
import { byId as ledgerRow } from '../ledger/store';
import { dayNote } from './notes';
import * as store from './store';

const QUOTE = 280;
const REF = /^([a-z][a-z0-9]{1,15}):([A-Za-z0-9._:/-]{1,160})/;

function item(db: Db, ref: string): EvidenceItem {
  const [, kind = 'unknown', key = ''] = REF.exec(ref) ?? [];
  if (kind === 'msg') {
    const m = messageById(db, key);
    return { ref, kind, at: m?.created_at ?? null, who: m?.author ?? null, text: m ? m.body.slice(0, QUOTE) : null };
  }
  if (kind === 'day') {
    const n = dayNote(db, key);
    return { ref, kind, at: n?.written_at ?? null, who: n ? 'mind' : null, text: n ? n.summary.slice(0, QUOTE) : null };
  }
  if (kind === 'ledger') {
    const l = ledgerRow(db, key);
    return { ref, kind, at: l?.at ?? null, who: l?.actor === 'owner' ? 'owner' : l ? 'mind' : null, text: null };
  }
  return { ref, kind, at: null, who: null, text: null };
}

export function detail(db: Db, id: string, now: number): FactDetail | null {
  const f = store.fact(db, id);
  if (!f) return null;
  const versions = store.lineage(db, id).filter((v) => v.id !== id && v.recorded_at <= f.recorded_at);
  const evidence = store
    .strings(f.evidence_json)
    .slice(0, 20)
    .map((r) => item(db, r));
  const why = f.ledger_id ? (ledgerRow(db, f.ledger_id)?.why ?? null) : null;
  return {
    fact: store.toFact(f, now),
    history: versions.sort((a, b) => b.recorded_at - a.recorded_at || b.seq - a.seq).map((v) => store.toFact(v, now)),
    evidence,
    why,
  };
}
