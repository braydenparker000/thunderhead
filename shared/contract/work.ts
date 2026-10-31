// Work orders for Muse (MUSE.md §3–§5): the kinds and their result schemas (a JSON Schema subset
// the Worker's own validator reads, backend/src/areas/work/validate.ts), the limits and the wire
// types. Plain data, Node-importable; CONTRACT.md lists it. The Daily Board's kind and brief were
// removed on 2026-10-31 (owner: no Muse Daily Board).

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
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const arr = (items: Schema, minItems: number, maxItems: number): Schema => ({ type: 'array', items, minItems, maxItems });
const url: Schema = { type: 'string', format: 'uri', maxLength: 500 };

export const WORK_KINDS = {
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
}

/** A note in Muse's own thread. */
export interface MuseNote {
  seq: number;
  id: string;
  author: 'muse' | 'mind' | 'owner';
  body: string;
  created_at: number;
}
