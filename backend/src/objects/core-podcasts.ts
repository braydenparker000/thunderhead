// Podcasts' half of the Core object (areas/podcasts, NEXT-BATCH.md part 7): where each episode was
// left and the shows followed, synced by the phone (the newer wins), read by the phones by time and
// by the night with its last check of each show. A code layer of the one Core class. The night may
// read only followed shows' feeds through the Worker, at most 40 a UTC day, counted in a settings row.
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

  podcastsChecked(items: PodcastChecked[]): Out<{ updated: number; at: number }> {
    return this.run((w) => sync.checked(w, items));
  }

  /** Whether the night may read this feed now (a followed show's, within the day's count). */
  admitNightFeed(feedUrl: string): ReturnType<typeof sync.admitNightFeed> {
    return this.ctx.storage.transactionSync(() => sync.admitNightFeed(this.db, feedUrl, Date.now()));
  }
}
