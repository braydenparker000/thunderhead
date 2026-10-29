#!/usr/bin/env node
// th: how a mind session (chat, night, reflex) talks to the Worker. Spec: docs/mind/RUNTIME.md §5.
// `th help` lists every command and, from the contract (mind/cli/contract.json), the routes, verbs
// and surface kinds this Worker build offers the role. Commands of later phases are here already;
// th answers exit 8 `not_built` until their routes are built, so the procedure never changes.
//
// Environment: TH_API (Worker base URL), TH_ROLE (chat|night|reflex), TH_TOKEN (optional: in cloud
// sessions the network secret adds Authorization on the way out, so it is normally unset).
// Output: one line of compact JSON on stdout (help and briefings print text); errors as
// {"error":{code,message,request_id}} on stderr. Exit codes: RUNTIME.md §5.2 (lib/io.mjs).
import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseArgs} from './lib/args.mjs';
import {EXIT, invalid, out, printError} from './lib/io.mjs';
import {brief} from './lib/brief.mjs';
import {wait} from './lib/wait.mjs';
import {helpText} from './lib/help.mjs';
import * as conv from './lib/conv.mjs';
import * as memory from './lib/memory.mjs';
import * as act from './lib/act.mjs';

const withFlags = (fn, spec) => argv => fn(parseArgs(argv, spec).flags);

/** @type {Record<string, (argv: string[]) => Promise<number|void>>} */
export const COMMANDS = {
  brief: withFlags(brief, {bool: ['claim', 'full', 'json']}),
  wait: withFlags(wait),
  say: conv.say, amend: conv.amend, history: conv.history, file: conv.file, status: conv.status,
  title: conv.title, note: conv.note, pending: conv.pending, taint: conv.taint, health: conv.health,
  errors: conv.errors, ledger: conv.ledger, undo: conv.undo, get: conv.get,
  search: memory.recall, recall: memory.recall, remember: memory.remember, confirm: memory.confirm,
  supersede: memory.supersede, forget: memory.forget, thread: memory.thread, day: memory.day,
  daynote: memory.daynote, facts: memory.facts,
  propose: act.propose, decide: act.decide, verb: act.verb, order: act.order, surface: act.surface,
  push: act.push, night: act.night,
  help: async argv => { out(helpText(argv[0])); },
};

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  const [command, ...tail] = argv;
  try {
    const run = COMMANDS[command];
    if (!run) throw invalid(`unknown command ${command ? `"${command}"` : '(none)'}; run th help`);
    const code = await run(tail);
    return typeof code === 'number' ? code : EXIT.ok;
  } catch (error) {
    return printError(error);
  }
}

/**
 * True when th must restart itself so fetch goes through the session's proxy: Node's fetch ignores
 * HTTPS_PROXY unless NODE_USE_ENV_PROXY=1, and without the proxy the request arrives without the token.
 */
export function needsProxyRestart(env = process.env) {
  if (!(env.HTTPS_PROXY || env.https_proxy) || env.NODE_USE_ENV_PROXY === '1') return false;
  try {
    const host = new URL(env.TH_API || '').hostname;
    return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  } catch { return true; }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (process.argv[1] && isMain()) {
  if (needsProxyRestart()) {
    const child = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.execArgv, ...process.argv.slice(1)],
      {stdio: 'inherit', env: {...process.env, NODE_USE_ENV_PROXY: '1'}});
    process.exit(child.status ?? EXIT.unexpected);
  }
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
