// The contract as th sees it: mind/cli/contract.json, written from shared/contract by
// scripts/contract.mjs (docs/engineering/EXTENDING.md). th checks every call against it before the
// network: a route this Worker build does not have yet exits 8 (`not_built`, with the phase it
// arrives in), and verb args and surface payloads are checked against their JSON Schemas, so new
// Worker features reach the mind through the generic commands without a th change.
import {readFileSync} from 'node:fs';
import {EXIT, ThError, invalid} from './io.mjs';
import {check} from './schema.mjs';

/** @type {any} */
export const CONTRACT = JSON.parse(readFileSync(new URL('../contract.json', import.meta.url), 'utf8'));

const ROUTES = Object.entries(CONTRACT.routes).map(([key, r]) => {
  const [method, path] = key.split(' ');
  return {key, method, path, re: new RegExp(`^${path.replace(/:[a-z_]+/g, '[^/]+')}$`), ...r};
});

/** The contract row for a call, preferring a literal path over a pattern (`/threads/today` over `/threads/:id`). */
export function routeOf(method, path) {
  const hits = ROUTES.filter(r => r.method === method && r.re.test(path));
  return hits.find(r => r.path === path) ?? hits[0] ?? null;
}

/** Throws unless the call is a built route. `TH_ALLOW_UNBUILT=1` lifts the build check (tests of later phases). */
export function checkRoute(method, path, env = process.env) {
  const r = routeOf(method, path);
  if (!r) throw new ThError(EXIT.validation, 'unknown_route', `${method} ${path} is not in the contract`);
  if (r.status !== 'built' && env.TH_ALLOW_UNBUILT !== '1')
    throw new ThError(EXIT.validation, 'not_built', `${r.key} is ${r.status}; this Worker build does not have it yet`);
  return r;
}

/** The role letters of the contract's `who` lists. */
export const ROLE_LETTER = {chat: 'C', night: 'N', reflex: 'R'};

/** Built routes the role may call, for `th help` and `th get`. */
export function routesFor(role) {
  const letter = ROLE_LETTER[role];
  return ROUTES.filter(r => r.status === 'built' && Array.isArray(r.who) && (!letter || r.who.includes(letter)));
}

/** Validates a verb call: known, queueable, a known schema version, args matching it. Returns the version. */
export function checkVerb(name, schema, args) {
  const v = CONTRACT.verbs[name];
  if (!v) throw invalid(`unknown verb ${name}; verbs: ${Object.keys(CONTRACT.verbs).join(', ')}`);
  if (!v.queueable) throw invalid(`${name} runs only when the owner taps it (a reply chip)`);
  const versions = Object.keys(v.versions).map(Number);
  const ver = schema ?? Math.max(...versions);
  if (!v.versions[ver]) throw invalid(`${name} has schema versions ${versions.join(', ')}`);
  const problem = check(args, v.versions[ver].args, 'args');
  if (problem) throw invalid(`${name} v${ver}: ${problem}`);
  return ver;
}

/** Validates a surface: a known kind, a slot it may fill, a known version, a payload matching it. */
export function checkSurface(app, slot, kind, schema, payload) {
  const k = CONTRACT.surfaces[kind];
  if (!k) throw invalid(`unknown surface kind ${kind}; kinds: ${Object.keys(CONTRACT.surfaces).join(', ')}`);
  const pattern = k.slots[app];
  if (!pattern || !new RegExp(pattern).test(slot)) throw invalid(`a ${kind} goes in ${Object.entries(k.slots).map(([a, p]) => `${a} ${p}`).join('; ')}`);
  const versions = Object.keys(k.versions).map(Number);
  const ver = schema ?? Math.max(...versions);
  if (!k.versions[ver]) throw invalid(`${kind} has schema versions ${versions.join(', ')}`);
  const problem = check(payload, k.versions[ver], 'payload');
  if (problem) throw invalid(`${kind} v${ver}: ${problem}`);
  return ver;
}
