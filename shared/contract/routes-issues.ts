// The list for the builder's routes (issues.ts), kept beside routes.ts, which spreads them into
// ROUTES: no import here, so the registry stays importable on its own.
export const ISSUE_ROUTES = {
  'GET /v1/issues': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P9', note: '?state=open|done|all (default open): newest first with their notes, ≤ 200; ci: a building session reads the list' },
  'GET /v1/issues/:id': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P9', note: 'one item with its notes' },
  'PUT /v1/issues/:id': { who: ['D', 'C'], phase: 'P9', note: "{title ≤ 120, what ≤ 1,000, where?, kind?, from_message_id?}: mind:chat names the owner-device message of the last 48 h it came from, from a clean claimed session" },
  'PATCH /v1/issues/:id': { who: ['D'], phase: 'P9', note: '{title?, what?, where?, kind?, state?: open|done}: edit, mark done, reopen' },
  'POST /v1/issues/:id/notes': { who: ['D', 'C'], phase: 'P9', note: '{text ≤ 1,000}: a note added (never changed or removed), at most 50 an item' },
} as const;
