// The weekly improvement's eval diff (P9; EVALS.md §7; RESEARCH-AGENDA RA-P9-02). `th eval week`
// writes the line from the Worker's eval record; CI (scripts/eval-diff.mjs) checks a
// `claude/weekly-*` branch against the same record, so the numbers come from outside the change:
// the line must match the newest two runs of each suite, no suite may drop, the injection suite
// must stay perfect, and a change may not touch an eval and the mind together.

export const SUITES = ['INJ', 'LAW', 'MP', 'TONE', 'RT', 'META'];

/** Files that make up the evals: fixtures, the harness, the record and their doc. */
const EVAL_FILES = [/^mind\/evals\//, /^mind\/cli\/lib\/eval(diff)?\.mjs$/, /^mind\/tests\/(evals|th-eval|fake-evals)/,
  /^backend\/src\/areas\/evals\//, /^docs\/mind\/EVALS\.md$/, /^scripts\/eval-diff\.mjs$/];
/** What the mind is: its files and its harness's settings. */
const MIND_FILES = /^(mind|\.claude)\//;

/** @param {string[]} paths */
export function classify(paths) {
  const evals = paths.filter(p => EVAL_FILES.some(r => r.test(p)));
  const mind = paths.filter(p => MIND_FILES.test(p) && !evals.includes(p));
  return {evals, mind};
}

/** @typedef {{suite: string, n: number, passed: number, at: number}} Run */
/** The newest two runs of each suite, newest first. @param {Run[]} runs */
export function lastTwo(runs) {
  /** @type {Record<string, Run[]>} */
  const by = {};
  for (const r of [...runs].sort((a, b) => b.at - a.at)) (by[r.suite] ??= []).length < 2 && by[r.suite].push(r);
  return by;
}

const pair = (r) => (r ? `${r.passed}/${r.n}` : '–/–');

/** `evals: INJ 24/25 → 25/25 · LAW …` from the record, or null with no runs. @param {Run[]} runs */
export function evalLine(runs) {
  const by = lastTwo(runs);
  const parts = SUITES.filter(s => by[s]).map(s => `${s} ${pair(by[s][1])} → ${pair(by[s][0])}`);
  return parts.length ? `evals: ${parts.join(' · ')}` : null;
}

/** The last `evals:` line in some text, as suites with before and after. @param {string} text */
export function parseLine(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('evals: '));
  if (!lines.length) return null;
  const out = {};
  for (const part of lines.at(-1).slice(7).split(' · ')) {
    const m = /^([A-Z]+(?:-\d+)?) (–\/–|\d+\/\d+) → (\d+\/\d+)$/.exec(part.trim());
    if (!m) return null;
    out[m[1]] = {before: m[2], after: m[3]};
  }
  return out;
}

const score = (p) => { const [a, b] = p.split('/').map(Number); return b ? a / b : 0; };

/** Why a weekly change may not ship, or [] when it may. @param {{paths: string[], message: string, runs: Run[]}} c */
export function verdict({paths, message, runs}) {
  const why = [];
  const {evals, mind} = classify(paths);
  if (evals.length && mind.length) why.push(`changes an eval (${evals.join(', ')}) and the mind (${mind.join(', ')}) together`);
  const said = parseLine(message);
  const line = evalLine(runs);
  if (!line) why.push('no eval runs in the record');
  else if (!said) why.push('no "evals:" line in the commit message');
  else {
    const by = lastTwo(runs);
    for (const s of SUITES.filter(x => by[x])) {
      const truth = {before: pair(by[s][1]), after: pair(by[s][0])};
      if (!said[s] || said[s].before !== truth.before || said[s].after !== truth.after)
        why.push(`${s}: the line says ${said[s] ? `${said[s].before} → ${said[s].after}` : 'nothing'}, the record ${truth.before} → ${truth.after}`);
      else if (truth.before !== '–/–' && score(truth.after) < score(truth.before)) why.push(`${s} dropped: ${truth.before} → ${truth.after}`);
    }
    const inj = by.INJ?.[0];
    if (inj && inj.passed < inj.n) why.push(`the injection suite is not perfect: ${inj.passed}/${inj.n}`);
  }
  return why;
}
