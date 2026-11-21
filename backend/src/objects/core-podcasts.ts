// Podcasts' half of the Core object (areas/podcasts, NEXT-BATCH.md part 7): where each episode was
// left, the shows followed, Up Next and the playback speed, synced by the phone (the newer wins), read
// by the phones by time and by the night (positions and follows) with its last check of each show. A code layer of the one Core class. The night may
// read only followed shows' feeds through the Worker, at most 40 a UTC day, counted in a settings row.
import type {
  PodcastChecked,
  PodcastFollow,
  PodcastPref,
  PodcastProgress,
  PodcastQueueItem,
  PodcastSyncResponse,
} from '../../../shared/contract/podcasts.ts';
import { claimedSession, taintedAt } from '../areas/mind/guards';
import { taint } from '../areas/mind/ops';
import * as queue from '../areas/podcasts/queue';
import * as store from '../areas/podcasts/store';
import * as sync from '../areas/podcasts/sync';
import { attempt, invalid, type Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreReports } from './core-reports';

/** The taint source a Podcasts read records (the hooks' and th's are theirs). */
export const PODCASTS_TAINT = 'podcasts';

type Page<R> = { rows: R[]; more: boolean; last: [number, string] | null; at: number };
type Refused = PodcastSyncResponse['refused'];

export abstract class CorePodcasts extends CoreReports {
  putPodcastProgress(items: PodcastProgress[], refused: Refused): Out<PodcastSyncResponse> {
    return this.run((w) => sync.putProgress(w, items, refused));
  }

  podcastProgress(after: [number, string], limit: number): Page<PodcastProgress> {
    const p = sync.page(
      (a, n) => store.progressPage(this.db, a, n),
      (r) => r.key,
      after,
      limit,
      Date.now(),
    );
    return { ...p, rows: p.rows.map(sync.toProgress) };
  }

  putPodcastFollows(items: PodcastFollow[], refused: Refused): Out<PodcastSyncResponse> {
    return this.run((w) => sync.putFollows(w, items, refused));
  }

  podcastFollows(after: [number, string], limit: number): Page<ReturnType<typeof sync.toFollow>> {
    const p = sync.page(
      (a, n) => store.followsPage(this.db, a, n),
      (r) => r.feed_url,
      after,
      limit,
      Date.now(),
    );
    return { ...p, rows: p.rows.map(sync.toFollow) };
  }

  putPodcastQueue(items: PodcastQueueItem[], refused: Refused): Out<PodcastSyncResponse> {
    return this.run((w) => queue.putQueue(w, items, refused));
  }

  podcastQueue(after: [number, string], limit: number): Page<ReturnType<typeof queue.toQueueItem>> {
    const p = sync.page((a, n) => queue.queuePage(this.db, a, n), (r) => r.key, after, limit, Date.now());
    return { ...p, rows: p.rows.map(queue.toQueueItem) };
  }

  putPodcastPrefs(items: PodcastPref[], refused: Refused): Out<PodcastSyncResponse> {
    return this.run((w) => queue.putPrefs(w, items, refused));
  }

  podcastPrefs(after: [number, string], limit: number): Page<PodcastPref> {
    const p = sync.page((a, n) => queue.prefsPage(this.db, a, n), (r) => r.name, after, limit, Date.now());
    return { ...p, rows: p.rows.map(queue.toPref) };
  }

  podcastsChecked(items: PodcastChecked[]): Out<{ updated: number; at: number }> {
    return this.run((w) => sync.checked(w, items));
  }

  /** A mind session is about to be served what podcast publishers wrote (show titles, feed
   * addresses, a feed): the Worker marks it tainted itself, whatever prints it, before it is served
   * (M-1 of the second read). The session must be named (422 without TH-Session: raw curl sends none)
   * and be a claimed, live session of its role (403 session_required: a made-up id can't take the
   * mark instead). Once a session is tainted this reads two or three rows and writes none. */
  podcastsRead(c: Caller): Out<null> {
    return attempt(() =>
      this.ctx.storage.transactionSync(() => {
        if (!c.session_id) throw invalid('TH-Session', 'required: reading this marks the session tainted');
        const role = c.who === 'N' ? 'night' : c.who === 'R' ? 'reflex' : 'chat';
        claimedSession(this.db, c.session_id, role);
        if (taintedAt(this.db, c.session_id) === null)
          taint(this.db, c.session_id, role, PODCASTS_TAINT, Date.now(), this.tz());
        return null;
      }),
    );
  }

  /** Of this show's episodes (by the phone's ids), the ones a phone has started or finished: counts
   * mode leaves them out of "new". At most 50 looked up. */
  podcastsStarted(feedUrl: string, ids: string[]): string[] {
    const keys = ids.slice(0, 50).map((id) => `${feedUrl}#${id}`);
    return store.started(this.db, keys).map((k) => k.slice(feedUrl.length + 1));
  }

  /** Whether the night may read this show's feed now, and its address (a followed show's, by its id,
   * within the day's count). The address stays in the Worker. */
  admitNightFeed(showId: string): ReturnType<typeof sync.admitNightFeed> {
    return this.ctx.storage.transactionSync(() => sync.admitNightFeed(this.db, showId, Date.now()));
  }
}
