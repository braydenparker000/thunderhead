// The memory half of the Core object (P3, areas/memory): facts, the profile, op batches, day
// notes and open threads. Like the rest of Core, every RPC is a thin call into the area; writes
// run through `write`/`run` (commit.ts), reads are bounded in the store. `Core` (core.ts) adds
// the conversation, the mind and the actions on top.
import type {
  DayNote,
  Fact,
  MemoryOpsResponse,
  OpenThread,
  PatchOpenThreadRequest,
  ProfileResponse,
  PutDayNoteRequest,
  PutOpenThreadRequest,
} from '../../../shared/contract/api';
import { FACT_KIND_NAMES } from '../../../shared/contract/memory.ts';
import { currentDay } from '../areas/conversation/day';
import * as notes from '../areas/memory/notes';
import * as notesOps from '../areas/memory/notes-ops';
import * as memory from '../areas/memory/ops';
import { renderProfile } from '../areas/memory/profile';
import * as facts from '../areas/memory/store';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreBase } from './core-base';

/** How many current facts the profile reads at most (newest first): a bound on its rows read. */
export const PROFILE_READ = 2_000;

export abstract class CoreMemory extends CoreBase {
  facts(filter: facts.FactsFilter, before: number | null, limit: number): { items: Fact[]; last: number | null } {
    const now = Date.now();
    const rows = facts.factsPage(this.db, filter, before, limit);
    return { items: rows.map((r) => facts.toFact(r, now)), last: rows.at(-1)?.seq ?? null };
  }

  profile(): ProfileResponse {
    const now = Date.now();
    const rows = facts.currentFacts(
      this.db,
      FACT_KIND_NAMES.filter((k) => k !== 'rule'),
      PROFILE_READ,
    );
    return { ...renderProfile(rows, now, this.tz()), rendered_at: now };
  }

  memoryOps(c: Caller, batchId: string, ops: unknown[], hash: string): Out<MemoryOpsResponse> {
    return this.run((w) => memory.apply(w, c, batchId, Array.isArray(ops) ? ops : [], hash));
  }

  dayNotes(from: string | null, to: string | null): DayNote[] {
    return notes.dayNotes(this.db, from, to, 100).map(notes.toDayNote);
  }

  putDayNote(c: Caller, day: string, r: PutDayNoteRequest): Out<DayNote> {
    return this.run((w) => notesOps.putDayNote(w, c, day, currentDay(w.db, this.tz(), w.at), r));
  }

  openThreads(status: 'open' | 'all'): OpenThread[] {
    return notes.openThreads(this.db, status, 200).map(notes.toOpenThread);
  }

  putOpenThread(c: Caller, id: string, r: PutOpenThreadRequest): Out<OpenThread> {
    return this.run((w) => notesOps.putThread(w, c, id, r));
  }

  patchOpenThread(c: Caller, id: string, r: PatchOpenThreadRequest): Out<OpenThread> {
    return this.run((w) => notesOps.patchThread(w, c, id, r));
  }

  searchFacts(match: string, since: number | null, until: number | null, limit: number) {
    return facts.searchFacts(this.db, match, since, until, limit);
  }

  searchDayNotes(match: string, since: number | null, until: number | null, limit: number) {
    return notes.searchDayNotes(this.db, match, since, until, limit);
  }
}
