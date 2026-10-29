// The change feed, the live channel and the other small vocabularies every client shares
// (DATA.md §4.1, API.md §11.5–11.6, §12). Forward compatibility is the rule: a client ignores a
// change kind, frame type or search source it does not know and resyncs from GET /v1/changes,
// so features add kinds, never sockets. Plain data, importable by Node without a build.

/** Every `changes.kind`. A feature adds its kind here (EXTENDING.md). */
export const CHANGE_KINDS = [
  'message',
  'thread',
  'ledger',
  'proposal',
  'verb',
  'surface',
  'notice',
  'fact',
  'day_note',
  'open_thread',
  'setting',
  'mind_status',
  'error',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** The live channel's protocol version, sent in `hello`. Frames only ever gain fields. */
export const LIVE_PROTOCOL = 1;

/** server → client frames (API.md §12). Unknown `t` values are ignored by every client. */
export const FRAME_TYPES = ['hello', 'changed', 'typing', 'bye'] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

/** WebSocket close codes the client acts on. */
export const CLOSE_CODES = { revoked: 4401, outdated: 4426, restart: 1012 } as const;

/** Apps a reply chip or `app.open` may open, with their route folder. */
export const APPS = {
  music: { path: '/music/', name: 'Music' },
  guitar: { path: '/guitar/', name: 'Guitar' },
  podcasts: { path: '/podcasts/', name: 'Podcasts' },
  astra: { path: '/astra/', name: 'Astra' },
  media: { path: '/media/', name: 'My Media' },
  study: { path: '/study/', name: 'Study' },
} as const;
export type AppId = keyof typeof APPS;
export const APP_IDS = Object.keys(APPS) as AppId[];

/** Federated search: every source `GET /v1/search?sources=` can name, and its phase. A source is
 * a store that answers the same query shape; facts, day notes, the library, senses and semantic
 * recall join here without a client change. */
export const SEARCH_SOURCES = {
  messages: { phase: 'P2', ref: 'msg' },
  facts: { phase: 'P3', ref: 'fact' },
  day_notes: { phase: 'P3', ref: 'day' },
  library: { phase: 'P7', ref: 'book' },
} as const;
export type SearchSource = keyof typeof SEARCH_SOURCES;

/** Message kinds; owners write `text` and `voice`, agents any of them. */
export const MESSAGE_KINDS = ['text', 'voice', 'progress', 'card', 'question', 'error'] as const;
