// What makes a session tainted (RUNTIME.md §6.5, MEMORY.md §7): the first tool call that may take in
// text the owner did not write. The rule is an allowlist (P4 stage C.5): every tool call taints
// unless it is plainly local. Local means: editing and writing; reading, grepping and globbing the
// project's own files (not node_modules, not the drop folder $TMPDIR/th/ext/, nothing outside the
// project but th's own briefing and state); git on local refs; th except `th file`; `gh pr
// create|merge|checks` and `gh run`; curl or wget to the Worker or the site by a literal URL; and a
// short list of local commands on own files. Everything else, MCP tools, subagents and any command
// whose target can't be read, taints. Pure: nothing here touches the network.
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {parseShell, unwrap} from './shell.mjs';
import {fetchHosts, hostAllowed, thSub} from './rules.mjs';

/** @typedef {{cwd: string, tmpDir: string, ownHosts: string[], projectDir?: string}} TaintContext */
/** @typedef {{source: string, ref: string}} Taint */

const LOCAL_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'TodoWrite', 'BashOutput', 'KillShell', 'TaskOutput',
  'TaskStop', 'ExitPlanMode']);
const FILE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'LS']);
/** Commands that print nothing but what they're given or the project's own files. */
const LOCAL_CMDS = new Set(['cd', 'pwd', 'echo', 'printf', 'true', 'false', 'test', '[', 'sleep', 'mkdir', 'touch', 'rm', 'rmdir', 'mv',
  'cp', 'ln', 'chmod', 'date', 'which', 'command', 'type', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'tr', 'cut', 'grep', 'rg',
  'sed', 'awk', 'find', 'ls', 'diff', 'jq', 'tee', 'basename', 'dirname', 'realpath', 'xargs', 'stat', 'du', 'file', 'git']);
const LOCAL_NPX = new Set(['tsc', 'biome', 'vitest', 'wrangler', 'playwright']);
const GIT_REMOTE_SUBS = new Set(['fetch', 'pull', 'clone', 'ls-remote', 'submodule', 'remote', 'request-pull']);

const inside = (path, dir) => {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** A path whose text the owner or the mind wrote: the project (not node_modules, not the drop
 * folder) and th's own briefing and state. */
function ownFile(p, ctx) {
  const path = resolve(ctx.cwd, String(p).replace(/^\$\{?TMPDIR\}?/, ctx.tmpDir).replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, ctx.projectDir ?? ctx.cwd));
  const th = join(ctx.tmpDir, 'th');
  if (inside(path, join(th, 'ext')) || path.split(sep).includes('node_modules')) return false;
  if (path === join(th, 'brief.md') || inside(path, join(th, 'state'))) return true;
  return inside(path, ctx.projectDir ?? ctx.cwd);
}

const positionals = args => args.filter(a => !a.startsWith('-'));

/** @returns {Taint | null} */
function bashTaint(command, ctx) {
  for (const seg of parseShell(command)) {
    const {cmd, args} = unwrap(seg.words);
    if (!cmd) continue;
    if (seg.inputs.some(p => !ownFile(p, ctx))) return {source: 'Bash', ref: 'file'};
    const th = thSub({cmd, args});
    if (th) {
      if (th.sub === 'file') return {source: 'th file', ref: 'file'};
      continue;
    }
    if (cmd === 'curl' || cmd === 'wget') {
      const hosts = fetchHosts(cmd, args);
      const outside = hosts ? hosts.find(h => !hostAllowed(h, ctx.ownHosts)) : '(a host that cannot be read)';
      if (outside) return {source: cmd, ref: hosts ? `https://${outside}/` : 'url'};
      continue;
    }
    if (cmd === 'gh') {
      if ((args[0] === 'pr' && ['create', 'merge', 'checks'].includes(args[1])) || args[0] === 'run') continue;
      return {source: 'gh', ref: 'comment'};
    }
    if (cmd === 'npm' && ['test', 'run', 'ci', 'install'].includes(args[0])) continue;
    if (cmd === 'npx' && LOCAL_NPX.has(positionals(args)[0] ?? '')) continue;
    if (cmd === 'node' || cmd === 'nodejs') {
      if (args.some(a => /^(-e|-p|--eval|--print)$/.test(a))) return {source: 'node', ref: ''};
      const script = positionals(args)[0];
      if (script === undefined || ownFile(script, ctx)) continue;
      return {source: 'node', ref: 'file'};
    }
    if (!LOCAL_CMDS.has(cmd)) return {source: cmd, ref: ''};
    if (cmd === 'git') {
      const sub = positionals(args)[0] ?? '';
      if (GIT_REMOTE_SUBS.has(sub) || args.some(a => /^(origin|upstream)\/|refs\/remotes\/|FETCH_HEAD/.test(a))) return {source: 'git', ref: 'comment'};
      continue;
    }
    // Every word that could be a path must be an own file (a pattern or text resolves inside the project).
    if (positionals(args).some(a => a.startsWith('~') || !ownFile(a, ctx))) return {source: cmd, ref: 'file'};
  }
  return null;
}

/** @returns {Taint | null} what tainted the session, or null. */
export function taintOf(input, ctx) {
  const tool = input?.tool_name ?? '';
  const ti = input?.tool_input ?? {};
  if (LOCAL_TOOLS.has(tool)) return null;
  if (FILE_TOOLS.has(tool)) {
    const where = [ti.file_path ?? ti.notebook_path ?? ti.path ?? ctx.cwd, tool === 'Glob' && isAbsolute(String(ti.pattern ?? '')) ? ti.pattern : null]
      .filter(p => typeof p === 'string');
    return where.every(p => ownFile(p, ctx)) ? null : {source: tool, ref: 'file'};
  }
  if (tool === 'Bash') return bashTaint(String(ti.command ?? ''), ctx);
  if (tool === 'WebFetch') return {source: 'WebFetch', ref: typeof ti.url === 'string' ? ti.url : 'url'};
  if (tool === 'Task' || tool === 'Agent') return {source: ti.subagent_type === 'reader' ? 'reader' : 'subagent', ref: 'file'};
  return {source: tool.startsWith('mcp__') ? 'mcp' : tool || 'unknown tool', ref: ''};
}
