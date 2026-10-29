// Test helpers: start the fake Worker, run `th` and the hooks as real child processes with a clean,
// proxy-free environment and a fresh $TMPDIR per call site.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TOKENS, createFake} from './fake-worker.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TH = join(ROOT, 'mind/cli/th.mjs');
export const HOOK = name => join(ROOT, `mind/hooks/${name}.mjs`);
export {TOKENS};

export const startFake = (options = {}) => createFake(options).start();
export const freshTmp = () => mkdtempSync(join(tmpdir(), 'th-test-'));

/** A minimal environment: no proxy variables, no inherited secrets. */
export function env(fake, extra = {}) {
  const base = {PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: freshTmp(), TH_API: fake ? fake.url : 'http://127.0.0.1:9',
    TH_ROLE: 'chat', TH_RETRY_BASE_MS: '5', CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_test_session_1',
    // The fake also serves later phases' routes, so the contract's build check is lifted here;
    // th-contract.test.mjs checks the not_built answer itself.
    TH_ALLOW_UNBUILT: '1'};
  if (!('TH_TOKEN' in extra)) base.TH_TOKEN = TOKENS[extra.TH_ROLE || 'chat'];
  const out = {...base, ...extra};
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete out[k];
  return out;
}

/**
 * Runs a node script asynchronously (the fake Worker lives in this process, so never spawnSync).
 * @returns {Promise<{code: number, stdout: string, stderr: string, json: any, ms: number}>}
 */
export function runNode(script, args, {env: e, input} = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], {env: e, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      let json = null;
      try { json = JSON.parse(stdout.trim().split('\n').pop() || 'null'); } catch { /* not JSON */ }
      resolve({code, stdout, stderr, json, ms: Date.now() - started});
    });
    child.stdin.end(input ?? '');
  });
}

export const th = (args, e, input) => runNode(TH, args, {env: e, input});
export const hook = (name, payload, e) => runNode(HOOK(name), [], {env: e, input: typeof payload === 'string' ? payload : JSON.stringify(payload)});

/** The error code th printed on stderr. */
export function errCode(result) {
  try { return JSON.parse(result.stderr.trim().split('\n').pop()).error.code; } catch { return null; }
}
