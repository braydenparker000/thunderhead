// API.md §13 as data, one route per row: the single source for the Worker's route guards
// (backend/src/http/auth.ts `guard`), the public-route list, the route-scope test, `th help`
// and the generated appendix docs/engineering/CONTRACT.md. A route is added here first; the
// scope test fails until the Worker registers exactly the built rows with exactly these
// principals. Plain data with erasable types only, so Node can import it without a build.

/** D device · C mind:chat · N mind:night · R mind:reflex · M muse · I ci (API.md §13). */
export type Who = 'D' | 'C' | 'N' | 'R' | 'M' | 'I';
export type Phase = 'P1' | 'P1b' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9';

export interface RouteSpec {
  /** Who may call it; 'P' = public (no token). */
  who: readonly Who[] | 'P';
  phase: Phase;
  /** How the caller proves itself, when it is not the bearer token: `ticket` = a live ticket. */
  auth?: 'ticket';
  /** An agent of a listed role must be the one key with exactly this name (a device is not
   * affected): the one-time import's `import-once`, so no routine's key can write old rows. */
  key?: string;
  /** Built in a later step of its phase; the text says what it waits on. */
  deferred?: string;
  note?: string;
}

const D: Who[] = ['D'];
/** The one key that may write the import (SETUP.md L2): a Mind · chat key with this name. */
export const IMPORT_KEY = 'import-once';
const AGENTS_READ: Who[] = ['D', 'C', 'N', 'R'];
const MIND: Who[] = ['C', 'N', 'R'];
/** Memory is read by the owner, chat and night only: reflex handles breakage and reads no
 * memory (RUNTIME.md §7.1, least privilege; decisions.md 2026-10-29). */
const MEMORY_READ: Who[] = ['D', 'C', 'N'];

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
  'POST /v1/media/sign': {
    who: ['D', 'C', 'N'],
    phase: 'P2',
    note: 'music: refs (device only, P5), book: refs (P7); file: refs are not signable yet; 503 not_configured until the signing key is set',
  },

  // --- P3: memory and the night shift -----------------------------------------------------------
  'POST /v1/mind/night': { who: ['N'], phase: 'P3', note: 'the night run: start, step done, cursor, done' },
  'GET /v1/mind/day/:day': { who: ['N'], phase: 'P3', note: "a closed day's stats, messages, ledger and notes" },
  'GET /v1/memory/facts': { who: MEMORY_READ, phase: 'P3' },
  'GET /v1/memory/facts/:id': { who: MEMORY_READ, phase: 'P3', note: 'one fact: its earlier versions, evidence and why' },
  'GET /v1/memory/profile': { who: MEMORY_READ, phase: 'P3' },
  'GET /v1/memory/day-notes': { who: MEMORY_READ, phase: 'P3' },
  'GET /v1/memory/open-threads': { who: MEMORY_READ, phase: 'P3' },
  'POST /v1/memory/ops': { who: ['D', 'C', 'N'], phase: 'P3', note: 'pin, may_raise and forget: device only' },
  'PUT /v1/memory/day-notes/:day': { who: ['D', 'N'], phase: 'P3', note: "device: the owner's edit (written_by owner)" },
  'PUT /v1/memory/open-threads/:id': { who: ['D', 'C', 'N'], phase: 'P3' },
  'PATCH /v1/memory/open-threads/:id': { who: ['D', 'C', 'N'], phase: 'P3', note: '{status, why}: done or dropped' },
  'POST /v1/import/runs': {
    who: ['D', 'C'],
    phase: 'P3',
    key: IMPORT_KEY,
    note: 'one dataset of an export run (the owner, or the import-once key); 503 not_configured without VAULT',
  },
  'POST /v1/ops/import/parts': {
    who: ['C'],
    phase: 'P3',
    key: IMPORT_KEY,
    note: 'one gzip JSONL part of the old export, stored as sent; never-exported tables 403',
  },
  'PUT /v1/ops/import/manifest/:run_id': {
    who: ['C'],
    phase: 'P3',
    key: IMPORT_KEY,
    note: "the export run's manifest, written last, after every part it names",
  },
  'GET /v1/import/runs/:id': { who: AGENTS_READ, phase: 'P3', note: 'state, counts and the verification report' },

  // --- P4: proposals, backups, export, Muse -----------------------------------------------------
  // Built stage by stage: a row of a later stage says which one it waits for.
  'PUT /v1/proposals/:id': { who: MIND, phase: 'P4', note: 'an agent raises a decision card (from a claimed, untainted session)' },
  'GET /v1/proposals': { who: AGENTS_READ, phase: 'P4' },
  'POST /v1/proposals/:id/decide': {
    who: ['D', 'C'],
    phase: 'P4',
    note: "device: a tap; mind:chat: the owner's own words (by_message) only",
  },
  'POST /v1/proposals/:id/cancel': { who: AGENTS_READ, phase: 'P4', note: 'the agent that raised it, or the owner' },
  'POST /v1/evals/sandbox': { who: ['C', 'N'], phase: 'P4', note: 'with TH-Sandbox: eval only: reset the eval sandbox to a synthetic seed' },
  'GET /v1/evals/sandbox': { who: ['C', 'N'], phase: 'P4', note: 'with TH-Sandbox: eval only: what was written or tried since the reset' },
  'PUT /v1/evals/runs/:id': { who: ['C', 'N'], phase: 'P4', note: 'one finished suite, numbers and ids only (never in the sandbox)' },
  'GET /v1/evals/runs': { who: ['D', 'C', 'N'], phase: 'P4' },
  'GET /v1/ops/watchdogs': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P4', note: 'every watchdog, its state and the SLO it guards' },
  'POST /v1/ops/watchdogs/:name/handled': {
    who: ['C', 'N', 'R'],
    phase: 'P4',
    note: 'what a mind session did about a trip (the reflex reports each one)',
  },
  'POST /v1/ops/watchdogs/:name/drill': {
    who: ['D', 'C'],
    phase: 'P4',
    note: 'trip one watchdog by hand when the owner asks, to check that mind-reflex handles it (nothing is wrong)',
  },
  'POST /v1/ops/backups/run': { who: ['N', 'I'], phase: 'P4', note: 'start the weekly backup now (the one running is answered again)' },
  'POST /v1/ops/drill/run': { who: ['N', 'I'], phase: 'P4', note: 'the restore drill of the newest complete backup, now' },
  'GET /v1/ops/backups': { who: ['D', 'C', 'N', 'R', 'I'], phase: 'P4', note: 'counts only' },
  'POST /v1/ops/restore': { who: AGENTS_READ, phase: 'P4', deferred: 'restores as proposals (OPERATIONS.md §4), after the drill has passed live' },
  'POST /v1/export': { who: D, phase: 'P4', note: 'with the password again' },
  'GET /v1/export/:id': { who: D, phase: 'P4', note: 'only the device that asked' },
  'GET /v1/export/:id/zip': { who: D, phase: 'P4', note: 'the ZIP, streamed, for an hour, to the device that asked' },
  'PUT /v1/work/orders/:id': { who: ['C', 'N'], phase: 'P4', note: 'a work order for Muse; its result schema is the kind\'s' },
  'POST /v1/work/orders/:id/cancel': { who: ['D', 'C', 'N'], phase: 'P4' },
  'GET /v1/work/orders': { who: ['D', 'C', 'N', 'R'], phase: 'P4' },
  'GET /v1/work/orders/:id': { who: ['D', 'C', 'N', 'R'], phase: 'P4' },
  'GET /v1/work/hello': { who: ['M'], phase: 'P4' },
  'POST /v1/work/claim': { who: ['M'], phase: 'P4', note: 'the order Muse holds, else the oldest queued one; 204 when none' },
  'POST /v1/work/orders/:id/heartbeat': { who: ['M'], phase: 'P4', note: 'a 30-minute lease from now' },
  'PUT /v1/work/orders/:id/result': { who: ['M'], phase: 'P4', note: 'checked against the kind\'s schema; 422 names each problem' },
  'POST /v1/work/orders/:id/fail': { who: ['M'], phase: 'P4' },
  'POST /v1/work/orders/:id/files': { who: ['M'], phase: 'P4', deferred: 'an order kind with files (music.ingest, P5)' },
  'GET /v1/work/board/brief': { who: ['M'], phase: 'P4', note: 'only with the owner\'s standing approval' },
  'GET /v1/work/thread': { who: ['M', 'D', 'C', 'N'], phase: 'P4', note: 'Muse\'s own thread, never the owner\'s conversation' },
  'POST /v1/work/thread/messages': { who: ['M', 'D', 'C', 'N'], phase: 'P4' },
  'GET /v1/board/brief': { who: ['D', 'C', 'N'], phase: 'P4' },
  'PUT /v1/board/brief': { who: ['D', 'C', 'N'], phase: 'P4', note: 'the owner\'s Board choices; the mind writes it from the owner\'s words' },
  'DELETE /v1/board/approval': { who: D, phase: 'P4', note: 'withdraws Muse\'s reading of the brief' },
  'GET /v1/briefing': { who: D, phase: 'P4' },
  'GET /v1/board/editions/:day': { who: ['D', 'C', 'N'], phase: 'P4', note: 'outside text from Muse, checked against the v2 schema' },

  // --- P5 and later ---------------------------------------------------------------------------
  'GET /v1/music/catalog': { who: D, phase: 'P5', note: "the ported player's format; ETag, 304; 409 before the import" },
  'GET /v1/music/waveforms/:id': { who: D, phase: 'P5' },
  'GET /v1/music/tracks': { who: ['C', 'N'], phase: 'P5', note: '?q=&limit=: tracks by their tags, for a playlist the mind makes' },
  // The upload tools, server to server: no bearer token, each request signed (Ed25519) by a tool's key.
  'PUT /v1/music/uploads/audio/:file': { who: 'P', phase: 'P5', note: 'signed by an upload tool key; Ogg Opus, ≤ 32 MiB' },
  'PUT /v1/music/uploads/art/:file': { who: 'P', phase: 'P5', note: 'signed by an upload tool key; JPEG or PNG, ≤ 2 MiB' },
  'POST /v1/music/uploads/:op': {
    who: 'P',
    phase: 'P5',
    note: "signed by an upload tool key; the catalog writer's operations, export and links",
  },
  'PUT /v1/senses/batches/:id': { who: D, phase: 'P5', note: 'a sealed batch of 1–500 events, ≤ 256 KB' },
  'POST /v1/senses/query': { who: MIND, phase: 'P5', note: 'a fixed, named query; never SQL' },
  'GET /v1/jobs/next': { who: ['N', 'I'], phase: 'P5', deferred: 'P5: the indexing jobs' },
  'POST /v1/jobs/:id/collect': { who: ['N', 'I'], phase: 'P5', deferred: 'P5: the indexing jobs' },
  'GET /v1/jobs/:id': { who: ['C', 'N', 'R', 'I'], phase: 'P5', deferred: 'P5: the indexing jobs' },
  'GET /v1/jobs/:id/spec': { who: ['I'], phase: 'P5', deferred: 'P5: the indexing jobs' },
  // P6: Guitar's tab sources, as the old Worker served them, for the owner's device only.
  'GET /v1/guitar/search': { who: D, phase: 'P6', note: 'Songsterr search, ?q=' },
  'GET /v1/guitar/songs/:id': { who: D, phase: 'P6' },
  'GET /v1/guitar/songs/:id/score': { who: D, phase: 'P6', note: '?revision=&parts=' },
  'GET /v1/guitar/gprotab/search': { who: D, phase: 'P6', note: '?q=' },
  'GET /v1/guitar/gprotab/file': { who: D, phase: 'P6', note: '?path=; a Guitar Pro file, bytes' },
  'GET /v1/guitar/sounds/:instrument/:file': { who: D, phase: 'P6', note: 'a guitar sample, audio/mpeg' },
  // P7: Study's library (STUDY.md): the owner's books and reading, and the mind's ingestion runs.
  'GET /v1/library/books': { who: ['D', 'C', 'N'], phase: 'P7', note: 'every book, its place, how far it is read' },
  'POST /v1/library/books': { who: D, phase: 'P7', note: "a book under the client's id: its record and upload" },
  'GET /v1/library/books/:id': { who: ['D', 'C', 'N'], phase: 'P7' },
  'PATCH /v1/library/books/:id': { who: D, phase: 'P7', note: 'title, author, kind, language' },
  'PUT /v1/library/books/:id/parts/:n': { who: D, phase: 'P7', note: 'one part, bytes: 50 MiB but the last' },
  'POST /v1/library/books/:id/complete': { who: D, phase: 'P7', note: 'all parts in: the book waits for the mind' },
  'POST /v1/library/books/:id/retry': { who: D, phase: 'P7', note: 'a book that could not be read, again' },
  'PUT /v1/library/positions/:book_id': { who: D, phase: 'P7', note: 'the newest place wins' },
  'GET /v1/library/highlights': { who: D, phase: 'P7', note: '?book_id=' },
  'PUT /v1/library/highlights/:id': { who: D, phase: 'P7', note: 'the newest version wins' },
  'GET /v1/library/search': { who: ['D', 'C', 'N'], phase: 'P7', note: '?q=&book_id=&limit=&cursor=; ready books' },
  'GET /v1/library/books/:id/file': { who: D, phase: 'P7', note: 'the whole PDF, once its upload is whole; the phone keeps it' },
  'GET /v1/library/books/:id/pages': { who: ['C', 'N'], phase: 'P7', note: "?from=&limit=: a book's stored page text, for the mind" },
  'POST /v1/library/ingest/claim': { who: ['C', 'N'], phase: 'P7', note: 'the oldest waiting book, an hour; 204 if none' },
  'GET /v1/library/ingest/:job_id/file': { who: ['C', 'N'], phase: 'P7', note: "the claimed book's PDF, its holder only" },
  'PUT /v1/library/books/:id/pages': { who: ['C', 'N'], phase: 'P7', note: '1–50 pages of a held run; bulk lane' },
  'PATCH /v1/library/ingest/:job_id': { who: ['C', 'N'], phase: 'P7', note: 'the run: a state, then ready or failed' },
  'GET /v1/library/scripture': { who: ['D', 'C', 'N'], phase: 'P7', note: "the owner's private book table; ETag" },
  'PUT /v1/library/scripture': { who: ['C', 'N'], phase: 'P7', note: 'the table, checked by the parser' },
  'GET /v1/library/scripture/text/:code/:chapter': { who: ['D', 'C', 'N'], phase: 'P7', note: "a chapter of the owner's copy" },
  'PUT /v1/library/scripture/text/:code': { who: ['C', 'N'], phase: 'P7', note: "one book's text, checked by the table" },
  'GET /v1/library/cite': { who: ['C', 'N'], phase: 'P7', note: '?q=: the blocks a cited answer may use, at most 20' },
  'GET /v1/library/verses/:code/:chapter': { who: ['D', 'C', 'N'], phase: 'P7', note: '?v=12[-14]&all=1: cited in your books' },
  'PUT /v1/pushes/:id': { who: ['C'], phase: 'P8' },
} as const satisfies Record<string, RouteSpec>;

export type RouteKey = keyof typeof ROUTES;

/** The phases whose routes are live in this build (the scope test registers exactly these). */
export const BUILT_PHASES: readonly Phase[] = ['P1', 'P1b', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];

/** The rows this build must register: built phases, minus deferred rows. */
export function builtRoutes(): [RouteKey, RouteSpec][] {
  return (Object.entries(ROUTES) as [RouteKey, RouteSpec][]).filter(
    ([, r]) => BUILT_PHASES.includes(r.phase) && !r.deferred,
  );
}
