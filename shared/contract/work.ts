// Work orders for Muse (docs/engineering/MUSE-PROTOCOL.md; history in docs/archive/MUSE.md): two
// kinds, one result schema (a JSON Schema subset the Worker's own validator reads,
// backend/src/areas/work/validate.ts), the limits, the states the owner sees in the menu's Tasks and
// the wire types. Plain data, Node-importable; CONTRACT.md lists it. The Board-era kinds
// (`research.brief`, `media.check`) were removed on 2026-11-02: a row of one reads as `legacy`.
import { APP_IDS, type AppId, appBuilt } from './feed.ts';

export const WORK_LIMITS = {
  title: 80,
  /** The owner's words in a `muse.request` (what Muse is asked), and how many of them make its title. */
  words: 500,
  title_words: 60,
  spec_bytes: 16_384,
  schema_bytes: 8_192,
  result_bytes: 262_144,
  heartbeat_note: 120,
  fail_reason: 280,
  note_body: 2_000,
  /** A claim lasts this long; each heartbeat or progress line extends it to this long from then. */
  lease_min: 30,
  attempts: 3,
  /** Results Muse may send for one claim: each one that fails its checks is named (422) and the
   * order stays Muse's; the third is the last, and the order is rejected. */
  results: 3,
  /** The longest an order may wait for Muse; the owner's own (`@muse`) get all of it. */
  deadline_days: 7,
  /** Muse's uploads close as one task this long after the last one. */
  batch_gap_min: 30,
  /** The Briefing's "Muse hasn't checked in" line, after this long without a call (the
   * `muse.silent` watchdog this once fed was removed on 2026-11-02). */
  silent_h: 26,
  /** Muse's own thread: notes kept. */
  notes_kept: 500,
  /** The menu's Tasks: the newest orders it lists. */
  tasks: 20,
} as const;

/** A JSON Schema subset (validate.ts). */
export interface Schema {
  type?: SchemaType | SchemaType[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  items?: Schema;
  enum?: (string | number | boolean | null)[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: 'uri';
}
export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

const str = (maxLength: number, minLength = 0): Schema => ({ type: 'string', minLength, maxLength });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const arr = (items: Schema, minItems: number, maxItems: number): Schema => ({ type: 'array', items, minItems, maxItems });
const count: Schema = { type: 'integer', minimum: 0, maximum: 1_000_000 };

/** The apps a result may open: those a reply chip may (feed.ts `appBuilt`). */
export const WORK_APPS = APP_IDS.filter((a) => appBuilt(a));

/** What Muse returns for any order: what it added, by count; the ids it added (songs, episodes,
 * files), at most 50; a note of at most 200 characters; and where the owner may look at it. The
 * Worker also checks that `open.path` stays inside that app (ops.ts). */
export const MUSE_RESULT: Schema = obj(
  {
    added: obj({ songs: count, artists: count, episodes: count, files: count }),
    ids: arr(str(200, 1), 0, 50),
    note: str(200),
    open: obj({ app: { enum: WORK_APPS }, path: { type: 'string', minLength: 1, maxLength: 300, pattern: '^/' } }, [
      'app',
      'path',
    ]),
  },
  ['added', 'ids', 'note'],
);
export interface MuseResult {
  added: { songs?: number; artists?: number; episodes?: number; files?: number };
  ids: string[];
  note: string;
  open?: { app: AppId; path: string };
}

/** The kinds. `muse.request` is asked for (the owner's `@muse`, or the mind's `th order new`) and
 * claimed by Muse; `muse.upload_batch` is the Worker's own record of Muse's signed uploads, one per
 * sitting, so they show as tasks too: never queued, never claimed. */
export const WORK_KINDS = {
  'muse.request': {
    assignee: 'muse',
    personal: false,
    asked: true,
    schema: MUSE_RESULT,
    doc: "Anything the owner hands Muse in words (`spec.words`, ≤ 500 characters; `spec.app` a hint where it belongs): a catalog, a tab, subtitles, a PDF into Study. The result is counts, ids and a note; the Thunderhead turns it into a line with an Open chip.",
  },
  'muse.upload_batch': {
    assignee: 'muse',
    personal: false,
    asked: false,
    schema: MUSE_RESULT,
    doc: 'Songs Muse registered through its signed upload route (`/v1/music/uploads/*`), gathered into one task until 30 minutes pass without one.',
  },
} as const satisfies Record<string, { assignee: 'muse'; personal: boolean; asked: boolean; schema: Schema; doc: string }>;
export type WorkKind = keyof typeof WORK_KINDS;
export const WORK_KIND_NAMES = Object.keys(WORK_KINDS) as WorkKind[];
/** The kinds an order may be placed of (`PUT /v1/work/orders/:id`, `@muse`). */
export const ASKED_KINDS = WORK_KIND_NAMES.filter((k) => WORK_KINDS[k].asked);

export type WorkStatus = 'queued' | 'claimed' | 'done' | 'rejected' | 'failed' | 'expired' | 'cancelled';

/** What the owner sees of an order (the menu's Tasks, the lines in the chat): asked → picked up →
 * working → done, or failed (rejected, failed, expired) or cancelled. */
export const TASK_STATES = ['asked', 'picked_up', 'working', 'done', 'failed', 'cancelled'] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Where an `@muse`'s words belong, when they say (the spec's `app`): a hint for Muse and the done
 * line's Open chip when Muse names no place. The first that matches wins, so "a tab for that song"
 * is Guitar. */
const HINTS: [RegExp, AppId][] = [
  [/\b(?:podcasts?|episodes?)\b/i, 'podcasts'],
  [/\b(?:tabs?|chords?|guitar)\b/i, 'guitar'],
  [/\b(?:subtitles?|videos?|movies?|films?)\b/i, 'media'],
  [/\b(?:pdfs?|books?|study|chapters?)\b/i, 'study'],
  [/\b(?:songs?|albums?|artists?|catalog(?:ue)?s?|music|tracks?|playlists?|discograph(?:y|ies))\b/i, 'music'],
];
export const hintOf = (words: string): AppId | null => HINTS.find(([re]) => re.test(words))?.[1] ?? null;

/** Who an owner's message may be addressed to besides the mind (PutMessageRequest.mention): `muse`
 * ("@muse …" in the ask bar, th/commands) makes the words a `muse.request` under the owner's own
 * authority; the Worker answers the message with a system line naming it and wakes no mind, and the
 * stored message carries `meta.mention`. */
export type Mention = 'muse';

/** `meta.work` on a line the Worker posts about an order asked for with `@muse`: which order and
 * the state it reached. Muse's own line when it is done also carries `chip`. */
export interface WorkLineMeta {
  work: { id: string; state: TaskState };
}

/** `spec` of a `muse.request`: the words, and optionally the app it belongs in. */
export interface MuseRequestSpec {
  v: 1;
  words: string;
  app?: AppId;
}

/** PUT /v1/work/orders/:id (the mind). The result schema is the Worker's; `personal` orders need
 * an approved `reach_people` card (none are built). */
export interface WorkOrderPut {
  kind: 'muse.request';
  title: string;
  spec: MuseRequestSpec;
  deadline_at: number;
}

/** A work order as the mind, the owner and Muse see it (Muse sees only its own). */
export interface WorkOrder {
  id: string;
  /** `legacy`: a kind this build no longer has (the Board era's); never claimed again. */
  kind: WorkKind | 'legacy';
  assignee: 'muse';
  title: string;
  spec: Record<string, unknown>;
  schema: Schema;
  status: WorkStatus;
  /** What the owner sees (TASK_STATES). */
  state: TaskState;
  attempts: number;
  deadline_at: number;
  /** A mind session's id, `owner` (an `@muse`) or `muse` (an upload batch). */
  created_by: string;
  created_at: number;
  claimed_at: number | null;
  heartbeat_at: number | null;
  heartbeat_note: string | null;
  result: unknown | null;
  result_valid: boolean | null;
  result_errors: string[] | null;
  finished_at: number | null;
  /** The owner's message that asked for it (`@muse`), whose conversation hears how it goes. */
  message_id: string | null;
  /** Everything Muse returns is outside text. */
  origin: 'muse';
}

/** GET /v1/work/hello */
export interface WorkHello {
  agent: 'muse';
  scopes: string[];
  server_time: number;
}

/** A note in Muse's own thread; one that names an order is a progress line of it. */
export interface MuseNote {
  seq: number;
  id: string;
  author: 'muse' | 'mind' | 'owner';
  body: string;
  order_id: string | null;
  created_at: number;
}
