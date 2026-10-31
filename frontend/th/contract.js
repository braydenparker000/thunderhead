// Generated from shared/contract by scripts/contract.mjs; do not edit (run `node scripts/contract.mjs`).
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
export const LIVE_PROTOCOL = 1;

/** @type {readonly ChangeKind[]} */
export const CHANGE_KINDS = Object.freeze(["message","thread","ledger","proposal","verb","surface","notice","fact","day_note","open_thread","setting","mind_status","error","work"]);

/** @type {readonly FrameType[]} */
export const FRAME_TYPES = Object.freeze(["hello","changed","typing","bye"]);

/** @type {Readonly<typeof import('../../shared/contract/feed.ts').CLOSE_CODES>} */
export const CLOSE_CODES = Object.freeze({"revoked":4401,"outdated":4426,"restart":1012});

/** @type {readonly import('../../shared/contract/routes.ts').Phase[]} */
export const BUILT_PHASES = Object.freeze(["P1","P1b","P2","P3","P4","P5","P6","P7","P8","P9"]);

/** @type {Readonly<Record<AppId, { path: string, name: string, phase: string }>>} */
export const APPS = Object.freeze({"music":{"path":"/music/","name":"Music","phase":"P1b"},"guitar":{"path":"/guitar/","name":"Guitar","phase":"P1b"},"podcasts":{"path":"/podcasts/","name":"Podcasts","phase":"P1b"},"astra":{"path":"/astra/","name":"Astra","phase":"P1b"},"media":{"path":"/media/","name":"My Media","phase":"P1b"},"study":{"path":"/study/","name":"Study","phase":"P7"},"photos":{"path":"/photos/","name":"Photos","phase":"P9","deferred":"the photo editor comes later"}});

/** @type {readonly import('../../shared/contract/api.ts').MessageKind[]} */
export const MESSAGE_KINDS = Object.freeze(["text","voice","progress","card","question","error"]);

/** @type {Readonly<typeof import('../../shared/contract/files.ts').FILE_LIMITS>} */
export const FILE_LIMITS = Object.freeze({"bytes":26214400,"owner_per_message":4,"mind_per_message":10,"name":120,"memo_seconds":600});

/** @type {Readonly<typeof import('../../shared/contract/reminders.ts').REMINDER_LIMITS>} */
export const REMINDER_LIMITS = Object.freeze({"text":200,"open":50,"days_ahead":400});

/** @type {Readonly<Record<VerbName, VerbInfo>>} */
export const VERBS = Object.freeze({"app.open":{"app":"shell","executor":"device","queueable":false,"undo":"none","versions":[1]},"music.create_playlist":{"app":"music","executor":"device","queueable":true,"undo":"reported","versions":[1]},"music.delete_playlist":{"app":"music","executor":"device","queueable":false,"undo":"none","versions":[1]},"shell.appearance":{"app":"shell","executor":"device","queueable":true,"undo":"reported","versions":[1]}});

/** @type {Readonly<Record<SurfaceKindName, SurfaceInfo>>} */
export const SURFACE_KINDS = Object.freeze({"line":{"slots":{"home":"^line\\.[1-4]$"},"versions":[1]},"tile":{"slots":{"briefing":"^(practice|study|built|note\\.[1-3])$"},"versions":[1]}});

/** Decision cards (shared/contract/proposals.ts): each class's label and the card's limits. */
/** @type {typeof import('../../shared/contract/proposals.ts').PROPOSAL_CLASSES} */
export const PROPOSAL_CLASSES = Object.freeze({"delete":{"ask_first":true,"label":"Can't be undone"},"money":{"ask_first":true,"label":"Costs money"},"access":{"ask_first":true,"label":"Changes access"},"reach_people":{"ask_first":true,"label":"Reaches someone else"},"memory_big":{"ask_first":false,"label":"Changes what I remember"}});

/** @type {typeof import('../../shared/contract/proposals.ts').PROPOSAL_LIMITS} */
export const PROPOSAL_LIMITS = Object.freeze({"question":80,"why":140,"if_ignored":140,"option":20,"waiting":3,"expires_days":7,"snoozes":3,"spec_bytes":8192});

/** Memory (MEMORY.md §2–§8): fact kinds in profile order, sources, the confidence thresholds, and
 * the reasons an op can be refused. A kind or source not listed renders generically.
 * @type {Readonly<{kinds: readonly import('../../shared/contract/memory.ts').FactKind[], sources: readonly import('../../shared/contract/memory.ts').FactSource[], confidence: typeof import('../../shared/contract/memory.ts').CONFIDENCE, limits: typeof import('../../shared/contract/memory.ts').MEMORY_LIMITS, reasons: readonly import('../../shared/contract/memory.ts').MemoryReason[]}>} */
export const MEMORY = Object.freeze({"kinds":["state","goal","preference","routine","fact","rule"],"sources":["user","observed","inferred"],"confidence":{"profile":0.25,"fading":0.1,"hedge":0.5,"pinned_user":1,"imported":0.6},"limits":{"ops_per_batch":50,"fact_text":280,"evidence_max":20,"tags_max":8,"thread_text":200,"day_note_words":150,"decisions_max":10,"profile_chars":6000,"supersedes_per_batch":10},"reasons":["bad_op","bad_evidence","unknown_ref","not_owner_evidence","rule_needs_owner","too_little_evidence","tainted_evidence","needs_owner_words","too_long","no_inferred_sensitive","session_tainted","laws_unpinned","device_only","duplicate_id","superseded","proposal_required","never_stored","session_required"]});
