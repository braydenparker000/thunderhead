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
export const CHANGE_KINDS = Object.freeze(["message","thread","ledger","proposal","verb","surface","notice","fact","day_note","open_thread","setting","mind_status","error"]);

/** @type {readonly FrameType[]} */
export const FRAME_TYPES = Object.freeze(["hello","changed","typing","bye"]);

/** @type {Readonly<typeof import('../../shared/contract/feed.ts').CLOSE_CODES>} */
export const CLOSE_CODES = Object.freeze({"revoked":4401,"outdated":4426,"restart":1012});

/** @type {readonly import('../../shared/contract/routes.ts').Phase[]} */
export const BUILT_PHASES = Object.freeze(["P1","P1b","P2"]);

/** @type {Readonly<Record<AppId, { path: string, name: string, phase: string }>>} */
export const APPS = Object.freeze({"music":{"path":"/music/","name":"Music","phase":"P1b"},"guitar":{"path":"/guitar/","name":"Guitar","phase":"P1b"},"podcasts":{"path":"/podcasts/","name":"Podcasts","phase":"P1b"},"astra":{"path":"/astra/","name":"Astra","phase":"P1b"},"media":{"path":"/media/","name":"My Media","phase":"P1b"},"study":{"path":"/study/","name":"Study","phase":"P7"}});

/** @type {readonly import('../../shared/contract/api.ts').MessageKind[]} */
export const MESSAGE_KINDS = Object.freeze(["text","voice","progress","card","question","error"]);

/** @type {Readonly<Record<VerbName, VerbInfo>>} */
export const VERBS = Object.freeze({"app.open":{"app":"shell","executor":"device","queueable":false,"undo":"none","versions":[1]},"shell.appearance":{"app":"shell","executor":"device","queueable":true,"undo":"reported","versions":[1]}});

/** @type {Readonly<Record<SurfaceKindName, SurfaceInfo>>} */
export const SURFACE_KINDS = Object.freeze({"line":{"slots":{"home":"^line\\.[1-4]$"},"versions":[1]}});
