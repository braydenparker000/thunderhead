// `th skill [<name>]` (RUNTIME.md §5.3): role knowledge on demand. A name prints mind/skills/<name>.md
// (what the app or area is, what you can read and do there, what you must not do); none lists them.
// The names come from the contract (shared/contract/skills.ts), the same list the briefing's
// section 8 gives; the files are in the repository the session runs from, so nothing is fetched.
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {repoRoot} from './brief.mjs';
import {CONTRACT} from './contract.mjs';
import {invalid, out} from './io.mjs';

/** The skill files' folder. */
export const skillsDir = (root = repoRoot()) => join(root, 'mind', 'skills');

/** @param {string[]} argv */
export async function skill(argv) {
  const names = CONTRACT.skills.names;
  const [name, ...rest] = argv;
  if (rest.length || name?.startsWith('-')) throw invalid('usage: th skill [<name>]');
  if (!name) return out(`Skills (th skill <name>): ${names.join(', ')}`);
  if (!names.includes(name)) throw invalid(`no skill "${name}"; th skill lists them: ${names.join(', ')}`);
  const file = join(skillsDir(), `${name}.md`);
  if (!existsSync(file)) throw invalid(`the skill file for "${name}" is missing from this checkout`);
  out(readFileSync(file, 'utf8').trimEnd());
}
