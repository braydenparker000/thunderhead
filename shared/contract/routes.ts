// API.md §13 as data, one route per row: the single source for the Worker's route guards
// (backend/src/http/auth.ts `guard`), the public-route list, the route-scope test, `th help`
// and the generated appendix docs/engineering/CONTRACT.md. A route is added here first; the
// scope test fails until the Worker registers exactly the built rows with exactly these
// principals. Plain data with erasable types only, so Node can import it without a build.

/** D device · C mind:chat · N mind:night · R mind:reflex · M muse · I ci (API.md §13). */
export type Who = 'D' | 'C' | 'N' | 'R' | 'M' | 'I';
export type Phase = 'P1' | 'P1b' | 'P2' | 'P3' | 'P4' | 'P5' | 'P8';

export interface RouteSpec {
  /** Who may call it; 'P' = public (no token). */
  who: readonly Who[] | 'P';
  phase: Phase;
  /** How the caller proves itself, when it is not the bearer token: `ticket` = a live ticket. */
  auth?: 'ticket';
  /** Built in a later step of its phase; the text says what it waits on. */
  deferred?: string;
  note?: string;
}

const D: Who[] = ['D'];
const AGENTS_READ: Who[] = ['D', 'C', 'N', 'R'];
const MIND: Who[] = ['C', 'N', 'R'];

export const ROUTES = {
  // --- P1: health, sign-in, devices, agents, settings, ops -------------------------------------
  'GET /v1/health': { who: 'P', phase: 'P1' },
  'GET /v1/auth/state': { who: 'P', phase: 'P1' },
  'POST /v1/auth/setup': { who: 'P', phase: 'P1' },
  'POST /v1/auth/login': { who: 'P', phase: 'P1' },
  'POST /v1/auth/recover': { who: 'P', phase: 'P1' },
  'GET /v1/ops/health/deep': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P1' },
  'POST /v1/auth/signout': { who: D, phase: 'P1' },
  'POST /v1/auth/password': { who: D, phase: 'P1' },
  'POST /v1/auth/recovery-code': { who: D, phase: 'P1' },
  'POST /v1/auth/recovery-code/confirm': { who: D, phase: 'P1' },
  'POST /v1/auth/breakglass/cancel': { who: D, phase: 'P1' },
  'POST /v1/auth/notices/:id/ack': { who: D, phase: 'P1' },
  'GET /v1/auth/sessions': { who: D, phase: 'P1' },
  'PATCH /v1/auth/sessions/:id': { who: D, phase: 'P1' },
  'DELETE /v1/auth/sessions/:id': { who: D, phase: 'P1' },
  'GET /v1/auth/agents': { who: D, phase: 'P1' },
  'POST /v1/auth/agents': { who: D, phase: 'P1' },
  'DELETE /v1/auth/agents/:id': { who: D, phase: 'P1' },
  'GET /v1/auth/me': { who: ['D', 'C', 'N', 'R', 'M', 'I'], phase: 'P1' },
  'POST /v1/auth/breakglass': { who: ['C'], phase: 'P1' },
  'GET /v1/settings': { who: AGENTS_READ, phase: 'P1' },
  'PATCH /v1/settings': { who: D, phase: 'P1' },
  'POST /v1/ops/errors': { who: AGENTS_READ, phase: 'P1' },
  'GET /v1/ops/errors': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P1' },
  'GET /v1/ops/meter': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P1' },
  'POST /v1/ops/errors/:fp/resolve': { who: ['D', 'C', 'R'], phase: 'P1' },
  'POST /v1/ops/perf': { who: D, phase: 'P1' },
  'POST /v1/import/phone': { who: D, phase: 'P1b', deferred: 'the private bucket (SETUP.md J2)' },

  // --- P2: the daily conversation ---------------------------------------------------------------
  'POST /v1/live/ticket': { who: D, phase: 'P2' },
  'GET /v1/live': { who: D, phase: 'P2', auth: 'ticket', note: 'WebSocket; the ticket comes from POST /v1/live/ticket' },
  'GET /v1/live/wait': { who: MIND, phase: 'P2' },
  'GET /v1/changes': { who: AGENTS_READ, phase: 'P2' },
  'GET /v1/threads': { who: AGENTS_READ, phase: 'P2' },
  'GET /v1/threads/today': { who: AGENTS_READ, phase: 'P2' },
  'GET /v1/threads/:id': { who: AGENTS_READ, phase: 'P2' },
  'GET /v1/threads/:id/messages': { who: AGENTS_READ, phase: 'P2' },
  'PATCH /v1/threads/:id': { who: ['C', 'N'], phase: 'P2' },
  'POST /v1/threads/:id/continue': { who: D, phase: 'P2' },
  'PUT /v1/messages/:id': { who: AGENTS_READ, phase: 'P2', note: "N and R: kind 'error' with thread_id 'system' only" },
  'PATCH /v1/messages/:id': { who: ['C'], phase: 'P2', note: 'own posts only' },
  'PUT /v1/files/:id': { who: ['D', 'C'], phase: 'P2', deferred: 'the private bucket (SETUP.md J2)' },
  'GET /v1/search': { who: ['D', 'C', 'N'], phase: 'P2' },
  'POST /v1/mind/typing': { who: D, phase: 'P2' },
  'POST /v1/mind/stop': { who: D, phase: 'P2', note: 'the owner taps Stop: the work ends, not the session' },
  'GET /v1/mind/wakes': { who: AGENTS_READ, phase: 'P2' },
  'POST /v1/mind/brief': { who: MIND, phase: 'P2' },
  'POST /v1/mind/status': { who: MIND, phase: 'P2' },
  'POST /v1/mind/notes': { who: MIND, phase: 'P2' },
  'POST /v1/mind/taint': { who: MIND, phase: 'P2' },
  'GET /v1/mind/pending': { who: MIND, phase: 'P2' },
  'GET /v1/ledger': { who: AGENTS_READ, phase: 'P2' },
  'PUT /v1/ledger/:id': { who: MIND, phase: 'P2' },
  'POST /v1/ledger/:id/undo': { who: ['D', 'C'], phase: 'P2', note: 'mind:chat: its own actions only' },
  'PUT /v1/verbs/:id': { who: ['C', 'N'], phase: 'P2' },
  'GET /v1/verbs/pending': { who: D, phase: 'P2' },
  'POST /v1/verbs/:id/claim': { who: D, phase: 'P2' },
  'POST /v1/verbs/:id/result': { who: D, phase: 'P2' },
  'GET /v1/surfaces': { who: AGENTS_READ, phase: 'P2' },
  'PUT /v1/surfaces/:app/:slot': { who: ['C', 'N'], phase: 'P2' },
  'DELETE /v1/surfaces/:app/:slot': { who: ['D', 'C', 'N'], phase: 'P2' },
  'POST /v1/media/sign': { who: ['D', 'C', 'N'], phase: 'P2', deferred: 'the private bucket (SETUP.md J2)' },

  // --- P3: memory and the night shift -----------------------------------------------------------
  'POST /v1/mind/night': { who: ['N'], phase: 'P3', deferred: 'P3 stage C (the night shift)' },
  'GET /v1/mind/day/:day': { who: ['N'], phase: 'P3', deferred: 'P3 stage C (the night shift)' },
  'GET /v1/memory/facts': { who: AGENTS_READ, phase: 'P3' },
  'GET /v1/memory/profile': { who: AGENTS_READ, phase: 'P3' },
  'GET /v1/memory/day-notes': { who: AGENTS_READ, phase: 'P3' },
  'GET /v1/memory/open-threads': { who: AGENTS_READ, phase: 'P3' },
  'POST /v1/memory/ops': { who: ['D', 'C', 'N'], phase: 'P3', note: 'pin, may_raise and forget: device only' },
  'PUT /v1/memory/day-notes/:day': { who: ['D', 'N'], phase: 'P3', note: "device: the owner's edit (written_by owner)" },
  'PUT /v1/memory/open-threads/:id': { who: ['D', 'C', 'N'], phase: 'P3' },
  'PATCH /v1/memory/open-threads/:id': { who: ['D', 'C', 'N'], phase: 'P3', note: '{status, why}: done or dropped' },
  'POST /v1/import/runs': { who: ['D', 'C'], phase: 'P3', deferred: 'P3 stage D (the import)' },
  'POST /v1/ops/import/parts': { who: ['C', 'I'], phase: 'P3', deferred: 'P3 stage D (the import)' },
  'PUT /v1/ops/import/manifest/:run_id': { who: ['C', 'I'], phase: 'P3', deferred: 'P3 stage D (the import)' },
  'GET /v1/import/runs/:id': { who: AGENTS_READ, phase: 'P3', deferred: 'P3 stage D (the import)' },

  // --- P4: proposals, backups, export, Muse -----------------------------------------------------
  'PUT /v1/proposals/:id': { who: MIND, phase: 'P4' },
  'GET /v1/proposals': { who: AGENTS_READ, phase: 'P4' },
  'POST /v1/proposals/:id/decide': { who: ['D', 'C'], phase: 'P4', note: 'mind:chat with by_message only' },
  'POST /v1/proposals/:id/cancel': { who: AGENTS_READ, phase: 'P4' },
  'POST /v1/ops/backups/run': { who: ['N', 'I'], phase: 'P4' },
  'POST /v1/ops/drill/run': { who: ['N', 'I'], phase: 'P4' },
  'GET /v1/ops/backups': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P4' },
  'POST /v1/ops/restore': { who: AGENTS_READ, phase: 'P4' },
  'POST /v1/export': { who: D, phase: 'P4' },
  'GET /v1/export/:id': { who: D, phase: 'P4' },
  'PUT /v1/work/orders/:id': { who: ['C', 'N'], phase: 'P4' },
  'POST /v1/work/orders/:id/cancel': { who: ['D', 'C', 'N'], phase: 'P4' },
  'GET /v1/work/orders': { who: AGENTS_READ, phase: 'P4' },
  'GET /v1/work/orders/:id': { who: AGENTS_READ, phase: 'P4' },
  'GET /v1/work/hello': { who: ['M'], phase: 'P4' },
  'POST /v1/work/claim': { who: ['M'], phase: 'P4' },

  // --- P5 and later ---------------------------------------------------------------------------
  'PUT /v1/senses/batches/:id': { who: D, phase: 'P5' },
  'POST /v1/senses/query': { who: MIND, phase: 'P5' },
  'GET /v1/jobs/next': { who: ['N', 'I'], phase: 'P5' },
  'POST /v1/jobs/:id/collect': { who: ['N', 'I'], phase: 'P5' },
  'GET /v1/jobs/:id': { who: ['C', 'N', 'R', 'I'], phase: 'P5' },
  'GET /v1/jobs/:id/spec': { who: ['I'], phase: 'P5' },
  'PUT /v1/pushes/:id': { who: ['C'], phase: 'P8' },
} as const satisfies Record<string, RouteSpec>;

export type RouteKey = keyof typeof ROUTES;

/** The phases whose routes are live in this build (the scope test registers exactly these). */
export const BUILT_PHASES: readonly Phase[] = ['P1', 'P1b', 'P2', 'P3'];

/** The rows this build must register: built phases, minus deferred rows. */
export function builtRoutes(): [RouteKey, RouteSpec][] {
  return (Object.entries(ROUTES) as [RouteKey, RouteSpec][]).filter(
    ([, r]) => BUILT_PHASES.includes(r.phase) && !r.deferred,
  );
}
