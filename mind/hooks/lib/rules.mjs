// Per-role deny rules for the PreToolUse hook (RUNTIME.md §6.4). Pure and deterministic: the same
// tool call, role and context always give the same answer, and nothing here touches the network.
// What needs git or the Worker (the protected paths a push carries, whether the owner approved a
// change to them) comes in through the context, computed by pre-tool.mjs.
// Deny only, never "ask": an ask would stall an unattended run waiting for a human.
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {parseShell, unwrap} from './shell.mjs';

export const ROLES = ['chat', 'night', 'reflex'];
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'NotebookRead'];
const DEV_PATHS = ['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty'];

/**
 * @typedef {{role: string, cwd: string, projectDir: string, tmpDir: string, allowedHosts: string[], tainted?: boolean,
 *   headSubject?: () => string, approved?: (paths: string[], base?: string) => boolean,
 *   pushProtected?: (sources: string[]) => {base: string, paths: string[]}[]}} Context
 * `approved`: the owner approved changing these repository-relative protected paths on a branch
 * from `base` (default: the current branch's; `th approved`); missing means never. `pushProtected`:
 * for each source a push sends (HEAD when it names none), its base and the protected paths its
 * commits change, renames counted as both paths; it throws when a source can't be resolved.
 * `tainted`: this session read outside text (th's state).
 */

/** True for mind/CONSTITUTION.md, .claude/**, mind/hooks/**, .github/** inside the project. */
export function isProtected(path, ctx) {
  const rel = projectRelative(path, ctx);
  if (rel === null) return false;
  const r = rel.split(sep).join('/');
  return r === 'mind/CONSTITUTION.md' || /^(\.claude|mind\/hooks|\.github)(\/|$)/.test(r);
}

/** Protected paths written without the owner's approval (RUNTIME.md §6.4, `repo.change` cards). */
function unapproved(paths, ctx) {
  const prot = paths.filter(p => isProtected(p, ctx));
  if (!prot.length) return null;
  const rels = prot.map(p => projectRelative(p, ctx).split(sep).join('/'));
  return ctx.approved?.(rels) ? null : prot[0];
}

function projectRelative(path, ctx) {
  const expanded = String(path).replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, ctx.projectDir);
  const rel = relative(ctx.projectDir, resolve(ctx.cwd, expanded));
  return rel.startsWith('..') || isAbsolute(rel) ? null : rel;
}

const inside = (path, dir, ctx) => {
  const abs = resolve(ctx.cwd, String(path).replace(/^\$\{?TMPDIR\}?/, ctx.tmpDir));
  return abs === dir || abs.startsWith(dir + sep);
};

const insideTmp = (path, ctx) => {
  const abs = resolve(ctx.cwd, String(path).replace(/^\$\{?TMPDIR\}?/, ctx.tmpDir));
  return DEV_PATHS.includes(abs) || abs === ctx.tmpDir || abs.startsWith(ctx.tmpDir.endsWith(sep) ? ctx.tmpDir : ctx.tmpDir + sep);
};

const isEnvFile = word => /(^|[/=])\.env[^/]*$/.test(String(word));
const isProcEnviron = text => /\/proc\/[^\s]*environ/.test(text);
const positionals = args => args.filter(a => !a.startsWith('-'));

/** Paths a simple command writes to (redirects, tee, rm, mv, cp dest, sed -i, dd of=, git rm/mv/restore/checkout). */
export function writtenPaths({cmd, args}, redirects) {
  const paths = [...redirects];
  const pos = positionals(args);
  if (['tee', 'rm', 'rmdir', 'touch', 'truncate', 'chmod', 'chown', 'shred', 'unlink', 'mkdir', 'mv'].includes(cmd)) paths.push(...pos);
  if (['cp', 'install', 'ln', 'rsync', 'scp'].includes(cmd)) {
    const t = args.indexOf('-t');
    if (t >= 0 && args[t + 1]) paths.push(args[t + 1]); else if (pos.length) paths.push(pos[pos.length - 1]);
  }
  if ((cmd === 'sed' || cmd === 'perl') && args.some(a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) paths.push(...pos);
  if (cmd === 'dd') paths.push(...args.filter(a => a.startsWith('of=')).map(a => a.slice(3)));
  if (cmd === 'git' && ['rm', 'mv', 'restore', 'checkout'].includes(gitSub(args).sub)) paths.push(...positionals(gitSub(args).rest));
  return paths;
}

/** git's subcommand after global options (-C dir, -c k=v, --git-dir=…). */
function gitSub(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(args[i]) ? 2 : 1;
  return {sub: args[i] ?? '', rest: args.slice(i + 1)};
}

/** Parses `git push` arguments: force, delete, and the destination refs. */
export function gitPush(args) {
  const {sub, rest} = gitSub(args);
  if (sub !== 'push') return null;
  let force = false, del = false, all = false;
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-o' || a === '--push-option' || a === '--repo' || a === '--receive-pack' || a === '--exec') { i++; continue; }
    if (/^--force(-with-lease|-if-includes)?(=|$)/.test(a) || a === '--mirror' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) force = true;
    if (a === '--delete' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(a)) del = true;
    if (['--all', '--branches', '--tags', '--mirror', '--follow-tags'].includes(a)) all = true;
    if (!a.startsWith('-')) pos.push(a);
  }
  const refspecs = pos.slice(1);
  for (const spec of refspecs) {
    if (spec.startsWith('+')) force = true;
    if (spec.startsWith(':')) del = true;
  }
  const dests = refspecs.map(s => s.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, ''));
  // What each refspec sends: its part before the colon (the whole spec when there is none).
  const sources = refspecs.map(s => s.replace(/^\+/, '').split(':')[0]).filter(Boolean);
  return {force, del, all, dests, sources, implicit: refspecs.length === 0};
}

/** The th subcommand when the simple command runs th (`th …`, `node …/th.mjs …`). */
export function thSub({cmd, args}) {
  if (cmd === 'th') return {sub: args[0] ?? '', rest: args.slice(1)};
  if ((cmd === 'node' || cmd === 'nodejs') && /(^|\/)th\.mjs$/.test(args.find(a => !a.startsWith('-')) ?? '')) {
    const k = args.findIndex(a => /(^|\/)th\.mjs$/.test(a));
    return {sub: args[k + 1] ?? '', rest: args.slice(k + 2)};
  }
  return null;
}

function hostOf(arg) {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) ? arg : `https://${arg}`);
    return url.hostname.toLowerCase();
  } catch { return null; }
}

const CURL_ARG_OPTS = new Set(['-o', '-d', '-H', '-X', '-u', '-A', '-e', '-T', '-F', '-b', '-c', '-K', '-w', '-x', '-r', '-m', '-E', '-U', '-P', '-O',
  '--output', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--header', '--request', '--user', '--user-agent', '--referer',
  '--upload-file', '--form', '--cookie', '--cookie-jar', '--config', '--write-out', '--proxy', '--max-time', '--connect-timeout',
  '--retry', '--output-document', '--output-file', '--directory-prefix']);

/** Hosts a curl/wget call reaches; null when no literal URL can be found. */
export function fetchHosts(cmd, args) {
  const hosts = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (cmd === 'wget' && a === '-O') { i++; continue; }
      if (CURL_ARG_OPTS.has(a) && !(cmd === 'curl' && a === '-O')) i++;
      continue;
    }
    if (a.includes('://') || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(a)) { const h = hostOf(a); if (h) hosts.push(h); }
  }
  return hosts.length ? hosts : null;
}

export function hostAllowed(host, allowed) {
  return allowed.some(a => (a.startsWith('*.') ? host.endsWith(a.slice(1)) : host === a));
}

/** @returns {string|null} a deny reason for one simple command, or null. */
function checkSegment(seg, ctx) {
  const {cmd, args, bareEnv} = unwrap(seg.words);
  const all = [...seg.words, ...seg.redirects, ...seg.inputs];
  if (cmd === 'printenv' || bareEnv) return 'Printing the environment is not allowed in a mind session.';
  if ((cmd === 'export' && (!args.length || args.includes('-p'))) || (cmd === 'set' && !args.length) ||
      ((cmd === 'declare' || cmd === 'typeset') && args.some(a => /^-[a-zA-Z]*[xp]/.test(a)))) return 'Printing the environment is not allowed in a mind session.';
  if (all.some(isEnvFile)) return 'Reading or writing .env files is not allowed in a mind session.';
  if (all.some(isProcEnviron)) return 'Reading process environments is not allowed.';
  if (cmd === 'curl' || cmd === 'wget') {
    const hosts = fetchHosts(cmd, args);
    if (!hosts) return `${cmd} needs a literal URL so its host can be checked.`;
    const bad = hosts.find(h => !hostAllowed(h, ctx.allowedHosts));
    if (bad) return `${cmd} to ${bad} is outside the environment's host list.`;
  }
  if (cmd === 'wrangler' && (args.some(a => a === 'deploy' || a === 'secret' || a === 'publish') || (args.includes('dev') && args.includes('--remote'))))
    return 'wrangler deploy/secret/dev --remote is not allowed: deploys go through the workflows, and no Cloudflare credential is in a session.';
  if (cmd === 'az') return 'Azure CLI is not allowed in a mind session.';
  if (cmd === 'gh' && args[0] === 'repo' && (args[1] === 'delete' || args[1] === 'edit')) return 'gh repo delete/edit is not allowed.';
  if (cmd === 'gh' && args[0] === 'api' && ghApiWrites(args.slice(1)))
    return 'gh api may not write repository contents, git objects or refs: changes go through commits and pushes the hook checks.';
  const push = cmd === 'git' ? gitPush(args) : null;
  if (push?.force) return 'Force pushes are never allowed.';
  if (push?.del) return 'Deleting a remote branch is not allowed.';
  if (push?.all) return 'Push one branch at a time, named explicitly (no --all, --branches, --tags or --mirror).';
  const writes = writtenPaths({cmd, args}, seg.redirects);
  const prot = unapproved(writes, ctx);
  if (prot) return protectedReason(prot);

  const th = thSub({cmd, args});
  if (ctx.role === 'night') {
    if (th?.sub === 'say' && !kindIsError(th.rest)) return 'The night role may not post chat messages (only --kind error).';
    if (th?.sub === 'push') return 'The night role may not send pushes.';
    if (push && (push.implicit || push.dests.includes('main'))) return 'The night role may not push to main (name a claude/<slug> branch explicitly; only agreed work ships, through chat).';
  }
  if (ctx.role === 'reflex') {
    if (th && ['remember', 'supersede', 'confirm', 'facts'].includes(th.sub)) return 'The reflex role may not write memory.';
    if (push && (push.implicit || push.dests.includes('main')) && !isRevert(ctx)) return 'The reflex role may push to main only a revert commit (name the branch explicitly).';
    const outside = writes.find(p => !insideTmp(p, ctx));
    if (outside) return `The reflex role may write files only under $TMPDIR (not ${outside}).`;
  }
  // Last, as it asks git: what the commits being pushed change.
  if (push) {
    for (const c of ctx.pushProtected?.(push.sources) ?? [])
      if (c.paths.length && !ctx.approved?.(c.paths, c.base))
        return `This push changes protected paths (${c.paths.join(', ')}) without the owner's approval. Raise a card: th propose --class access --spec '{"op":"repo.change","args":{"paths":[…],"base":"${c.base}"}}'.`;
  }
  return null;
}

/** A `gh api` call that writes contents, git objects or refs (any method but GET, or fields, which make it a POST). */
function ghApiWrites(args) {
  let method = 'GET';
  let path = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') method = String(args[++i] ?? '').toUpperCase();
    else if (/^--method=/.test(a)) method = a.slice(9).toUpperCase();
    else if (/^-X./.test(a)) method = a.slice(2).toUpperCase();
    else if (['-f', '-F', '--field', '--raw-field', '--input'].includes(a)) { if (method === 'GET') method = 'POST'; i++; }
    else if (a === '-H' || a === '--header' || a === '-q' || a === '--jq' || a === '-t' || a === '--template' || a === '--hostname') i++;
    else if (!a.startsWith('-') && !path) path = a;
  }
  return method !== 'GET' && /(^|\/)repos\/[^/]+\/[^/]+\/(contents|git)(\/|$)/.test(path.replace(/^\//, ''));
}

const kindIsError = rest => rest.some((a, i) => a === '--kind=error' || (a === '--kind' && rest[i + 1] === 'error'));
const isRevert = ctx => { try { return /^Revert "/.test(ctx.headSubject?.() ?? ''); } catch { return false; } };
const protectedReason = path => `${path} is a protected path (mind/CONSTITUTION.md, .claude/**, mind/hooks/**, .github/**). Changing it needs the owner's approval for this branch's base: th propose --class access --spec '{"op":"repo.change","args":{"paths":[…],"base":"<commit>"}}', then th approved checks it.`;

/**
 * @param {{tool_name?: string, tool_input?: Record<string, any>}} input
 * @param {Context} ctx
 * @returns {string|null} deny reason, or null to let the normal permission flow decide
 */
export function decide(input, ctx) {
  if (!ctx.role) return null; // not a mind session (the owner's own Claude Code)
  if (!ROLES.includes(ctx.role)) return `Unknown TH_ROLE "${ctx.role}": every tool is denied until it is chat, night or reflex.`;
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  if (tool === 'Bash') {
    for (const seg of parseShell(String(ti.command ?? ''))) {
      const reason = checkSegment(seg, ctx);
      if (reason) return reason;
    }
    return null;
  }
  const path = ti.file_path ?? ti.notebook_path ?? ti.path;
  if (READ_TOOLS.includes(tool) || WRITE_TOOLS.includes(tool)) {
    const targets = [path, ti.glob, ti.pattern && tool === 'Glob' ? ti.pattern : undefined].filter(p => typeof p === 'string');
    if (targets.some(p => isEnvFile(p) || isProcEnviron(p))) return 'Reading or writing .env files and process environments is not allowed.';
  }
  if (WRITE_TOOLS.includes(tool) && typeof path === 'string') {
    if (unapproved([path], ctx)) return protectedReason(path);
    if (ctx.role === 'reflex' && !insideTmp(path, ctx)) return `The reflex role may write files only under $TMPDIR (not ${path}).`;
  }
  // The reader subagent (when Claude Code names it) reads only the drop folder and the web.
  if (input.agent_type === 'reader' && READ_TOOLS.includes(tool)) {
    const where = [path, tool === 'Glob' ? ti.pattern : undefined].filter(p => typeof p === 'string');
    if (!where.length || where.some(p => !inside(p, `${ctx.tmpDir}${sep}th${sep}ext`, ctx)))
      return 'The reader reads only the drop folder $TMPDIR/th/ext/ and the web.';
  }
  if (tool === 'WebFetch' && typeof ti.url === 'string') {
    const host = hostOf(ti.url);
    if (ctx.role === 'reflex' && host && !hostAllowed(host, ctx.allowedHosts)) return `The reflex role may not fetch ${host}.`;
    // Outside text could have asked for it: once tainted (and always for the reader), no URL carries data out.
    if ((ctx.tainted || input.agent_type === 'reader') && /[?#]/.test(ti.url.replace(/#$/, '')))
      return 'A tainted session (or the reader) may not fetch a URL with a query or fragment: it could carry data out.';
  }
  return null;
}
