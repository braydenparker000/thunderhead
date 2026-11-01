// The listening pass's half of the Music object (JOBS.md §3, MUSIC.md §9.1; areas/music/listen*.ts):
// thin RPCs over the jobs Actions works on, the results Core's apply job hands over a part at a time,
// the phone's file and the mind's read of one song. A code layer of the one Music class (music.ts
// extends it), like Core's layers: no Durable Object class of its own. Writes are one transaction
// each; an RPC that also reads or writes the private bucket does that outside its transaction.
import {
  type JobIssued,
  type JobStatus,
  LISTEN_LIMITS as L,
  type ListenKind,
  type TrackAnalysis,
} from '../../../shared/contract/listen.ts';
import * as listen from '../areas/music/listen';
import { dropJobFiles, specKey, tidy } from '../areas/music/listen-files';
import { buildPack, NEIGHBOURS_KEY, type Neighbours, PACK_KEY, readNeighbours } from '../areas/music/listen-pack';
import { analysisView, likeList, nearest, stateOf, trackRow } from '../areas/music/listen-read';
import * as store from '../areas/music/listen-store';
import * as tracks from '../areas/music/listen-store-tracks';
import { version as catalogVersion } from '../areas/music/store';
import { attempt, attemptAsync, Fail, type Out } from '../lib/result';
import { OwnerObject } from './base';

export abstract class MusicListen extends OwnerObject {
  /** The last neighbours file, read once per job (it is replaced, never changed). */
  private nb: { job_id: string; nb: Neighbours | null } | null = null;
  /** Each audio hash's first track, by neighbours job and catalog version. */
  private first: { version: string; map: Map<string, string> } | null = null;

  private tx<T>(fn: () => T): T {
    return this.ctx.storage.transactionSync(fn);
  }

  private vault(): R2Bucket {
    if (!this.env.VAULT) throw new Fail('not_configured');
    return this.env.VAULT;
  }

  /** Issued specs past their time expire, and their files go; with `sweep`, also files any closed job
   * left behind (once a night, from GET /v1/jobs/next). */
  private async expire(now: number, sweepToo = false): Promise<void> {
    const ids = this.tx(() => store.expire(this.db, now));
    const open = (id: string) => {
      const s = store.job(this.db, id)?.state;
      return s === 'issued' || s === 'validating';
    };
    // Deleting is housekeeping: a bucket error is logged as a count and tried again on the next call.
    await tidy(this.vault(), ids, sweepToo ? open : null);
  }

  /** GET /v1/jobs/next: a new job of the kind, or null when nothing is due. */
  listenNext(kind: ListenKind, max: number, now = Date.now()): Promise<Out<JobIssued | null>> {
    return attemptAsync(async () => {
      await this.expire(now, true);
      if (kind === 'audio.analysis') return this.tx(() => listen.issueAnalysis(this.db, max, now));
      const vault = this.vault();
      const job = this.tx(() => listen.issueNeighbours(this.db, now));
      if (!job) return null;
      try {
        await vault.put(specKey(job.job_id, 'order'), job.order);
        await vault.put(specKey(job.job_id, 'emb'), job.emb);
      } catch (e) {
        // A spec that can't be read is no job: it is let go at once rather than in 72 hours.
        this.tx(() => store.setJob(this.db, job.job_id, { state: 'expired' }));
        throw e;
      }
      return { job_id: job.job_id, kind: 'audio.neighbours', v: 1, n: job.n, expires_at: job.expires_at };
    });
  }

  /** GET /v1/jobs/:id/spec and the uploads' check: an issued job's kind and spec. */
  listenSpec(id: string, now = Date.now()): Out<{ kind: ListenKind; spec: listen.Spec }> {
    return attempt(() => listen.specOf(this.db, id, now));
  }

  /** POST /v1/jobs/:id/collect, after the route read the manifest: checks 1–3 and 6. */
  async listenCollect(id: string, manifest: unknown, now = Date.now()): Promise<Out<listen.Collected>> {
    const out = attempt(() => this.tx(() => listen.collect(this.db, id, manifest, now)));
    if (out.ok && out.value.state === 'rejected') await dropJobFiles(this.vault(), id);
    return out;
  }

  /** One part of checked results from Core's apply job; the rows written (for the bulk lane). */
  listenApply(
    id: string,
    part: number,
    rows: store.ResultRow[],
    invalid: Record<string, number>,
    now = Date.now(),
  ): number {
    return this.tx(() => listen.apply(this.db, id, part, rows, invalid, now));
  }

  /** An Actions job whose apply failed for good: rejected (what was applied stays, and counts). */
  listenReject(id: string): { written: number; valid: number } {
    return this.tx(() => listen.reject(this.db, id));
  }

  listenFinish(id: string, failed: [string, string][], now = Date.now()): { written: number; valid: number } {
    return this.tx(() => listen.finish(this.db, id, failed, now));
  }

  /** A neighbours job's end, after Core's job put the checked file in place (null problem), or why
   * it was refused. */
  listenNeighbours(id: string, problem: string | null, now = Date.now()): number {
    return this.tx(() => listen.neighboursDone(this.db, id, problem, now));
  }

  /** One page of `track_analysis` from the last neighbours (the neighbours job's steps, ≤ `limit` rows
   * each): rows written, and the catalog place to go on after (null at the end). */
  async listenTrackRows(afterOrd: number, limit: number): Promise<{ written: number; last: number | null }> {
    const { nb } = await this.neighbours();
    const page = tracks.analysedTracks(this.db, afterOrd, limit);
    if (!page.length) return { written: 0, last: null };
    const version = `${store.getState<{ job_id: string }>(this.db, 'listen.neighbours')?.job_id}|${catalogVersion(this.db).version}`;
    if (this.first?.version !== version) this.first = { version, map: tracks.firstTracks(this.db) };
    const first = this.first.map;
    const written = this.tx(() =>
      page.reduce((n, t) => n + tracks.putTrackRow(this.db, trackRow(t, nearest(nb, t.sha256, L.k), first)), 0),
    );
    return { written, last: page.length < limit ? null : (page.at(-1)?.ord ?? null) };
  }

  listenJob(id: string): JobStatus | null {
    const r = store.job(this.db, id);
    return r ? listen.status(r) : null;
  }

  async listenJobs(kind: ListenKind | null, open: boolean, now = Date.now()): Promise<JobStatus[]> {
    await this.expire(now);
    return store.jobs(this.db, kind, open, 20).map(listen.status);
  }

  /** The last neighbours, or null before the first neighbours job. */
  private async neighbours(): Promise<{ nb: Neighbours | null; at: number | null }> {
    const s = store.getState<{ job_id: string; at: number }>(this.db, 'listen.neighbours');
    if (!s) return { nb: null, at: null };
    if (this.nb?.job_id !== s.job_id) {
      const obj = await this.vault().get(NEIGHBOURS_KEY);
      this.nb = { job_id: s.job_id, nb: obj ? readNeighbours(new Uint8Array(await obj.arrayBuffer())) : null };
    }
    return { nb: this.nb.nb, at: s.at };
  }

  /** The phone's file (listen-pack.ts), built from every analysed track and the last neighbours, put
   * in the private bucket for GET /v1/music/pack. */
  async buildPack(now = Date.now()): Promise<{ tracks: number; bytes: number }> {
    const { nb, at } = await this.neighbours();
    const rows = store.packRows(this.db).map((r) => ({ id: r.id, sha256: r.sha256, pack: new Uint8Array(r.pack) }));
    const bytes = buildPack(rows, nb, { built_at: now, neighbours_at: at });
    await this.vault().put(PACK_KEY, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
    this.tx(() => store.putState(this.db, 'listen.pack', { tracks: rows.length, bytes: bytes.length, built_at: now }));
    return { tracks: rows.length, bytes: bytes.length };
  }

  /** GET /v1/music/analysis/:id: one song's numbers and its `like` nearest songs; null: no such track. */
  async trackAnalysis(id: string, like: number): Promise<TrackAnalysis | null> {
    const t = store.trackOf(this.db, id);
    if (!t) return null;
    const a = store.analysisOf(this.db, t.sha256);
    const want = Math.min(L.like_max, Math.max(0, like));
    const { nb, at } = want && a?.pack ? await this.neighbours() : { nb: null, at: null };
    const near = nearest(nb, t.sha256, want);
    const self = a?.pack ? new Uint8Array(a.pack) : null;
    return {
      id,
      state: stateOf(t.audio_key === `native/audio/${t.sha256}.opus`, a),
      analysis: analysisView(a),
      like: likeList(self, near, store.tracksOf(this.db, near), store.packsOf(this.db, near)),
      like_at: at,
    };
  }
}
