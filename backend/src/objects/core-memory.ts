// The memory half of the Core object (P3, areas/memory): facts, the profile, op batches, day
// notes and open threads. Like the rest of Core, every RPC is a thin call into the area; writes
// run through `write`/`run` (commit.ts), reads are bounded in the store. `Core` (core.ts) adds
// the conversation, the mind and the actions on top.
import type {
  DayNote,
  Fact,
  FactDetail,
  MemoryOpsResponse,
  OpenThread,
  PatchOpenThreadRequest,
  ProfileResponse,
  PutDayNoteRequest,
  PutOpenThreadRequest,
} from '../../../shared/contract/api';
import { MUSIC_NEVER_SUBJECT, MUSIC_REF_IN_TEXT } from '../../../shared/contract/music.ts';
import { currentDay } from '../areas/conversation/day';
import { detail } from '../areas/memory/detail';
import { detailHasOutside, keptDetail } from '../areas/memory/kept';
import * as notes from '../areas/memory/notes';
import * as notesOps from '../areas/memory/notes-ops';
import * as memory from '../areas/memory/ops';
import { renderProfile } from '../areas/memory/profile';
import * as facts from '../areas/memory/store';
import { claimedSession } from '../areas/mind/guards';
import { taint } from '../areas/mind/ops';
import { queueEmbed } from '../areas/search/embed-job';
import { liveRefs } from '../areas/search/live';
import { getSetting } from '../areas/settings/store';
import { attempt, Fail, invalid, type Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreWatches } from './core-watches';

/** How many current facts the profile reads at most (newest first): a bound on its rows read. */
export const PROFILE_READ = 2_000;
/** The taint source of a mind read that asked for memory labelled `outside` (MEMORY.md §6 M11f). */
export const OUTSIDE_READ = 'outside memory';

export abstract class CoreMemory extends CoreWatches {
  facts(filter: facts.FactsFilter, before: number | null, limit: number): { items: Fact[]; last: number | null } {
    const now = Date.now();
    const rows = facts.factsPage(this.db, filter, before, limit);
    return { items: rows.map((r) => facts.toFact(r, now)), last: rows.at(-1)?.seq ?? null };
  }

  /** The songs the owner said never to play again (MUSIC.md §10.5): the track ids their current
   * `music.never` rules name, which Music's find leaves out. */
  musicNever(now = Date.now()): string[] {
    const ids = new Set<string>();
    for (const text of facts.ruleTexts(this.db, MUSIC_NEVER_SUBJECT, now))
      for (const m of text.matchAll(MUSIC_REF_IN_TEXT)) ids.add(m[1]);
    return [...ids];
  }

  /** Whether "Use my listening history" (`music.history`) is on: the DJ shuffle and a play_mix
   * find weigh by it only then (MUSIC.md §16.4). One settings row. */
  historyOn(): boolean {
    return getSetting(this.db, 'music.history') !== false;
  }

  /** One fact with its history and evidence. A mind session that did not ask (`asked`) gets what is
   * labelled `outside` kept back (areas/memory/kept.ts); one that asked is marked first. */
  factDetail(c: Caller, id: string, asked = false): Out<FactDetail | null> {
    return attempt(() =>
      this.ctx.storage.transactionSync(() => {
        const d = detail(this.db, id, Date.now());
        if (!d || c.who === 'D') return d;
        const days = new Set(
          d.evidence
            .filter(
              (e) => e.kind === 'day' && notes.notedBy(notes.dayNote(this.db, e.ref.slice(4)) ?? {}) === 'outside',
            )
            .map((e) => e.ref),
        );
        if (!detailHasOutside(d, days)) return d;
        if (!asked) return keptDetail(d, days);
        this.markOutside(c);
        return d;
      }),
    );
  }

  /** A mind session is about to be served memory labelled `outside` (MEMORY.md §6 M11f): the Worker
   * marks it as having read outside text first, as for songs' tags, so what it writes after is
   * labelled `outside`. It must be named (422 without TH-Session) and be a claimed, live session of
   * its role (403 session_required), so a made-up id can't take the mark in its place. */
  outsideRead(c: Caller): Out<null> {
    return attempt(() => this.ctx.storage.transactionSync(() => this.markOutside(c)));
  }

  private markOutside(c: Caller): null {
    if (!c.session_id) throw invalid('TH-Session', 'required: outside text marks the session that reads it');
    const role = c.who === 'N' ? 'night' : 'chat';
    claimedSession(this.db, c.session_id, role);
    taint(this.db, c.session_id, role, OUTSIDE_READ, Date.now(), this.tz());
    return null;
  }

  profile(): ProfileResponse {
    const now = Date.now();
    const rows = facts.recentCurrent(this.db, PROFILE_READ);
    return { ...renderProfile(rows, now, this.tz()), rendered_at: now };
  }

  /** Whether this caller may write memory at all, and the owner's zone: the memory route asks before
   * it has the senses count a batch's `rollup:` refs (memory/rollups.ts), so a batch Core would refuse
   * (403 session_required, off_record) costs the Senses object nothing. */
  memoryWriter(c: Caller): Out<{ tz: string }> {
    return attempt(() => {
      if (c.who !== 'D' && claimedSession(this.db, c.session_id, c.who === 'N' ? 'night' : 'chat').offRecord)
        throw new Fail('off_record');
      return { tz: this.tz() };
    });
  }

  /** `rollups`: the `rollup:` refs the batch cites, counted again by the senses (memory/rollups.ts). */
  memoryOps(
    c: Caller,
    batchId: string,
    ops: unknown[],
    hash: string,
    rollups: Record<string, number> = {},
  ): Out<MemoryOpsResponse> {
    return this.run((w) => memory.apply(w, c, batchId, Array.isArray(ops) ? ops : [], hash, rollups));
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

  /** Of the recall's candidates, those that still stand, with a message's thread (search/live.ts). */
  recallLive(refs: string[]): Record<string, string | null> {
    return Object.fromEntries(liveRefs(this.db, refs.slice(0, 50)));
  }

  /** The recall indexer runs (areas/search/embed-job.ts): on the day roll and when the night is done. */
  protected queueRecall(now = Date.now()): void {
    this.write((w) => queueEmbed(w.db, w.at), now);
    this.schedule();
  }
}
