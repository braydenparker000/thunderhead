// Podcasts' verbs (verbs.ts; PODCASTS.md §5.4): the shows followed and Up Next live in the app's
// own storage (intents Podcasts applies when it opens); where each episode was left is the
// Worker's too, so marking one played runs there.
import * as z from 'zod/mini';
import { feedProblem, PODCAST_LIMITS, progressKeyProblem } from './podcasts.ts';
import type { VerbSpec } from './verb-spec.ts';

const showId = z.string().check(z.regex(/^[0-9a-f]{16}$/));
const episodeId = z.string().check(z.regex(new RegExp(`^[A-Za-z0-9_-]{1,${PODCAST_LIMITS.id_chars}}$`)));
const feedUrl = z.string().check(
  z.maxLength(PODCAST_LIMITS.url_chars),
  z.refine((u) => feedProblem(u) === null, 'an http(s) address'),
);
const episodeKey = z.string().check(
  z.maxLength(PODCAST_LIMITS.url_chars + 1 + PODCAST_LIMITS.id_chars),
  z.refine((k) => progressKeyProblem(k) === null, '<feed address>#<episode id>'),
);
const show = {
  feed_url: feedUrl,
  title: z.string().check(z.minLength(1), z.maxLength(PODCAST_LIMITS.title_chars)),
  author: z.optional(z.string().check(z.maxLength(PODCAST_LIMITS.author_chars))),
  artwork: z.optional(z.string().check(z.maxLength(PODCAST_LIMITS.url_chars))),
};

export const PODCAST_VERBS = {
  'podcasts.follow': {
    app: 'podcasts',
    class: 'reversible',
    permit: 'podcasts',
    side: 'phone',
    intent: true,
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object(show),
        result: z.object({ show_id: z.string() }),
      },
    },
    what: 'follow a show',
    doc: "Follows a show by its feed address in Podcasts. The follows live in the app (the Worker keeps the copy it sends), so Podcasts applies it when it next opens (an intent). Its undo unfollows it; a show already followed changes nothing and has no undo.",
  },
  'podcasts.unfollow': {
    app: 'podcasts',
    class: 'reversible',
    permit: 'podcasts',
    // It takes away a show the owner chose: the mind always says it did, even under quiet.
    tell_min: true,
    side: 'phone',
    intent: true,
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({ show_id: showId }),
        result: z.object({}),
      },
    },
    what: 'unfollow a show',
    doc: 'Unfollows a show by its id (16 hex digits, the night\'s name for it) in Podcasts, when it next opens (an intent). Never below `tell`: it takes away something the owner chose. Its undo follows it again.',
  },
  'podcasts.queue_episode': {
    app: 'podcasts',
    class: 'reversible',
    permit: 'podcasts',
    side: 'phone',
    intent: true,
    queueable: true,
    undo: 'reported',
    versions: {
      1: {
        args: z.object({ show_id: showId, episode_id: z.optional(episodeId) }),
        result: z.object({ key: z.string() }),
      },
    },
    what: "add a followed show's episode to Up Next",
    doc: "Adds an episode of a followed show (by the show's id; without `episode_id`, its newest) to the end of Podcasts' Up Next, when Podcasts next opens (an intent). Its undo takes it out again.",
  },
  'podcasts.unqueue_episode': {
    app: 'podcasts',
    class: 'reversible',
    permit: 'podcasts',
    side: 'phone',
    intent: true,
    queueable: false,
    undo: 'none',
    versions: {
      1: {
        args: z.object({ key: episodeKey }),
        result: z.object({}),
      },
    },
    what: 'take an episode out of Up Next (undo only)',
    doc: "Only the undo of podcasts.queue_episode: takes that episode out of Up Next.",
  },
  'podcasts.mark_played': {
    app: 'podcasts',
    class: 'reversible',
    permit: 'podcasts',
    side: 'worker',
    queueable: true,
    undo: 'stored',
    versions: {
      1: {
        args: z.object({ key: episodeKey }),
        result: z.object({ played: z.boolean() }),
      },
    },
    what: 'mark an episode played',
    doc: "Marks an episode (`<feed address>#<episode id>`, as GET /v1/podcasts/progress names it) played in the Worker's positions, which every phone takes when Podcasts opens (the newer wins). Its undo puts back where it was left.",
  },
} as const satisfies Record<string, VerbSpec>;
