// What makes a session tainted (RUNTIME.md §6.5, MEMORY.md §7): the first tool call that may take in
// text the owner did not write. The rule is an allowlist (P4 stage C.5): every call taints unless it
// is plainly local, so a channel nobody listed (an MCP tool, a new gh command, a URL in a variable)
// taints by default. Local means:
// - Edit, Write and the session's own bookkeeping tools;
// - Read, Grep and Glob of own files: the project (not node_modules, not the drop folder
//   $TMPDIR/th/ext/) and th's own briefing and state;
// - th, except `th file` (attachments are outside text, INJ-08);
// - git on this repository and its origin (origin holds the project's own commits, whose files the
//   rule already trusts); another remote, a URL, a clone or `-c` taints;
// - `gh pr create|merge|checks` and `gh run`; every other gh call reads issues, PRs or the API;
// - curl or wget to the Worker or the site by a literal URL (a host that can't be read taints);
// - npm test/run/ci and a plain npm install (the lockfile's packages), tsc, biome, vitest, playwright,
//   `wrangler types|dev`, node running a project script;
// - a short list of commands on own files, and commands that read no file at all.
// Pure: the same call always gives the same answer, and nothing here touches the network.
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {parseShell, unwrap} from './shell.mjs';
import {fetchHosts, gitSub, hostAllowed, thSub} from './rules.mjs';

/** @typedef {{cwd: string, tmpDir: string, ownHosts: string[], projectDir?: string}} TaintContext */
/** @typedef {{source: string, ref: string}} Taint */

const LOCAL_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'TodoWrite', 'BashOutput', 'KillShell', 'TaskOutput',
  'TaskStop', 'ExitPlanMode']);
const FILE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'LS']);
/** Commands that read no file's text: they print what they're given, or nothing. */
const QUIET_CMDS = new Set(['cd', 'pushd', 'popd', 'pwd', 'echo', 'printf', 'true', 'false', ':', 'test', '[', 'sleep', 'mkdir', 'touch',
  'rm', 'rmdir', 'chmod', 'date', 'which', 'type', 'basename', 'dirname', 'realpath', 'tee', 'export', 'set', 'exit', 'wait']);
/** Commands that read the files they name: local when every word that could be a path is an own file. */
const FILE_CMDS = new Set(['cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'tr', 'cut', 'grep', 'rg', 'sed', 'awk', 'find', 'ls', 'diff', 'jq',
  'stat', 'du', 'file', 'cp', 'mv', 'ln', 'nl', 'cmp']);
const GIT_LOCAL = new Set(['status', 'diff', 'log', 'show', 'add', 'commit', 'checkout', 'switch', 'branch', 'restore', 'reset', 'stash',
  'mv', 'rm', 'rev-parse', 'rev-list', 'merge-base', 'merge', 'rebase', 'cherry-pick', 'revert', 'tag', 'blame', 'grep', 'ls-files',
  'ls-tree', 'cat-file', 'describe', 'shortlog', 'reflog', 'config', 'worktree', 'push', 'init', 'clean', 'diff-tree', 'show-ref',
  'symbolic-ref', 'name-rev', 'version', 'fetch', 'pull']);
const LOCAL_BINS = new Set(['tsc', 'biome', 'vitest', 'playwright']);

const inside = (path, dir) => {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** A path whose text the owner or the mind wrote: the project (not node_modules, not the drop
 * folder) and th's own briefing and state. */
function ownFile(p, ctx) {
  const path = expand(p, ctx);
  const th = join(ctx.tmpDir, 'th');
  if (path === null || inside(path, join(th, 'ext')) || path.split(sep).includes('node_modules')) return false;
  if (path === join(th, 'brief.md') || inside(path, join(th, 'state'))) return true;
  return inside(path, ctx.projectDir ?? ctx.cwd);
}

/** The absolute path a word names (null for ~, which is not the project). */
function expand(p, ctx) {
  const word = String(p);
  if (word.startsWith('~')) return null;
  return resolve(ctx.cwd, word.replace(/^\$\{?TMPDIR\}?/, ctx.tmpDir).replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, ctx.projectDir ?? ctx.cwd));
}

const positionals = args => args.filter(a => !a.startsWith('-'));

/** git: local unless it names a remote other than origin, a URL, or runs config from the command line. */
function gitTaints(args, ctx) {
  const {sub, rest, dir, elsewhere, config} = gitSub(args);
  if (config || elsewhere || (dir && !ownFile(dir, ctx)) || !GIT_LOCAL.has(sub)) return true;
  if (sub === 'fetch' || sub === 'pull' || sub === 'push') {
    const pos = positionals(rest);
    return (pos.length > 0 && pos[0] !== 'origin') || rest.some(a => /^--(all|multiple)$/.test(a));
  }
  return false;
}

/** @returns {Taint | null} */
function bashTaint(command, ctx) {
  for (const seg of parseShell(command)) {
    const {cmd, args} = unwrap(seg.words);
    if (!cmd) continue;
    // Later relative paths resolve from where a cd went (home, or a cd that can't be read: the root, not the project).
    if (cmd === 'cd' || cmd === 'pushd') {
      const to = positionals(args)[0];
      ctx = {...ctx, cwd: (to === undefined ? null : expand(to, ctx)) ?? sep};
      continue;
    }
    if (seg.inputs.some(p => !ownFile(p, ctx))) return {source: 'Bash', ref: 'file'};
    const th = thSub({cmd, args});
    if (th) {
      if (th.sub === 'file') return {source: 'th file', ref: 'file'};
      continue;
    }
    if (cmd === 'curl' || cmd === 'wget') {
      const hosts = fetchHosts(cmd, args);
      if (!hosts) return {source: cmd, ref: 'url'}; // the host can't be read
      const outside = hosts.find(h => !hostAllowed(h, ctx.ownHosts));
      if (outside) return {source: cmd, ref: `https://${outside}/`};
      continue;
    }
    if (cmd === 'gh') {
      if ((args[0] === 'pr' && ['create', 'merge', 'checks'].includes(args[1])) || args[0] === 'run') continue;
      return {source: 'gh', ref: 'comment'};
    }
    if (cmd === 'git') {
      if (gitTaints(args, ctx)) return {source: 'git', ref: 'comment'};
      continue;
    }
    if (cmd === 'npm') {
      const [sub, ...more] = positionals(args);
      if (['test', 't', 'run', 'run-script', 'ci'].includes(sub) || ((sub === 'install' || sub === 'i') && !more.length)) continue;
      return {source: 'npm', ref: ''};
    }
    if (LOCAL_BINS.has(cmd) || (cmd === 'wrangler' && ['types', 'dev'].includes(positionals(args)[0]))) continue;
    if (cmd === 'node' || cmd === 'nodejs') {
      if (args.some(a => /^(-e|-p|--eval|--print)$/.test(a) || /^--(eval|print)=/.test(a))) return {source: 'node', ref: ''};
      const script = positionals(args)[0];
      if (script === undefined || ownFile(script, ctx)) continue;
      return {source: 'node', ref: 'file'};
    }
    if (QUIET_CMDS.has(cmd)) continue;
    if (!FILE_CMDS.has(cmd)) return {source: cmd, ref: ''};
    // find can run another command on what it finds; that command isn't parsed here.
    if (cmd === 'find' && args.some(a => /^-(exec|execdir|ok|okdir)$/.test(a))) return {source: 'find', ref: ''};
    // Every word that could be a path must be an own file (a pattern or text resolves inside the project).
    if (positionals(args).some(a => !ownFile(a, ctx))) return {source: cmd, ref: 'file'};
  }
  return null;
}

/**
 * @param {{tool_name?: string, tool_input?: Record<string, any>}} input
 * @param {TaintContext} ctx
 * @returns {Taint | null} what tainted the session, or null.
 */
export function taintOf(input, ctx) {
  const tool = input?.tool_name ?? '';
  const ti = input?.tool_input ?? {};
  if (LOCAL_TOOLS.has(tool)) return null;
  if (FILE_TOOLS.has(tool)) {
    const pattern = tool === 'Glob' && typeof ti.pattern === 'string' ? ti.pattern : null;
    const where = [ti.file_path ?? ti.notebook_path ?? ti.path ?? ctx.cwd];
    // A Glob pattern can climb out of its folder (an absolute pattern, or ..).
    if (pattern && (isAbsolute(pattern) || pattern.split('/').includes('..'))) where.push(resolve(String(where[0]), pattern.replace(/[*?[{].*$/, '')));
    return where.every(p => typeof p === 'string' && ownFile(p, ctx)) ? null : {source: tool, ref: 'file'};
  }
  if (tool === 'Bash') return bashTaint(String(ti.command ?? ''), ctx);
  if (tool === 'WebFetch') return {source: 'WebFetch', ref: typeof ti.url === 'string' ? ti.url : 'url'};
  if (tool === 'Task' || tool === 'Agent') return {source: ti.subagent_type === 'reader' ? 'reader' : 'subagent', ref: 'file'};
  return {source: tool.startsWith('mcp__') ? 'mcp' : (tool || 'unknown tool').slice(0, 40), ref: ''};
}
