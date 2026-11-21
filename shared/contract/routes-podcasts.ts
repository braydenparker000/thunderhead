// Podcasts' sync routes (podcasts.ts, API.md §11.25), kept beside routes.ts, which spreads them into
// ROUTES: no import here, so the registry stays importable on its own. Positions and follows (the
// night: counts mode, no titles, its checks), then Up Next and the playback speed (the device only).
export const PODCAST_SYNC_ROUTES = {
  'PUT /v1/podcasts/progress': { who: ['D'], phase: 'P8', note: '1–100 positions; the newer updated_at wins' },
  'GET /v1/podcasts/progress': { who: ['D', 'N'], phase: 'P8', note: '?since=&cursor=: what changed since, oldest first' },
  'PUT /v1/podcasts/follows': { who: ['D'], phase: 'P8', note: '1–100 shows followed or unfollowed; the newer wins' },
  'GET /v1/podcasts/follows': { who: ['D', 'N'], phase: 'P8', note: "?since=&cursor=; night: no titles, its last check" },
  'POST /v1/podcasts/follows/checked': { who: ['N'], phase: 'P8', note: 'the shows the night read: ≤ 20, their newest episode' },
  'PUT /v1/podcasts/queue': { who: ['D'], phase: 'P8', note: '1–100 Up Next items of one version or more; the newer wins' },
  'GET /v1/podcasts/queue': { who: ['D'], phase: 'P8', note: '?since=&cursor=: Up Next rows changed since, oldest first' },
  'PUT /v1/podcasts/prefs': { who: ['D'], phase: 'P8', note: 'the playback speed; the newer wins' },
  'GET /v1/podcasts/prefs': { who: ['D'], phase: 'P8', note: '?since=: the speed if it changed since' },
} as const;
