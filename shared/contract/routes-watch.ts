// The outside watcher's route (watch.ts, OPERATIONS.md §8.5), kept beside routes.ts, which spreads
// it into ROUTES: no import here, so the registry stays importable on its own.
export const WATCH_ROUTES = {
  'POST /v1/ops/site': { who: ['I'], phase: 'P9', note: '{state: down|up}: the live watch says the site is not loading, or is back; one push each way' },
} as const;
