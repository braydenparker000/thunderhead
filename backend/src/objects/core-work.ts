// Work orders and the Briefing's half of the Core object (P4 stages G–H, areas/work): the mind's
// orders, Muse's calls, the owner's Board brief and its standing approval (one card the Worker
// raises when a brief or Muse first appears), the tick's leases, deadlines and daily Board order,
// and what the Briefing page shows. A code layer of the one Core class.
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import type {
  BoardBrief,
  MuseNote,
  WorkHello,
  WorkOrder,
  WorkOrderPut,
  WorkStatus,
} from '../../../shared/contract/work.ts';
import { briefing } from '../areas/briefing/assemble';
import { logicalDay } from '../areas/conversation/day';
import { raise } from '../areas/proposals/ops';
import * as pstore from '../areas/proposals/store';
import { putSetting } from '../areas/settings/store';
import * as work from '../areas/work/ops';
import * as wstore from '../areas/work/store';
import { uuidv7 } from '../lib/ids';
import { Fail, type Out } from '../lib/result';
import { dayBefore } from '../lib/time';
import type { Caller } from './caller';
import type { Writer } from './commit';
import { CoreBackups } from './core-backups';

const BOARD_REF = 'board:board.edition';

export abstract class CoreWork extends CoreBackups {
  /** The standing Board approval's card, once: when a brief exists and Muse may not read it yet. */
  private askBoard(w: Writer): void {
    if (work.boardAllowed(w.db) || !work.brief(w.db) || pstore.askedAbout(w.db, BOARD_REF)) return;
    raise(
      w,
      uuidv7(w.at),
      {
        class: 'reach_people',
        question: 'Let Muse read your Board brief?',
        why: 'Muse writes your daily Board from it: the topics, depth and length you chose. Nothing else of yours.',
        if_ignored: 'No Board from Muse; nothing else changes.',
        options: ['Let Muse read it', 'Not now'],
        safe: 'snooze',
        spec: { v: 1, op: 'board.allow', args: { kind: 'board.edition' } },
      },
      this.tz(),
    );
  }

  /** The tick's work pass. */
  protected workTick(now: number): void {
    if (this.sandboxed) return;
    const tz = this.tz();
    this.write((w) => work.tick(w, logicalDay(now, tz), tz), now);
  }

  workCreate(c: Caller, id: string, r: WorkOrderPut): Out<{ order: WorkOrder; created: boolean }> {
    return this.run((w) => work.create(w, c, id, r));
  }
  workCancel(_c: Caller, id: string): Out<{ status: 'cancelled' }> {
    return this.run((w) => work.cancel(w, id));
  }
  workList(limit: number, status?: WorkStatus): WorkOrder[] {
    return wstore.list(this.db, limit, status).map(wstore.toOrder);
  }
  workOrder(id: string): WorkOrder | null {
    const o = wstore.order(this.db, id);
    return o ? wstore.toOrder(o) : null;
  }

  boardBrief() {
    const b = work.brief(this.db);
    return {
      version: b?.version ?? 0,
      brief: (b?.brief as BoardBrief | undefined) ?? null,
      allowed: work.boardAllowed(this.db),
    };
  }
  boardBriefPut(c: Caller, version: number, brief: BoardBrief): Out<{ version: number }> {
    return this.run((w) => {
      const had = work.brief(w.db);
      if ((had?.version ?? 0) !== version)
        throw new Fail('conflict', { reason: `the brief is at version ${had?.version ?? 0}` });
      putSetting(w.db, 'board.brief', { version: version + 1, brief, updated_at: w.at }, c.actor, w.at);
      w.change('setting', 'setting:board.brief');
      w.ledger({
        kind: 'note',
        actor: c.actor,
        session_id: c.session_id,
        what: 'updated the Board brief',
        why: 'the owner asked (BRIEFING.md §5)',
        ref: 'board:brief',
        undoable: false,
      });
      this.askBoard(w);
      return { version: version + 1 };
    });
  }
  boardDisallow(c: Caller): { allowed: false } {
    this.write((w) => {
      if (!work.boardAllowed(w.db)) return;
      w.db.run("DELETE FROM settings WHERE key = 'board.allowed'");
      w.change('setting', 'setting:board.allowed');
      w.ledger({
        kind: 'note',
        actor: c.actor,
        session_id: c.session_id,
        what: "withdrew Muse's reading of the Board brief",
        why: 'the owner withdrew the standing approval (MUSE.md §6)',
        ref: BOARD_REF,
        undoable: false,
      });
    });
    return { allowed: false };
  }

  workHello(): WorkHello {
    return this.write((w) => {
      const h = work.hello(w);
      this.askBoard(w);
      return h;
    });
  }
  workClaim(): WorkOrder | null {
    return this.write((w) => work.claim(w));
  }
  workHeartbeat(id: string, note: string | null): Out<{ lease_until: number }> {
    return this.run((w) => work.heartbeat(w, id, note));
  }
  workResult(id: string, result: unknown): Out<{ ok: true } | { ok: false; problems: string[] }> {
    return this.run((w) => work.result(w, id, result));
  }
  workFail(id: string, reason: string): Out<{ status: string }> {
    return this.run((w) => work.fail(w, id, reason));
  }
  workBoardBrief(): { version: number; brief: BoardBrief } | null {
    return this.write((w) => {
      work.touch(w);
      const b = work.brief(w.db);
      return work.boardAllowed(w.db) && b ? { version: b.version, brief: b.brief as BoardBrief } : null;
    });
  }
  museNotes(after: number, limit: number): MuseNote[] {
    return wstore.notesAfter(this.db, after, limit);
  }
  museNote(id: string, author: MuseNote['author'], body: string): Out<{ id: string }> {
    return this.run((w) => {
      if (author === 'muse') work.touch(w);
      const had = wstore.note(w.db, id);
      if (had && (had.body !== body || had.author !== author)) throw new Fail('conflict');
      wstore.insertNote(w.db, { id, author, body, at: w.at });
      w.change('work', `note:${id}`);
      return { id };
    });
  }

  /** GET /v1/briefing: what the Briefing page shows now. */
  briefingNow(): BriefingResponse {
    const now = Date.now();
    const tz = this.tz();
    const day = logicalDay(now, tz);
    return briefing(this.db, { now, tz, day, yesterday: dayBefore(day) });
  }

  /** The Board edition of a day, for the reader. */
  boardEdition(day: string): { day: string; edition: unknown; finished_at: number } | null {
    const r = wstore.latestDone(this.db, 'board.edition', [day]);
    return r ? { day, edition: JSON.parse(r.result_json ?? 'null'), finished_at: r.finished_at ?? 0 } : null;
  }
}
