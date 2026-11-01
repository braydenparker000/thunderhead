// Podcasts' half of the Core object (areas/podcasts, NEXT-BATCH.md part 7): where each episode was
// left and the shows followed, synced by the phone (the newer wins), read by the phones by time and
// by the night with its last check of each show. A code layer of the one Core class. The night's
// feed reads through the Worker are counted here in memory, per UTC day (the count costs no row).
import type {
  PodcastChecked,
  PodcastFollow,
  PodcastProgress,
  PodcastSyncResponse,
} from '../../../shared/contract/podcasts.ts';
import * as store from '../areas/podcasts/store';
import * as sync from '../areas/podcasts/sync';
import type { Out } from '../lib/result';
import { CoreReports } from './core-reports';

type Page<R> = { rows: R[]; more: boolean; last: [number, string] | null; at: number };

export abstract class CorePodcasts extends CoreReports {
  /** The night's feed reads today (UTC). */
  private readonly nightFeeds = { day: '', n: 0 };

  putPodcastProgress(items: PodcastProgress[]): Out<PodcastSyncResponse> {
    return this.run((w) => sync.putProgress(w, items));
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

  putPodcastFollows(items: PodcastFollow[]): Out<PodcastSyncResponse> {
    return this.run((w) => sync.putFollows(w, items));
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

  podcastsChecked(items: PodcastChecked[]): Out<{ updated: number; at: number }> {
    return this.run((w) => sync.checked(w, items));
  }

  /** 0 when the night may read one more feed today, else the seconds until 00:00 UTC. */
  admitNightFeed(): number {
    return sync.admitFeedRead(this.nightFeeds, Date.now());
  }
}
