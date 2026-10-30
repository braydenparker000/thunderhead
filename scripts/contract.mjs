// Writes the three copies of the runtime contract from shared/contract (EXTENDING.md rule 1):
//   frontend/th/contract.js       the phone's vocabularies, verbs and surface kinds (JSDoc-typed
//                                 against shared/contract, so the type check catches drift)
//   mind/cli/contract.json        what `th` needs: routes, verbs and surfaces with JSON Schemas,
//                                 error codes, the phrase lint
//   docs/engineering/CONTRACT.md  the generated appendix to API.md
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
export const OUTPUTS = ['frontend/th/contract.js', 'mind/cli/contract.json', 'docs/engineering/CONTRACT.md'];

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
      { app: v.app, executor: v.executor, queueable: v.queueable, undo: v.undo, versions: versions(v.versions) },
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
/** @typedef {{ app: string, executor: 'device' | 'worker', queueable: boolean, undo: 'reported' | 'none', versions: readonly number[] }} VerbInfo */
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
          executor: v.executor,
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
    lint: { banned_phrases: BANNED_PHRASES },
    watchdogs: { limits: c.WATCHDOG_LIMITS, reflex_procedure: c.REFLEX_PROCEDURE, items: c.WATCHDOGS },
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
          : p.type;
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
  L.push('', '## Verbs', '', '| Verb | App | Class | Runs on | Queueable | Undo | Versions | Args (newest) | What it does |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const [n, v] of Object.entries(c.VERBS)) {
    const vs = versions(v.versions);
    L.push(
      `| \`${n}\` | ${v.app} | ${v.class} | ${v.executor} | ${v.queueable ? 'yes' : 'no (owner tap)'} | ${v.undo} | ${vs.join(', ')} | ${shape(v.versions[vs.at(-1)].args)} | ${cell(v.doc)} |`,
    );
  }
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
  L.push('', '## Search sources', '', '| Source | Phase | Ref kind |', '|---|---|---|');
  for (const [id, s] of Object.entries(c.SEARCH_SOURCES)) L.push(`| \`${id}\` | ${s.phase} | \`${s.ref}\` |`);
  L.push('', '## Memory', '', '| Fact kind | Half-life (days) | Profile cap |', '|---|---|---|');
  for (const [k, v] of Object.entries(c.FACT_KINDS))
    L.push(`| \`${k}\` | ${v.half_life_days ?? 'never decays'} | ${v.cap ?? 'not in the profile (briefing section 3)'} |`);
  L.push('', '| Source | Starts at | Cap | Profile letter |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(c.FACT_SOURCES)) L.push(`| \`${k}\` | ${v.base} | ${v.cap} | ${v.letter} |`);
  L.push('', '| Refusal reason | Meaning |', '|---|---|');
  for (const [k, v] of Object.entries(c.MEMORY_REASONS)) L.push(`| \`${k}\` | ${cell(v)} |`);
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
  L.push('', '## Error codes', '', '| Code | Status | Message |', '|---|---|---|');
  for (const [code, [status, message]] of Object.entries(c.CODES)) L.push(`| \`${code}\` | ${status} | ${cell(message)} |`);
  L.push('', '## Phrase lint', '', BANNED_PHRASES.map((p) => `"${p}"`).join(' · '), '');
  return `${L.join('\n')}`;
}

export function render() {
  return { [OUTPUTS[0]]: phone(), [OUTPUTS[1]]: mind(), [OUTPUTS[2]]: docs() };
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
