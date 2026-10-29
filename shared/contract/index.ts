// The runtime half of the contract in one import: routes, verbs, surface kinds, the change feed
// and live channel vocabularies, error codes. scripts/contract.mjs reads this to write the
// phone's frontend/th/contract.js, the mind's mind/cli/contract.json and the appendix
// docs/engineering/CONTRACT.md; a test fails when any of them is stale. Types are in api.ts.
export { CODES } from './codes.ts';
export * from './feed.ts';
export * from './memory.ts';
export * from './night.ts';
export { BUILT_PHASES, builtRoutes, type Phase, ROUTES, type RouteKey, type RouteSpec, type Who } from './routes.ts';
export { SURFACE_KINDS, type SurfaceKind, type SurfaceKindName, surfaceKind } from './surfaces.ts';
export { latestVersion, VERBS, type VerbName, type VerbSpec, type VerbVersion, verbSpec } from './verbs.ts';
