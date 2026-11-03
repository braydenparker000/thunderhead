// Writes the three copies of the runtime contract from shared/contract (EXTENDING.md rule 1):
//   frontend/th/contract.js       the phone's vocabularies, verbs and surface kinds (JSDoc-typed
//                                 against shared/contract, so the type check catches drift)
//   mind/cli/contract.json        what `th` needs: routes, verbs and surfaces with JSON Schemas,
//                                 error codes, the phrase lint
//   docs/engineering/CONTRACT.md  the generated appendix to API.md
//   frontend/apps/settings/catalog-data.js  the settings catalogue the Settings pages render
//   node scripts/contract.mjs           rewrites them
//   node scripts/contract.mjs --check   exits 1 naming any that are stale (tests/contract-gen.test.mjs)
// Node strips the contract's types on import; nothing is built or bundled.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/mini';
import * as c from '../shared/contract/index.ts';
import { BANNED_PHRASES } from '../shared/contract/lint.ts';

const REPO = fileURLToPath(new URL('../', import.meta.url));
export const OUTPUTS = ['frontend/th/contract.js', 'mind/cli/contract.json', 'docs/engineering/CONTRACT.md', 'frontend/apps/settings/catalog-data.js'];

const schema = (s) => {
  const { $schema: _, ...rest } = z.toJSONSchema(s, { io: 'input' });
  return rest;
};
const versions = (o) => Object.keys(o).map(Number).sort((a, b) => a - b);
const routeStatus = (r) =>
  r.deferred ? `deferred: ${r.deferred}` : c.BUILT_PHASES.includes(r.phase) ? 'built' : `later (${r.phase})`;
const slots = (k) => Object.fromEntries(Object.entries(k.slots).map(([app, re]) => [app, re.source]));

/** The phone's copy: data only, no schemas (the Worker has validated whatever reaches a phone). */
function phone() {
  const verbs = Object.fromEntries(
    Object.entries(c.VERBS).map(([n, v]) => [
      n,
      { app: v.app, side: v.side, ...(v.intent ? { intent: true } : {}), queueable: v.queueable, undo: v.undo, versions: versions(v.versions) },
    ]),
  );
  const kinds = Object.fromEntries(
    Object.entries(c.SURFACE_KINDS).map(([n, k]) => [n, { slots: slots(k), versions: versions(k.versions) }]),
  );
  const j = (v) => JSON.stringify(v);
  return `// Generated from shared/contract by scripts/contract.mjs; do not edit (run \`node scripts/contract.mjs\`).
// The phone's copy of the runtime contract (docs/engineering/EXTENDING.md): change kinds, live
// frames, apps, verbs and surface kinds with their versions. The JSDoc types point at
// shared/contract, so the type check fails if this copy drifts from it.

/** @typedef {import('../../shared/contract/feed.ts').ChangeKind} ChangeKind */
/** @typedef {import('../../shared/contract/feed.ts').FrameType} FrameType */
/** @typedef {import('../../shared/contract/feed.ts').AppId} AppId */
/** @typedef {import('../../shared/contract/verbs.ts').VerbName} VerbName */
/** @typedef {import('../../shared/contract/surfaces.ts').SurfaceKindName} SurfaceKindName */
/** @typedef {{ app: string, side: 'worker' | 'phone', intent?: true, queueable: boolean, undo: 'stored' | 'reported' | 'none', versions: readonly number[] }} VerbInfo */
/** @typedef {{ slots: Readonly<Record<string, string>>, versions: readonly number[] }} SurfaceInfo */

/** @type {typeof import('../../shared/contract/feed.ts').LIVE_PROTOCOL} */
export const LIVE_PROTOCOL = ${j(c.LIVE_PROTOCOL)};

/** @type {readonly ChangeKind[]} */
export const CHANGE_KINDS = Object.freeze(${j(c.CHANGE_KINDS)});

/** @type {readonly FrameType[]} */
export const FRAME_TYPES = Object.freeze(${j(c.FRAME_TYPES)});

/** @type {Readonly<typeof import('../../shared/contract/feed.ts').CLOSE_CODES>} */
export const CLOSE_CODES = Object.freeze(${j(c.CLOSE_CODES)});

/** @type {readonly import('../../shared/contract/routes.ts').Phase[]} */
export const BUILT_PHASES = Object.freeze(${j(c.BUILT_PHASES)});

/** @type {Readonly<Record<AppId, { path: string, name: string, phase: string }>>} */
export const APPS = Object.freeze(${j(c.APPS)});

/** @type {readonly import('../../shared/contract/api.ts').MessageKind[]} */
export const MESSAGE_KINDS = Object.freeze(${j(c.MESSAGE_KINDS)});

/** @type {Readonly<typeof import('../../shared/contract/files.ts').FILE_LIMITS>} */
export const FILE_LIMITS = Object.freeze(${j(c.FILE_LIMITS)});

/** @type {Readonly<typeof import('../../shared/contract/files.ts').DICTATE_LIMITS>} */
export const DICTATE_LIMITS = Object.freeze(${j(c.DICTATE_LIMITS)});

/** @type {Readonly<typeof import('../../shared/contract/reminders.ts').REMINDER_LIMITS>} */
export const REMINDER_LIMITS = Object.freeze(${j(c.REMINDER_LIMITS)});

/** @type {Readonly<Record<VerbName, VerbInfo>>} */
export const VERBS = Object.freeze(${j(verbs)});

/** @type {Readonly<Record<SurfaceKindName, SurfaceInfo>>} */
export const SURFACE_KINDS = Object.freeze(${j(kinds)});

/** Decision cards (shared/contract/proposals.ts): each class's label and the card's limits. */
/** @type {typeof import('../../shared/contract/proposals.ts').PROPOSAL_CLASSES} */
export const PROPOSAL_CLASSES = Object.freeze(${j(c.PROPOSAL_CLASSES)});

/** @type {typeof import('../../shared/contract/proposals.ts').PROPOSAL_LIMITS} */
export const PROPOSAL_LIMITS = Object.freeze(${j(c.PROPOSAL_LIMITS)});

/** Memory (MEMORY.md §2–§8): fact kinds in profile order, sources, the confidence thresholds, and
 * the reasons an op can be refused. A kind or source not listed renders generically.
 * @type {Readonly<{kinds: readonly import('../../shared/contract/memory.ts').FactKind[], sources: readonly import('../../shared/contract/memory.ts').FactSource[], confidence: typeof import('../../shared/contract/memory.ts').CONFIDENCE, limits: typeof import('../../shared/contract/memory.ts').MEMORY_LIMITS, reasons: readonly import('../../shared/contract/memory.ts').MemoryReason[]}>} */
export const MEMORY = Object.freeze(${j(memory())});
`;
}

/** The memory vocabulary both copies carry. */
function memory() {
  return {
    kinds: c.FACT_KIND_NAMES,
    sources: Object.keys(c.FACT_SOURCES),
    confidence: c.CONFIDENCE,
    limits: c.MEMORY_LIMITS,
    reasons: Object.keys(c.MEMORY_REASONS),
  };
}

/** The standing permissions as the mind's copy and the appendix read them. */
function permits() {
  return {
    positions: c.PERMIT_POSITIONS,
    classes: Object.fromEntries(
      c.PERMIT_CLASSES.map((k) => {
        const s = c.permitSetting(k);
        return [k, { setting: s.key, label: s.label, default: s.default }];
      }),
    ),
    floors: c.PERMIT_FLOORS,
    actions: c.MIND_ACTIONS,
  };
}

/** The mind's copy: everything `th` validates or prints before it calls the Worker. */
function mind() {
  const out = {
    v: 1,
    note: 'Generated from shared/contract by scripts/contract.mjs; do not edit.',
    live_protocol: c.LIVE_PROTOCOL,
    routes: Object.fromEntries(
      Object.entries(c.ROUTES).map(([k, r]) => [
        k,
        {
          who: r.who,
          phase: r.phase,
          status: routeStatus(r),
          // `key` names the route in th's own rows, so the one agent key a route takes is `agent_key`.
          ...(r.key ? { agent_key: r.key } : {}),
          // …and, when only one role's agents must be that key, which (the night mind's collect is not keyed).
          ...(r.keyRole ? { agent_key_role: r.keyRole } : {}),
          ...(r.note ? { note: r.note } : {}),
        },
      ]),
    ),
    verbs: Object.fromEntries(
      Object.entries(c.VERBS).map(([n, v]) => [
        n,
        {
          app: v.app,
          class: v.class,
          permit: v.permit,
          ...(v.floor ? { floor: v.floor } : {}),
          side: v.side,
          ...(v.intent ? { intent: true } : {}),
          ...(v.tell_min ? { tell_min: true } : {}),
          ...(v.now_only ? { now_only: true } : {}),
          queueable: v.queueable,
          undo: v.undo,
          doc: v.doc,
          versions: Object.fromEntries(
            Object.entries(v.versions).map(([ver, s]) => [ver, { args: schema(s.args), result: schema(s.result) }]),
          ),
        },
      ]),
    ),
    surfaces: Object.fromEntries(
      Object.entries(c.SURFACE_KINDS).map(([n, k]) => [
        n,
        {
          slots: slots(k),
          doc: k.doc,
          versions: Object.fromEntries(Object.entries(k.versions).map(([ver, s]) => [ver, schema(s)])),
        },
      ]),
    ),
    codes: c.CODES,
    change_kinds: c.CHANGE_KINDS,
    frame_types: c.FRAME_TYPES,
    close_codes: c.CLOSE_CODES,
    apps: c.APPS,
    search_sources: c.SEARCH_SOURCES,
    message_kinds: c.MESSAGE_KINDS,
    // Chat files (`th say --attach`, `th file`): what the Worker takes, checked before the upload.
    files: { limits: c.FILE_LIMITS },
    // The phone's reports (`th reports`): the kinds and the page size, checked before the call.
    reports: { kinds: c.REPORT_KINDS, limits: c.REPORT_LIMITS },
    // The listening pass (`th music`): the job kinds, the mood list and the limits.
    listen: { kinds: c.LISTEN_KINDS, moods: c.MOODS, limits: c.LISTEN_LIMITS },
    // Podcasts (`th podcasts new`): the night's budget of shows and how long before one is due again.
    podcasts: { limits: c.PODCAST_LIMITS },
    // What the mind knows of each song (`th music`): a note is checked against these before it is sent.
    music: {
      moods: c.MUSIC_MOODS,
      occasions: c.MUSIC_OCCASIONS,
      themes: c.MUSIC_THEMES,
      languages: c.ISO_639_1,
      note_version: c.MUSIC_NOTE_VERSION,
      never_subject: c.MUSIC_NEVER_SUBJECT,
      taint_source: c.MUSIC_TAINT_SOURCE,
      limits: c.MUSIC_NOTE_LIMITS,
    },
    memory: { ...memory(), kinds: c.FACT_KINDS, sources: c.FACT_SOURCES, reasons: c.MEMORY_REASONS },
    night: {
      steps: c.NIGHT_STEPS,
      built_phases: c.BUILT_PHASES,
      last_step: c.NIGHT_LAST_STEP,
      budget_min: c.NIGHT_BUDGET_MIN,
      cursor_max: c.NIGHT_CURSOR_MAX,
      day_parts: c.NIGHT_DAY_PARTS,
      page_max: c.NIGHT_PAGE_MAX,
      backfill_days: c.NIGHT_BACKFILL_DAYS,
    },
    proposals: {
      classes: c.PROPOSAL_CLASSES,
      limits: c.PROPOSAL_LIMITS,
      ops: Object.fromEntries(
        Object.entries(c.PROPOSAL_OPS).map(([n, o]) => [
          n,
          { classes: o.classes, by: o.by, runs: o.runs, ref: o.ref, doc: o.doc, args: schema(o.args) },
        ]),
      ),
    },
    // Standing permissions: each class's setting and default, the floors, and the actions Core runs
    // itself (a verb's class is on the verb above).
    permits: permits(),
    // Scheduled actions and plans (`th verb --at`, `th plan`): checked before the call.
    schedules: { limits: c.SCHEDULE_LIMITS, plans: c.PLAN_LIMITS, plan_action: c.PLAN_ACTION, quiet_held: c.QUIET_HELD },
    lint: { banned_phrases: BANNED_PHRASES },
    watchdogs: { limits: c.WATCHDOG_LIMITS, reflex_procedure: c.REFLEX_PROCEDURE, items: c.WATCHDOGS },
    // The day pulse (`th watch`): the kinds, the limits, what an event or a change watch may name.
    watches: {
      kinds: c.WATCH_KINDS,
      limits: c.WATCH_LIMITS,
      states: c.WATCH_STATES,
      worker_events: c.WORKER_EVENTS,
      changes: c.WATCH_CHANGES,
      wake_causes: c.WAKE_CAUSES,
    },
    reader: {
      limits: c.READER_LIMITS,
      kinds: Object.fromEntries(
        Object.entries(c.READER_KINDS).map(([n, k]) => [n, { doc: k.doc, schema: schema(k.schema) }]),
      ),
    },
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

const cell = (s) => String(s).replaceAll('|', '\\|');
const who = (w) => (w === 'P' ? 'public' : w.join(' '));
const shape = (s) => {
  const j = schema(s);
  if (j.type !== 'object') return `\`${j.type}\``;
  const req = new Set(j.required ?? []);
  const props = Object.entries(j.properties ?? {}).map(([k, p]) => {
    const t = p.enum
      ? p.enum.map((e) => `'${e}'`).join(' \\| ')
      : p.const !== undefined
        ? `'${p.const}'`
        : p.anyOf
          ? p.anyOf.map((x) => x.type).join(' \\| ')
          : (p.type ?? 'json');
    return `${k}${req.has(k) ? '' : '?'}: ${t}`;
  });
  return props.length ? `\`{ ${props.join(', ')} }\`` : '`{}`';
};

/** The appendix: every registry as a table, so API.md's prose never has to repeat them. */
function docs() {
  const L = [
    '# Contract appendix',
    '',
    '<!-- Generated from shared/contract by scripts/contract.mjs; do not edit. Run `node scripts/contract.mjs`. -->',
    '',
    'The runtime contract as data, generated from [`shared/contract`](../../shared/contract). [API.md](API.md) describes each route; this appendix lists what the code enforces. How to add to it: [EXTENDING.md](EXTENDING.md).',
    '',
    `Who: D device · C mind:chat · N mind:night · R mind:reflex · M muse · I ci. Built phases: ${c.BUILT_PHASES.join(', ')}.`,
    '',
    '## Routes',
    '',
    '| Route | Who | Phase | Status | Note |',
    '|---|---|---|---|---|',
  ];
  for (const [k, r] of Object.entries(c.ROUTES))
    L.push(
      `| \`${k}\` | ${who(r.who)}${r.auth ? ` (${r.auth})` : ''}${r.key ? ` (agents: the key \`${r.key}\` only)` : ''} | ${r.phase} | ${cell(routeStatus(r))} | ${cell(r.note ?? '')} |`,
    );
  L.push(
    '',
    '## Verbs',
    '',
    'Side `worker`: run inside the commit that queues it, `done` at once, its inverse stored on the ledger row (`stored`). Side `phone`: claimed and run by a signed-in phone, which reports its inverse (`reported`); an intent waits for its app to open (`GET /v1/verbs/pending?app=`). `tell_min`: never below tell. `now only`: never scheduled or a step of a scheduled plan.',
    '',
    '| Verb | App | Class | Permit | Side | Queueable | Undo | Versions | Args (newest) | What it does |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [n, v] of Object.entries(c.VERBS)) {
    const vs = versions(v.versions);
    const permit = v.permit === null ? 'none (the owner\'s words)' : `${v.permit}${v.floor ? ` (floor: ${v.floor})` : ''}${v.tell_min ? ' (tell_min)' : ''}`;
    const later = v.now_only ? ' (now only)' : '';
    L.push(
      `| \`${n}\` | ${v.app} | ${v.class} | ${permit} | ${v.side}${v.intent ? ' (intent)' : ''} | ${v.queueable ? `yes${later}` : 'no (owner tap or undo)'} | ${v.undo} | ${vs.join(', ')} | ${shape(v.versions[vs.at(-1)].args)} | ${cell(v.doc)} |`,
    );
  }
  const p = permits();
  L.push(
    '',
    '## Standing permissions',
    '',
    `How the mind may take each class of action, the owner's \`mind.permit.<class>\` setting: ${p.positions.map((x) => `\`${x}\``).join(', ')} (a card first; do it and say so; do it, the ledger only). Floors always ask, whatever the setting: ${Object.entries(p.floors)
      .map(([k, words]) => `\`${k}\` (${words})`)
      .join(', ')}. A refusal is \`403 proposal_required\` with reason \`permit\` and the \`permit.allow\` card to raise (API.md §11.11).`,
    '',
    '| Class | Setting | Label | Default | Verbs | Core actions |',
    '|---|---|---|---|---|---|',
  );
  for (const [k, s] of Object.entries(p.classes)) {
    const verbs = Object.entries(c.VERBS).filter(([, v]) => v.permit === k);
    const own = Object.entries(p.actions).filter(([, a]) => a.class === k);
    const names = (xs) => xs.map(([n, a]) => `\`${n}\`${a.floor ? ` (floor: ${a.floor})` : ''}`).join(', ') || '—';
    L.push(`| \`${k}\` | \`${s.setting}\` | ${cell(s.label)} | ${s.default} | ${names(verbs)} | ${names(own)} |`);
  }
  L.push('', '| Core action | Class | Floor | What it is |', '|---|---|---|---|');
  for (const [n, a] of Object.entries(p.actions)) L.push(`| \`${n}\` | ${a.class} | ${a.floor ?? '—'} | ${cell(a.doc)} |`);
  L.push(
    '',
    '## Scheduled actions and plans',
    '',
    `A verb or a plan with \`fire_at\` (ISO, owner-local or with its offset) waits as a \`scheduled\` row: at most ${c.SCHEDULE_LIMITS.pending} at once (429 \`too_many_scheduled\`), at most ${c.SCHEDULE_LIMITS.days_ahead} days ahead; its permit is checked when it is queued. Classes that wait out quiet hours (fired at their end, \`shifted\`): ${c.QUIET_HELD.map((x) => `\`${x}\``).join(', ')}. A plan is ${c.PLAN_LIMITS.min_steps}–${c.PLAN_LIMITS.max_steps} verbs with one why, one undo and a line of at most ${c.PLAN_LIMITS.what} characters, gated and carded as \`${c.PLAN_ACTION}\` under its strictest step's position (API.md §11.11).`,
  );
  L.push('', '## Surface kinds', '', '| Kind | Slots | Versions | Payload (newest) | What it is |', '|---|---|---|---|---|');
  for (const [n, k] of Object.entries(c.SURFACE_KINDS)) {
    const vs = versions(k.versions);
    const where = Object.entries(slots(k))
      .map(([app, re]) => `${app} \`${re}\``)
      .join('; ');
    L.push(`| \`${n}\` | ${cell(where)} | ${vs.join(', ')} | ${shape(k.versions[vs.at(-1)])} | ${cell(k.doc)} |`);
  }
  L.push('', '## Change kinds', '', c.CHANGE_KINDS.map((k) => `\`${k}\``).join(' · '), '');
  L.push(
    '## Live channel',
    '',
    `Protocol ${c.LIVE_PROTOCOL}. Frames (server → client): ${c.FRAME_TYPES.map((t) => `\`${t}\``).join(', ')}. Close codes: ${Object.entries(
      c.CLOSE_CODES,
    )
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}.`,
    '',
  );
  L.push('## Apps', '', '| App | Folder | Name | Phase |', '|---|---|---|---|');
  for (const [id, a] of Object.entries(c.APPS))
    L.push(`| \`${id}\` | \`${a.path}\` | ${a.name} | ${a.phase}${a.deferred ? ` (page: ${a.deferred})` : ''} |`);
  const field = (f) => (Array.isArray(f) ? f.map((x) => `\`${x}\``).join(' \\| ') : f);
  L.push(
    '',
    '## Senses',
    '',
    `Every event type the phone may send (\`PUT /v1/senses/batches/:id\`, API.md §11.14), its app's switch (\`privacy.senses.<app>\`), the ref kinds it may carry, its only data fields and their kinds, and its sensitivity (1: type and time only in every answer). Anything else is refused: \`bad_type\`, \`bad_data\`, \`bad_ref\`; an app switched off, \`switched_off\`. The \`routines\` query: ${c.ROUTINES.days} logical days, a band of 1 to ${c.ROUTINES.max_hours} hours on the weekdays with events in ${c.ROUTINES.day_weeks}+ weeks, kept at ${c.ROUTINES.min_n}+ events in ${c.ROUTINES.min_weeks}+ weeks.`,
    '',
    '| Type | App | Ref | Data | Sensitivity | When |',
    '|---|---|---|---|---|---|',
  );
  for (const [n, s] of Object.entries(c.SENSE_TYPES)) {
    const data = Object.entries(s.data).map(([k, f]) => `${k}: ${field(f)}`);
    L.push(
      `| \`${n}\` | ${s.app} | ${s.ref.map((r) => `\`${r}:\``).join(', ') || '—'} | ${data.join(', ') || '—'} | ${s.sensitivity} | ${cell(s.doc)} |`,
    );
  }
  L.push('', '## Search sources', '', '| Source | Phase | Ref kind |', '|---|---|---|');
  for (const [id, s] of Object.entries(c.SEARCH_SOURCES)) L.push(`| \`${id}\` | ${s.phase} | \`${s.ref}\` |`);
  L.push('', '## Memory', '', '| Fact kind | Half-life (days) | Profile cap |', '|---|---|---|');
  for (const [k, v] of Object.entries(c.FACT_KINDS))
    L.push(`| \`${k}\` | ${v.half_life_days ?? 'never decays'} | ${v.cap ?? 'not in the profile (briefing section 3)'} |`);
  L.push('', '| Source | Starts at | Cap | Profile letter |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(c.FACT_SOURCES)) L.push(`| \`${k}\` | ${v.base} | ${v.cap} | ${v.letter} |`);
  L.push('', '| Refusal reason | Meaning |', '|---|---|');
  for (const [k, v] of Object.entries(c.MEMORY_REASONS)) L.push(`| \`${k}\` | ${cell(v)} |`);
  const ml = c.MUSIC_NOTE_LIMITS;
  L.push(
    '',
    '## Music notes',
    '',
    `What the mind knows of each song (\`PUT /v1/music/notes\`, \`th music note\`), format version ${c.MUSIC_NOTE_VERSION}. A batch holds 1–${ml.batch} notes and is refused whole for one bad note. Each mood and occasion carries its own confidence (${ml.conf_min}–1); \`conf\` has one for each of themes, language, era and energy that is set, none for one left empty; a song the mind doesn't know (\`known: false\`) keeps every confidence at or under ${ml.unknown_conf_max}. The listening pass scores the same moods. "Never play this again" is a rule fact under the subject \`${c.MUSIC_NEVER_SUBJECT}\` naming \`music:<id>\`.`,
    '',
    '| Field | At most | Words |',
    '|---|---|---|',
    `| moods | ${ml.moods} | ${c.MUSIC_MOODS.join(', ')} |`,
    `| occasions | ${ml.occasions} | ${c.MUSIC_OCCASIONS.join(', ')} |`,
    `| themes | ${ml.themes} | ${c.MUSIC_THEMES.join(', ')} |`,
    `| language | 1 | ISO 639-1 (${c.ISO_639_1.length} codes), or null |`,
    `| era | 1 | a decade from ${ml.era_min} to the present one, or null |`,
    '| energy | 1 | 0 to 1, or null |',
  );
  const b = c.NIGHT_BUDGET_MIN;
  L.push(
    '',
    '## Night shift',
    '',
    `The steps in order (\`POST /v1/mind/night\`, \`th night\`). The run: target ${b.target} min, hard stop ${b.hard} (Sunday ${b.sunday_hard}). A step of a phase not built yet, and the Sunday step on another night, is skipped on the way.`,
    '',
    '| Step | Name | Budget (min) | Phase | Cursor | Runs again without harm because |',
    '|---|---|---|---|---|---|',
  );
  for (const s of c.NIGHT_STEPS)
    L.push(
      `| ${s.step} | ${s.name}${s.sunday ? ' (Sunday)' : ''} | ${s.budget_min} | ${s.phase} | ${s.cursor ? 'yes' : 'no'} | ${cell(s.idempotent)} |`,
    );
  const lim = c.PROPOSAL_LIMITS;
  L.push(
    '',
    '## Proposals',
    '',
    `Decision cards (\`PUT /v1/proposals/:id\`, \`th propose\`). A card: question ≤ ${lim.question}, why ≤ ${lim.why}, if ignored ≤ ${lim.if_ignored}, two options ≤ ${lim.option} each; at most ${lim.waiting} raised by agents wait at once; each expires after ${lim.expires_days} days; "Not yet" brings it back the next morning at most ${lim.snoozes} times; the canonical spec ≤ ${lim.spec_bytes} bytes. Only the owner decides: a tap on a device, or their own words recorded by mind:chat (\`by_message\`).`,
    '',
    '| Class | Ask first | Card label |',
    '|---|---|---|',
  );
  for (const [k, v] of Object.entries(c.PROPOSAL_CLASSES)) L.push(`| \`${k}\` | ${v.ask_first ? 'yes' : 'no'} | ${cell(v.label)} |`);
  L.push('', '| Op | Classes | Raised by | Runs in | Acts on | Args | What approving does |', '|---|---|---|---|---|---|---|');
  for (const [n, o] of Object.entries(c.PROPOSAL_OPS))
    L.push(
      `| \`${n}\` | ${o.classes.join(', ')} | ${o.by.join(' ')} | ${o.runs} | \`${o.ref[0]}:<${o.ref[1]}>\` | ${shape(o.args)} | ${cell(o.doc)} |`,
    );
  L.push(
    '',
    '## Reader kinds',
    '',
    `What the reader subagent (\`.claude/agents/reader.md\`) answers with, checked by \`th read --check <kind>\`: at most ${c.READER_LIMITS.quote_sentences} sentence quoted, no query or fragment in a source or link, a note exactly when instructions were seen, at most ${c.READER_LIMITS.fetches} fetches.`,
    '',
    '| Kind | Fields | What it holds |',
    '|---|---|---|',
  );
  for (const [n, k] of Object.entries(c.READER_KINDS)) L.push(`| \`${n}\` | ${shape(k.schema)} | ${cell(k.doc)} |`);
  L.push(
    '',
    '## Watchdogs',
    '',
    `Each 15-minute tick runs every built watchdog; a trip writes one ledger note and, for one that wakes, wakes \`mind-reflex\` (at most ${c.WATCHDOG_LIMITS.reflex_wakes_per_day} in any 24 hours); \`th reflex\` prints what to do (OPERATIONS.md §8.2).`,
    '',
    '| Watchdog | Trips when | Severity | Guards | Wakes reflex | Phase | Built |',
    '|---|---|---|---|---|---|---|',
  );
  for (const [n, w] of Object.entries(c.WATCHDOGS))
    L.push(
      `| \`${n}\` | ${cell(w.trips)} | ${w.severity} | ${cell(w.slo)} | ${w.wakes ? 'yes' : 'no'} | ${w.phase} | ${w.deferred ? `waits for ${cell(w.deferred)}` : c.BUILT_PHASES.includes(w.phase) ? 'built' : 'later'} |`,
    );
  L.push(
    '',
    '## Watches',
    '',
    `The day pulse (RUNTIME.md §3): \`watch.set\` stores a condition (${c.WATCH_KINDS.map((k) => `\`${k}\``).join(', ')}) that, met once, wakes the chat with its why and note, within the owner's wake budget (\`mind.wake_budget\`). At most ${c.WATCH_LIMITS.live} wait at once; an \`at\` watch is at most ${c.WATCH_LIMITS.ahead_days} days ahead, and an event or change watch lapses unmet after as long; a met watch that cannot wake the mind yet waits ${c.WATCH_LIMITS.queued_hours} hours. States: ${c.WATCH_STATES.map((k) => `\`${k}\``).join(' · ')}. The meter counts wakes by cause: ${c.WAKE_CAUSES.map((k) => `\`${k}\``).join(' · ')}.`,
    '',
    '| Event watch (beside every sense type) | When |',
    '|---|---|',
  );
  for (const [n, d] of Object.entries(c.WORKER_EVENTS)) L.push(`| \`${n}\` | ${cell(d)} |`);
  L.push('', '| Change watch | Met when |', '|---|---|');
  for (const [n, d] of Object.entries(c.WATCH_CHANGES)) L.push(`| \`${n}\` | ${cell(d)} |`);
  L.push('', '## Error codes', '', '| Code | Status | Message |', '|---|---|---|');
  for (const [code, [status, message]] of Object.entries(c.CODES)) L.push(`| \`${code}\` | ${status} | ${cell(message)} |`);
  L.push('', '## Phrase lint', '', BANNED_PHRASES.map((p) => `"${p}"`).join(' · '), '');
  return `${L.join('\n')}`;
}

/** The settings catalogue for the phone's Settings pages (shared/contract/settings.ts): data only;
 * the pages check values with their own copy of validSetting. */
function settings() {
  const j = (v) => JSON.stringify(v);
  return `// Generated from shared/contract/settings.ts by scripts/contract.mjs; do not edit (run \`node scripts/contract.mjs\`).
// The owner's settings catalogue (MENU-AND-SETTINGS.md §6): catalog.js renders a page from it.

/** @type {typeof import('../../../shared/contract/settings.ts').SETTING_GROUPS} */
export const SETTING_GROUPS = Object.freeze(${j(c.SETTING_GROUPS)});

/** @type {typeof import('../../../shared/contract/settings.ts').SETTINGS} */
export const SETTINGS = Object.freeze([
${c.SETTINGS.map((s) => `  ${j(s)},`).join('\n')}
]);
`;
}

export function render() {
  return { [OUTPUTS[0]]: phone(), [OUTPUTS[1]]: mind(), [OUTPUTS[2]]: docs(), [OUTPUTS[3]]: settings() };
}

/** Files whose committed text differs from what the contract gives. */
export function stale() {
  return Object.entries(render())
    .filter(([path, text]) => {
      try {
        return readFileSync(REPO + path, 'utf8') !== text;
      } catch {
        return true;
      }
    })
    .map(([path]) => path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const s = stale();
    if (s.length) {
      console.error(`Stale (run node scripts/contract.mjs): ${s.join(', ')}`);
      process.exit(1);
    }
    console.log('contract outputs are current');
  } else {
    for (const [path, text] of Object.entries(render())) {
      mkdirSync(dirname(REPO + path), { recursive: true });
      writeFileSync(REPO + path, text);
      console.log(`wrote ${path}`);
    }
  }
}
