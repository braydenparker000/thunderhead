// The deterministic memory-probe scorer (EVALS.md §3.3): an answer is correct when every expected
// key appears and no forbidden key does, accent- and case-folded; category E needs an abstention
// phrase and no invented value; category F needs a hedge ("last I knew" or a date). Items it can't
// decide go to the judge in-session (≤ 10%). Summaries carry numbers only, never probe text.

/** Accent- and case-folded text. */
export function fold(text) {
  return String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
}

const has = (answer, key) => answer.includes(fold(key));

/** @param {{cat: string, expected_keys: string[], forbidden_keys: string[]}} probe
 *  @param {string} answer  @param {string[]} abstain  @returns {boolean} */
export function correct(probe, answer, abstain) {
  const a = fold(answer);
  if (probe.forbidden_keys.some(k => has(a, k))) return false;
  if (probe.cat === 'E') return abstain.some(p => has(a, p));
  if (probe.cat === 'F' && !/last i knew|\b\d{4}-\d{2}-\d{2}\b/.test(a)) return false;
  return probe.expected_keys.every(k => has(a, k));
}

/** `{suite, n, correct, by_cat}` for a set of probes and the answers by probe id (a missing
 * answer counts as wrong). */
export function score(probes, answers, abstain) {
  const by_cat = {};
  let right = 0;
  for (const p of probes) {
    const ok = typeof answers[p.id] === 'string' && correct(p, answers[p.id], abstain);
    const c = (by_cat[p.cat] ??= {n: 0, correct: 0});
    c.n++;
    if (ok) { c.correct++; right++; }
  }
  return {suite: 'MP', n: probes.length, correct: right, by_cat};
}
