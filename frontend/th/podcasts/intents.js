// @ts-check
// Podcasts' pending intents (API.md §11.11 "Pending intents"; PODCASTS.md §5.4): the verbs the mind
// queued for what lives in the app's own storage (`jarvis.podcasts.v1`: the shows followed and Up
// Next), applied by th/podcasts/progress.js as Podcasts opens, before the app reads that storage,
// so the app shows them as if the owner had done it (and the follows go up to the Worker with the
// next sync). Each returns its inverse:
// - `podcasts.follow` adds the show (a show already followed: nothing to undo); its undo unfollows;
// - `podcasts.unfollow` removes the show by its id (the 16-hex hash of its address, the Worker's
//   show id); its undo follows it again with its title, author and artwork;
// - `podcasts.queue_episode` adds an episode of a followed show (its newest, or by id) to the end of
//   Up Next, from the show's feed as the app last saved it (`feed_not_saved` when it has none yet);
//   its undo `podcasts.unqueue_episode` takes it out.
// The limits are the app's: 100 shows, 100 episodes in Up Next.
import { applyIntents, workerIo } from '../ported/intents.js';
import { episodeID } from './feed.js';

/** @typedef {{ feedUrl: string, title?: string, author?: string, artwork?: string }} Show */
/** @typedef {{ id: string, show?: Show, [k: string]: unknown }} Episode */
/** @typedef {{ follows: Show[], queue?: Episode[], [k: string]: unknown }} App */
/** @typedef {{ app: App, storedFeed: (feedUrl: string) => Promise<{ show?: Record<string, unknown>, episodes?: Episode[] } | null> }} Podcasts */

export const SHOWS_MAX = 100;
export const QUEUE_MAX = 100;

/** The app's key for an episode (podcasts/core.js `keyOf`). @param {Episode} e */
const keyOf = (e) => `${e.show?.feedUrl}#${e.id}`;
/** @param {App} app @param {string} id */
const followed = (app, id) => app.follows.findIndex((s) => typeof s?.feedUrl === 'string' && episodeID(s.feedUrl) === id);

/** @type {import('../ported/intents.js').Executors<Podcasts>} */
export const EXECUTORS = {
  'podcasts.follow': {
    1: async ({ app }, { feed_url, title, author, artwork }) => {
      const id = episodeID(feed_url);
      if (followed(app, id) >= 0) return { ok: true, result: { show_id: id } };
      if (app.follows.length >= SHOWS_MAX) return { ok: false, error: { code: 'library_full' } };
      app.follows.push({ feedUrl: feed_url, title, author: author ?? '', artwork: artwork ?? '' });
      return { ok: true, result: { show_id: id }, undo: { verb: 'podcasts.unfollow', schema: 1, args: { show_id: id } } };
    },
  },
  'podcasts.unfollow': {
    1: async ({ app }, { show_id }) => {
      const i = followed(app, show_id);
      if (i < 0) return { ok: true, result: {} };
      const [s] = app.follows.splice(i, 1);
      const args = {
        feed_url: s.feedUrl,
        title: String(s.title || 'Podcast').slice(0, 300),
        ...(s.author ? { author: String(s.author).slice(0, 200) } : {}),
        ...(s.artwork ? { artwork: String(s.artwork).slice(0, 2000) } : {}),
      };
      return { ok: true, result: {}, undo: { verb: 'podcasts.follow', schema: 1, args } };
    },
  },
  'podcasts.queue_episode': {
    1: async ({ app, storedFeed }, { show_id, episode_id }) => {
      const i = followed(app, show_id);
      if (i < 0) return { ok: false, error: { code: 'not_followed' } };
      const show = app.follows[i];
      const data = await storedFeed(show.feedUrl).catch(() => null);
      const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
      if (!episodes.length) return { ok: false, error: { code: 'feed_not_saved', message: 'open the show once in Podcasts' } };
      const e = episode_id ? episodes.find((x) => x?.id === episode_id) : episodes[0];
      if (!e) return { ok: false, error: { code: 'episode_unknown' } };
      // As the app makes an Up Next entry (podcasts/app.js `episode`): the episode with its show.
      const entry = { ...e, show: { ...data?.show, ...show } };
      const key = keyOf(entry);
      if (!Array.isArray(app.queue)) app.queue = [];
      const queue = app.queue;
      if (queue.some((x) => keyOf(x) === key)) return { ok: true, result: { key } };
      if (queue.length >= QUEUE_MAX) return { ok: false, error: { code: 'queue_full' } };
      queue.push(entry);
      return { ok: true, result: { key }, undo: { verb: 'podcasts.unqueue_episode', schema: 1, args: { key } } };
    },
  },
  'podcasts.unqueue_episode': {
    1: async ({ app }, { key }) => {
      if (Array.isArray(app.queue)) app.queue = app.queue.filter((x) => keyOf(x) !== key);
      return { ok: true, result: {} };
    },
  },
};

/** The app's pending intents applied to its storage `app` (not yet saved): the outcomes and `send`,
 * which reports them once the caller has saved; null when signed out or without a Worker. */
export async function applyToApp(/** @type {App} */ app) {
  const io = await workerIo('podcasts');
  if (!io) return null;
  // The app's own saved feeds (podcasts/core.js, the ported app's code: not type-checked here).
  const core = '/podcasts/core.js';
  const { storedFeed } = /** @type {{ storedFeed: Podcasts['storedFeed'] }} */ (await import(core));
  return applyIntents(EXECUTORS, { app, storedFeed }, io);
}
