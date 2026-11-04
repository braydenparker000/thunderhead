// The routines' routes (routines.ts, API.md §11.11 "Routines"), kept beside routes.ts, which spreads
// them into ROUTES: no import here, so the registry stays importable on its own.
export const ROUTINE_ROUTES = {
  'GET /v1/routines': { who: ['D', 'C', 'N'], phase: 'P2', note: 'the approved routines (at most 12), on and off, each with its condition in words and its last run' },
  'POST /v1/routines/:id/switch': { who: ['D', 'C', 'N'], phase: 'P2', note: '{on}: the owner switches one on or off; the mind only off (th routine cancel)' },
  'DELETE /v1/routines/:id': { who: ['D'], phase: 'P2', note: 'removes one that is off (409 while it is on)' },
} as const;
