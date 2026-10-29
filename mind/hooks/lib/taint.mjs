// What makes a session tainted (RUNTIME.md §6.5, MEMORY.md §7): the first tool call that takes in
// text the owner did not write. Pure: the same call always gives the same answer, and nothing here
// touches the network. WebFetch and WebSearch; `th file` (attachments are outside text, INJ-08); a
// Read of the eval and reader drop folder $TMPDIR/th/ext/; `gh` reading comments; curl or wget to a
// host that is not the Worker or the site.
import {join, relative, resolve, isAbsolute} from 'node:path';
import {parseShell, unwrap} from './shell.mjs';
import {fetchHosts, hostAllowed, thSub} from './rules.mjs';

/** @typedef {{cwd: string, tmpDir: string, ownHosts: string[]}} TaintContext */

const inside = (path, dir) => {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** @returns {{source: string, ref: string} | null} what tainted the session, or null. */
export function taintOf(input, ctx) {
  const tool = input?.tool_name ?? '';
  const ti = input?.tool_input ?? {};
  if (tool === 'WebFetch') return {source: 'WebFetch', ref: typeof ti.url === 'string' ? ti.url : ''};
  if (tool === 'WebSearch') return {source: 'WebSearch', ref: ''};
  if (tool === 'Read' && typeof ti.file_path === 'string') {
    const path = resolve(ctx.cwd, ti.file_path.replace(/^\$\{?TMPDIR\}?/, ctx.tmpDir));
    if (inside(path, join(ctx.tmpDir, 'th', 'ext'))) return {source: 'Read', ref: 'file'};
  }
  if (tool !== 'Bash') return null;
  for (const seg of parseShell(String(ti.command ?? ''))) {
    const {cmd, args} = unwrap(seg.words);
    if (thSub({cmd, args})?.sub === 'file') return {source: 'th file', ref: 'file'};
    if (cmd === 'gh' && args.some(a => /comments/.test(a))) return {source: 'gh', ref: 'comment'};
    if (cmd === 'curl' || cmd === 'wget') {
      const hosts = fetchHosts(cmd, args) ?? [];
      const outside = hosts.find(h => !hostAllowed(h, ctx.ownHosts));
      if (outside) return {source: cmd, ref: `https://${outside}/`};
    }
  }
  return null;
}
