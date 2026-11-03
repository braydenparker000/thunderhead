// Work orders and the Briefing's half of the Core object (areas/work, MUSE-PROTOCOL.md): the
// mind's orders (the owner's `@muse` are made with their message, core.ts), Muse's calls and
// uploads, the tick's leases, deadlines and upload batches, and what the Briefing page shows. A
// code layer of the one Core class. (The Daily Board, its brief and approval were cut on 2026-10-31.)

import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import type { Permit } from '../../../shared/contract/permits.ts';
import type { MuseNote, WorkHello, WorkOrder, WorkOrderPut, WorkStatus } from '../../../shared/contract/work.ts';
import { briefing } from '../areas/briefing/assemble';
import { type Forecast, type Place, weatherTile } from '../areas/briefing/weather';
import { logicalDay } from '../areas/conversation/day';
import { deleteSetting, getSetting, putSetting } from '../areas/settings/store';
import { uploaded } from '../areas/work/batch';
import * as work from '../areas/work/ops';
import { create } from '../areas/work/placed';
import * as wstore from '../areas/work/store';
import { Fail, invalid, type Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreBackups } from './core-backups';

export abstract class CoreWork extends CoreBackups {
  /** The tick's work pass. */
  protected workTick(now: number): void {
    if (this.sandboxed) return;
    this.write((w) => work.tick(w), now);
  }

  workCreate(c: Caller, id: string, r: WorkOrderPut): Out<{ order: WorkOrder; created: boolean; permit?: Permit }> {
    return this.run((w) => create(w, c, id, r));
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

  workHello(): WorkHello {
    return this.write((w) => work.hello(w));
  }
  workClaim(): WorkOrder | null {
    return this.write((w) => work.claim(w));
  }
  workHeartbeat(id: string, note: string | null): Out<{ lease_until: number }> {
    return this.run((w) => work.heartbeat(w, id, note));
  }
  workResult(id: string, result: unknown): Out<{ ok: true } | { ok: false; problems: string[]; left: number }> {
    return this.run((w) => work.result(w, id, result));
  }
  workFail(id: string, reason: string, retry: boolean): Out<{ status: string }> {
    return this.run((w) => work.fail(w, id, reason, retry));
  }
  /** Songs Muse registered through its signed route (areas/music/upload.ts): its upload batch. */
  workUploaded(ids: string[], artists: string[]): void {
    if (this.sandboxed) return;
    this.write((w) => uploaded(w, ids, artists));
  }
  /** Muse's thread, or one order's progress lines. */
  museNotes(after: number, limit: number, orderId: string | null = null): MuseNote[] {
    return orderId ? wstore.notesOf(this.db, orderId, after, limit) : wstore.notesAfter(this.db, after, limit);
  }
  /** A note in Muse's thread; Muse's naming the order it holds is a progress line of it (a heartbeat). */
  museNote(id: string, author: MuseNote['author'], body: string, orderId: string | null = null): Out<{ id: string }> {
    return this.run((w) => {
      if (orderId && author !== 'muse') throw invalid('order_id', "only Muse's progress lines name an order");
      if (author === 'muse') work.touch(w);
      const had = wstore.note(w.db, id);
      if (had && (had.body !== body || had.author !== author || had.order_id !== orderId)) throw new Fail('conflict');
      if (orderId) work.heartbeat(w, orderId, body);
      wstore.insertNote(w.db, { id, author, body, order_id: orderId, at: w.at });
      w.change('work', `note:${id}`);
      return { id };
    });
  }

  /** GET /v1/briefing: what the Briefing page shows now; `songsAdded` from the Music object. */
  briefingNow(songsAdded: number | null = null): BriefingResponse {
    const now = Date.now();
    const tz = this.tz();
    const day = logicalDay(now, tz);
    const { place, forecast } = this.weather();
    return briefing(this.db, {
      now,
      tz,
      day,
      weather: weatherTile(place, forecast, now, tz),
      songsAdded,
      nightConfigured: this.nightConfigured(),
    });
  }

  /** The owner's country (ISO 3166-1 alpha-2) for the Holidays tile, or undefined. */
  ownerCountry(): string | undefined {
    const v = getSetting(this.db, 'owner.country');
    return typeof v === 'string' ? v : undefined;
  }

  /** PUT /v1/briefing/place: the place and, from the same lookup, the owner's country (a place
   * whose country the geocoder doesn't give leaves none, so the Holidays tile hides). */
  setPlace(place: Place, country: string | null, actor: string): void {
    this.write((w) => {
      putSetting(w.db, 'weather.place', place, actor, w.at);
      w.change('setting', 'setting:weather.place');
      if (country) putSetting(w.db, 'owner.country', country, actor, w.at);
      else deleteSetting(w.db, 'owner.country');
      w.change('setting', 'setting:owner.country');
    });
  }

  /** The country of a place kept before 2026-11-02 (when it wasn't asked), looked up once: kept
   * only while that place is still the one set and no country is. */
  backfillCountry(place: Place, country: string): void {
    this.write((w) => {
      const now = this.weather().place;
      if (!now || now.lat !== place.lat || now.lon !== place.lon || this.ownerCountry()) return;
      putSetting(w.db, 'owner.country', country, 'worker', w.at);
      w.change('setting', 'setting:owner.country');
    });
  }

  /** The weather's place and the forecast kept for it (BRIEFING.md §2): Core settings only. */
  weather(): { place: Place | null; forecast: Forecast | null } {
    return {
      place: (getSetting(this.db, 'weather.place') as Place | undefined) ?? null,
      forecast: (getSetting(this.db, 'weather.forecast') as Forecast | undefined) ?? null,
    };
  }

  /** A new forecast for the place it was asked for (a place changed meanwhile keeps its own). */
  putForecast(place: Place, f: Forecast): void {
    this.ctx.storage.transactionSync(() => {
      const now = this.weather().place;
      if (now && now.lat === place.lat && now.lon === place.lon)
        putSetting(this.db, 'weather.forecast', f, 'worker', f.at);
    });
  }
}
