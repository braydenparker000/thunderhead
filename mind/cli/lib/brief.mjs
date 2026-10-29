// `th brief [--claim] [--full] [--section <n>] [--json]` and the briefing truncation rule
// shared with the SessionStart hook (RUNTIME.md §6.1, MEMORY.md §9).
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {VERSION, invalid, out} from './io.mjs';
import {request} from './http.mjs';
import {getState, setState, writeThFile} from './state.mjs';
import {sha256, uuidv7} from './ids.mjs';

export const CORE_CAP = 9500;
export const CUT_MARKER = '(+cut: th brief --full)';
/** A section starts at a line beginning with `## ` (the Worker's section marker). */
const SECTION_START = /^## /;

export const repoRoot = () => fileURLToPath(new URL('../../../', import.meta.url));

/** sha256 of mind/CONSTITUTION.md (the constitution pin), or "none" if the file is missing. */
export function constitutionSha(root = repoRoot()) {
  const path = join(root, 'mind', 'CONSTITUTION.md');
  return existsSync(path) ? sha256(readFileSync(path)) : 'none';
}

/**
 * Caps a briefing at `cap` characters. Cuts only between whole sections; the cut marker ends the text.
 * If even the first section does not fit, falls back to the last full line that fits (RUNTIME.md §6.1).
 */
export function truncateBriefing(text, cap = CORE_CAP) {
  if (text.length <= cap) return text;
  const budget = cap - CUT_MARKER.length - 1;
  const chunks = text.split(/\n(?=## )/);
  let kept = '';
  for (const chunk of chunks) {
    const next = kept ? `${kept}\n${chunk}` : chunk;
    if (next.length > budget) break;
    kept = next;
  }
  if (!kept.trim() || !/(^|\n)## /.test(kept)) {
    // No whole section fits: last full line under the budget.
    const lines = text.split('\n');
    kept = '';
    for (const line of lines) {
      const next = kept ? `${kept}\n${line}` : line;
      if (next.length > budget) break;
      kept = next;
    }
    if (!kept) kept = text.slice(0, budget);
  }
  return `${kept.replace(/\n+$/, '')}\n${CUT_MARKER}`;
}

/** One section by number (`2`) or by name (`waiting`), heading included; null if absent. */
export function sectionOf(text, which) {
  const want = String(which).trim().toLowerCase();
  for (const chunk of text.split(/\n(?=## )/)) {
    const heading = chunk.split('\n', 1)[0];
    if (!SECTION_START.test(heading)) continue;
    const title = heading.slice(3).trim().toLowerCase();
    const m = /^(\d+)[.)]?\s*(.*)$/.exec(title);
    if ((m && (m[1] === want || m[2] === want)) || title === want) return chunk.replace(/\n+$/, '');
  }
  return null;
}

/** Calls POST /v1/mind/brief and records the claim locally. Returns the response body. */
export async function fetchBrief({claim}) {
  const role = process.env.TH_ROLE;
  if (!role) throw invalid('TH_ROLE is not set (chat, night or reflex)');
  let session = process.env.CLAUDE_CODE_REMOTE_SESSION_ID || getState('session_id');
  if (!session) session = `local_${uuidv7()}`;
  setState('session_id', session);
  const {data} = await request('POST', '/v1/mind/brief', {
    body: {claim, session_id: session, role, constitution_sha256: constitutionSha(), th_version: VERSION},
  });
  if (claim || getState('seq') === null) setState('seq', data.seq ?? 0);
  if (claim) {
    setState('wake', data.wake ?? null);
    setState('claimed_at', Date.now());
  }
  setState('day', data.day ?? null);
  if (typeof data.full === 'string') writeThFile('brief.md', data.full);
  return data;
}

export async function brief(flags) {
  const data = await fetchBrief({claim: !!flags.claim});
  if (flags.json) return out(data);
  const full = typeof data.full === 'string' ? data.full : data.core || '';
  if (flags.section !== undefined) {
    const section = sectionOf(full, flags.section);
    if (section === null) throw invalid(`no briefing section ${flags.section}`);
    return out(section);
  }
  return out(flags.full ? full : data.core || '');
}
