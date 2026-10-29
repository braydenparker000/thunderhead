// Work orders for Muse (MUSE.md §3–§5): the kinds and their result schemas (a JSON Schema subset
// the Worker's own validator reads, backend/src/areas/work/validate.ts), the limits, the Board
// brief's shape, and the wire types. Plain data, Node-importable; CONTRACT.md lists it.

export const WORK_LIMITS = {
  title: 80,
  spec_bytes: 16_384,
  schema_bytes: 8_192,
  result_bytes: 262_144,
  heartbeat_note: 120,
  fail_reason: 280,
  note_body: 2_000,
  /** A claim lasts this long; each heartbeat extends it to this long from then. */
  lease_min: 30,
  attempts: 3,
  /** The daily Board is due by this local time (BRIEFING.md §5). */
  board_due_local: '09:00',
  /** Muse is silent after this long without a call (the `muse.silent` watchdog). */
  silent_h: 26,
  /** Muse's own thread: notes kept. */
  notes_kept: 500,
} as const;

/** A JSON Schema subset (MUSE.md §5 step 4). */
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
const opt = (s: Schema): Schema => ({ ...s, type: [...(Array.isArray(s.type) ? s.type : [s.type ?? 'string']), 'null'] });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const arr = (items: Schema, minItems: number, maxItems: number): Schema => ({ type: 'array', items, minItems, maxItems });
const DAY = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
const url: Schema = { type: 'string', format: 'uri', maxLength: 500 };

const source = obj(
  {
    title: str(200, 1),
    url,
    publisher: str(120),
    type: { enum: ['primary', 'official', 'independent', 'analysis'] },
    publishedOn: opt({ type: 'string', pattern: DAY }),
    eventOn: opt({ type: 'string', pattern: DAY }),
    note: str(300),
  },
  ['title', 'url'],
);

/** Every block type's fields in one object (the subset has no oneOf): `type` says which apply,
 * and the reader draws only the fields its type uses. */
const block = obj(
  {
    id: str(64, 1),
    type: { enum: ['prose', 'stats', 'chart', 'comparison', 'timeline', 'perspectives', 'agenda', 'quote', 'callout', 'explanation'] },
    cites: arr({ type: 'integer', minimum: 0, maximum: 11 }, 0, 12),
    text: str(2_000),
    title: str(120),
    kind: { enum: ['line', 'column', 'bar', 'unknown', 'context', 'correction', 'watch'] },
    unit: str(24),
    labels: arr(str(40), 0, 60),
    series: arr(obj({ name: str(60), values: arr({ type: ['number', 'null'] }, 0, 60) }, ['values']), 0, 3),
    note: str(300),
    speaker: str(120),
    role: str(120),
    steps: arr(str(400, 1), 0, 8),
    tabs: arr(obj({ label: str(40, 1), text: str(900, 1) }, ['label', 'text']), 0, 4),
    items: arr(
      obj({
        label: str(80),
        value: str(16),
        change: str(32),
        direction: { enum: ['up', 'down', 'flat'] },
        tone: { enum: ['good', 'bad', 'neutral'] },
        asOf: str(32),
        note: str(200),
        text: str(900),
        date: str(32),
        state: { enum: ['past', 'now', 'next'] },
        at: str(40),
        place: str(120),
      }),
      0,
      60,
    ),
  },
  ['id', 'type'],
);

const story = obj(
  {
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
    title: str(160, 1),
    label: str(80),
    composition: { enum: ['lead', 'feature', 'data', 'brief', 'band'] },
    claim: { enum: ['fact', 'forecast', 'interpretation'] },
    dek: str(200, 1),
    whyItMatters: str(600),
    whatsNext: str(600),
    disagreement: obj({ label: str(80), text: str(600, 1) }, ['text']),
    sources: arr(source, 1, 12),
    blocks: arr(block, 0, 20),
  },
  ['id', 'title', 'composition', 'dek', 'sources'],
);

/** The Daily Board v2 edition (BRIEFING.md §5; the old repo's docs/daily-board-v2-format.md). */
export const BOARD_EDITION: Schema = obj(
  {
    schema: { enum: ['jarvis-daily-board-v2'] },
    id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
    date: { type: 'string', pattern: DAY },
    timezone: str(64),
    visibility: { enum: ['public', 'private'] },
    synthetic: { type: 'boolean' },
    title: str(120, 1),
    summary: str(1_000),
    edition: obj({ theme: { enum: ['ink', 'ember', 'tide', 'moss', 'dusk', 'gold'] }, thesis: str(200) }),
    stories: arr(story, 1, 12),
  },
  ['schema', 'date', 'title', 'stories'],
);

export const WORK_KINDS = {
  'board.edition': {
    assignee: 'muse',
    personal: false,
    schema: BOARD_EDITION,
    doc: "Write today's Board from the owner's Board brief (GET /v1/work/board/brief), in the v2 edition format.",
  },
  'research.brief': {
    assignee: 'muse',
    personal: false,
    schema: obj(
      {
        v: { enum: [1] },
        summary: str(1_200, 1),
        findings: arr(obj({ claim: str(280, 1), sources: arr(url, 1, 8) }, ['claim', 'sources']), 1, 12),
        unknowns: arr(str(280, 1), 0, 5),
      },
      ['v', 'summary', 'findings'],
    ),
    doc: 'Web research on a non-personal topic the mind names: primary sources first, at least 2 independent.',
  },
  'media.check': {
    assignee: 'muse',
    personal: false,
    schema: obj(
      {
        v: { enum: [1] },
        items: arr(obj({ url, ok: { type: 'boolean' }, status: { type: 'integer', minimum: 0, maximum: 999 }, note: str(120) }, ['url', 'ok']), 1, 100),
      },
      ['v', 'items'],
    ),
    doc: 'Check that public feed or page URLs still work, and report what changed.',
  },
} as const satisfies Record<string, { assignee: 'muse'; personal: boolean; schema: Schema; doc: string }>;
export type WorkKind = keyof typeof WORK_KINDS;
export const WORK_KIND_NAMES = Object.keys(WORK_KINDS) as WorkKind[];

export type WorkStatus = 'queued' | 'claimed' | 'done' | 'rejected' | 'failed' | 'expired' | 'cancelled';

/** PUT /v1/work/orders/:id (the mind). The kind's result schema is the Worker's; `personal`
 * orders need an approved `reach_people` proposal (none are built: P4 kinds are not personal). */
export interface WorkOrderPut {
  kind: WorkKind;
  title: string;
  spec: { v: 1; goal: string; inputs: Record<string, unknown>; constraints: string[]; done_when: string; sources_policy?: string };
  deadline_at: number;
}

/** A work order as the mind, the owner and Muse see it (Muse sees only its own). */
export interface WorkOrder {
  id: string;
  kind: WorkKind;
  assignee: 'muse';
  title: string;
  spec: Record<string, unknown>;
  schema: Schema;
  status: WorkStatus;
  attempts: number;
  deadline_at: number;
  created_by: string;
  created_at: number;
  claimed_at: number | null;
  heartbeat_at: number | null;
  heartbeat_note: string | null;
  result: unknown | null;
  result_valid: boolean | null;
  result_errors: string[] | null;
  finished_at: number | null;
  /** Everything Muse returns is outside text (MUSE.md rule 2). */
  origin: 'muse';
}

/** GET /v1/work/hello */
export interface WorkHello {
  agent: 'muse';
  scopes: string[];
  server_time: number;
  board_brief_allowed: boolean;
}

/** The owner's Board brief (the old relay's board profile, unchanged). */
export interface BoardBrief {
  focus: string;
  interests: { topic: string; priority: 'high' | 'normal' | 'low'; notes?: string }[];
  avoid?: string[];
  regions?: string[];
  depth: 'headlines' | 'standard' | 'deep';
  stories: { min: number; max: number };
  lookbackHours: number;
  sources?: { prefer?: string[]; avoid?: string[] };
  notes?: string;
}

/** A note in Muse's own thread. */
export interface MuseNote {
  seq: number;
  id: string;
  author: 'muse' | 'mind' | 'owner';
  body: string;
  created_at: number;
}
