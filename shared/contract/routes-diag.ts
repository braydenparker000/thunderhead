// The lead's diagnostics route (diag.ts, API.md §11.16), kept beside routes.ts, which spreads it into
// ROUTES: no import here, so the registry stays importable on its own.
export const DIAG_ROUTES = {
  'GET /v1/ops/diag': { who: ['D', 'I'], phase: 'P9', note: 'jobs, the bulk lane, quota, meter, the music knowledge job and the version: counts, states, times, codes and host names, never content' },
} as const;
