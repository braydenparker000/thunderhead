// The laws a mind session must hold on every SessionStart source (startup, resume, clear, compact):
// mind/CONSTITUTION.md whole, then the session's own section of mind/ROLES.md (CONSTITUTION.md rule 2).
// The SessionStart hook prints each from its own command (`laws`, `role`), each under its own cap.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const MIND_DIR = fileURLToPath(new URL('../../', import.meta.url));
const read = name => { try { return readFileSync(`${MIND_DIR}${name}`, 'utf8'); } catch { return ''; } };

/** The `## <role>` section of ROLES.md text, heading included; '' when the role has none. */
export function roleSection(roles, role) {
  const parts = roles.split(/\n(?=## )/);
  const hit = parts.find(p => p.split('\n', 1)[0].trim() === `## ${role}`);
  return hit ? hit.replace(/\n+$/, '') : '';
}

/** The constitution and the role's section, ending with a blank line; '' if neither can be read. */
export function lawsText(role) {
  const parts = [read('CONSTITUTION.md').replace(/\n+$/, ''), roleSection(read('ROLES.md'), role)].filter(Boolean);
  return parts.length ? `${parts.join('\n\n')}\n\n` : '';
}

/** The constitution alone, for the SessionStart `laws` command; '' if it cannot be read. */
export const constitutionText = () => read('CONSTITUTION.md').replace(/\n+$/, '');

/** The `## <name>` section of ROLES.md alone, for the SessionStart `role` command; '' if none. */
export const roleText = name => roleSection(read('ROLES.md'), name);
