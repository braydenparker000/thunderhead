// Outside text kept back from a mind session that did not ask for it (MEMORY.md §6 M11f,
// 2026-11-03). A memory row labelled `outside` (a fact, a loose end, a day note) reaches a mind read
// as its id, its label and its kind, with its numbers and dates, never its words: a clean session
// that read them could write them down again as the owner's, citing any owner message (M3 checks
// the evidence, not where the words came from). A session that wants them asks (`outside=1` on the
// read, `th recall --outside`), and the Worker marks it as having read outside text before serving
// them (outside-read.ts), so what it writes after is labelled `outside`. The device reads all of it;
// the briefing keeps them back from a clean session the same way (profile.ts). Pure functions.
import type { DayNote, Fact, FactDetail, OpenThread, SearchHit } from '../../../../shared/contract/api';

/** What a kept-back row says in place of its words. */
export const KEPT_BACK = '(outside, kept back)';

const outside = (r: { provenance?: string | null }) => r.provenance === 'outside';

export const keptFact = (f: Fact): Fact => (outside(f) ? { ...f, text: KEPT_BACK, subject: null, tags: [] } : f);

export const keptThread = (t: OpenThread): OpenThread =>
  outside(t) ? { ...t, text: KEPT_BACK, tags: [], closed_why: t.closed_why === null ? null : KEPT_BACK } : t;

export const keptDay = (n: DayNote): DayNote => (outside(n) ? { ...n, summary: KEPT_BACK, decisions: [] } : n);

/** A memory hit (a fact or a day note) labelled `outside`; a message's label says only whose words
 * they are, and `th history` serves those anyway. */
export const outsideHit = (h: SearchHit) => outside(h) && (h.source === 'facts' || h.source === 'day_notes');
export const keptHit = (h: SearchHit): SearchHit => (outsideHit(h) ? { ...h, snippet: KEPT_BACK } : h);

/** Whether a fact's detail holds outside words: an `outside` version, or a day note it cites that a
 * session which read outside text rewrote since (`outsideDays`). */
export function detailHasOutside(d: FactDetail, outsideDays: Set<string>): boolean {
  return (
    outside(d.fact) || d.history.some(outside) || d.evidence.some((e) => e.kind === 'day' && outsideDays.has(e.ref))
  );
}

export function keptDetail(d: FactDetail, outsideDays: Set<string>): FactDetail {
  return {
    fact: keptFact(d.fact),
    history: d.history.map(keptFact),
    evidence: d.evidence.map((e) => (e.kind === 'day' && outsideDays.has(e.ref) ? { ...e, text: null } : e)),
    // The row's why is the mind's, from that session (a supersede's reason): kept back with the words.
    why: outside(d.fact) ? null : d.why,
  };
}
