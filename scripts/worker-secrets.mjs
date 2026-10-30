// Writes the secrets file for `wrangler deploy --secrets-file` (OPERATIONS.md §5.1 step 5) and
// prints only names, never values.
//   node scripts/worker-secrets.mjs <out.json> --bootstrap
//       AUTH_PEPPER and IP_HASH_KEY = 32 random bytes (base64url); every other required name = none.
//   node scripts/worker-secrets.mjs <out.json> --live <wrangler secret list --format json output file>
//       `none` for each required name the live Worker lacks; fails if AUTH_PEPPER or IP_HASH_KEY
//       is missing (only the bootstrap run may make them). Writes nothing when nothing is missing.
// VAPID_PRIVATE_JWK (Web Push, SECURITY.md §10) is made here, a new P-256 key, whenever the live Worker
// lacks it: on the first deploy that needs it, so nobody ever sees it. Replacing it later (every phone
// subscribes again) is the owner's call.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const GENERATED = ['AUTH_PEPPER', 'IP_HASH_KEY'];
const MADE_WHEN_MISSING = { VAPID_PRIVATE_JWK: () => JSON.stringify(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' })) };
const missing = (n) => (MADE_WHEN_MISSING[n] ? MADE_WHEN_MISSING[n]() : 'none');

/** `secrets.required` from wrangler.jsonc (whole-line comments only). */
export function requiredSecrets(jsonc) {
  return JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, '')).secrets?.required ?? [];
}

/** The name → value map to upload, or an error message. */
export function plan(required, { bootstrap, live }) {
  if (bootstrap)
    return Object.fromEntries(required.map((n) => [n, GENERATED.includes(n) ? randomBytes(32).toString('base64url') : missing(n)]));
  const have = new Set(live.map((s) => s.name));
  const lost = GENERATED.filter((n) => required.includes(n) && !have.has(n));
  if (lost.length) throw new Error(`The live Worker lacks ${lost.join(', ')}; only a bootstrap run may make them.`);
  return Object.fromEntries(required.filter((n) => !have.has(n)).map((n) => [n, missing(n)]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, mode, liveFile] = process.argv.slice(2);
  const required = requiredSecrets(readFileSync(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8'));
  try {
    const live = mode === '--live' ? JSON.parse(readFileSync(liveFile, 'utf8')) : [];
    const values = plan(required, { bootstrap: mode === '--bootstrap', live });
    const names = Object.keys(values);
    if (names.length) writeFileSync(out, JSON.stringify(values), { mode: 0o600 });
    console.log(names.length ? `secrets file: ${names.join(', ')}` : 'secrets file: nothing to add');
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
