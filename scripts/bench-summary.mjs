// Prints the numbers of a Bench run (bench.yml) and nothing else: no URLs, keys or log text.
// Usage: node scripts/bench-summary.mjs x3 <calls.jsonl> [tail.json]
//        node scripts/bench-summary.mjs x1 <calls.jsonl>
// calls.jsonl: one {"setting","status","ms","got"?} line per request the workflow made.
// tail.json: the output of `wrangler tail --format json` (events, possibly pretty-printed).
import { readFileSync, existsSync } from 'node:fs';

const [test, callsFile, tailFile] = process.argv.slice(2);
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const calls = lines(callsFile);

/** Splits a stream of JSON objects (one per line or pretty-printed) into objects. */
function events(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth++ === 0) start = i;
    } else if (ch === '}' && --depth === 0) {
      try { out.push(JSON.parse(text.slice(start, i + 1))); } catch {}
    }
  }
  return out;
}

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const stats = (xs) => (xs.length ? `p50 ${pct(xs, 50)} · p95 ${pct(xs, 95)} · p99 ${pct(xs, 99)} · max ${Math.max(...xs)} ms (n=${xs.length})` : 'none');
const count = (xs) => Object.entries(xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})).map(([k, v]) => `${k}: ${v}`).join(', ');

if (test === 'x3') {
  const tail = tailFile && existsSync(tailFile) ? events(readFileSync(tailFile, 'utf8')) : [];
  let pass = true;
  for (const setting of [...new Set(calls.map((c) => c.setting))]) {
    const mine = calls.filter((c) => c.setting === setting);
    const [n, r, p] = setting.split(' ');
    const marker = `kdf n=${n} r=${r} p=${p}`;
    const seen = tail.filter((e) => (e.logs ?? []).some((l) => [].concat(l.message).join(' ').includes(marker)));
    const okCalls = mine.filter((c) => c.status === 200).length;
    console.log(`\nscrypt N=${n} r=${r} p=${p}`);
    console.log(`  requests: ${okCalls}/${mine.length} ok (${count(mine.map((c) => c.status))})`);
    console.log(`  round trip from the runner: ${stats(mine.map((c) => c.ms))}`);
    if (seen.length) {
      console.log(`  object outcomes (tail): ${count(seen.map((e) => e.outcome))}`);
      console.log(`  object cpuTime: ${stats(seen.map((e) => e.cpuTime).filter((x) => typeof x === 'number'))}`);
      console.log(`  object wallTime: ${stats(seen.map((e) => e.wallTime).filter((x) => typeof x === 'number'))}`);
    } else console.log('  tail: no events (the token may lack tail access); read Workers → Metrics in the dashboard');
    const exceeded = seen.some((e) => e.outcome && e.outcome !== 'ok');
    const cpu99 = pct(seen.map((e) => e.cpuTime).filter((x) => typeof x === 'number'), 99);
    const ok = okCalls === mine.length && !exceeded && (cpu99 === null || cpu99 <= 600);
    console.log(`  verdict: ${ok ? 'PASS' : 'FAIL'}${cpu99 === null ? ' (outcomes only; cpuTime not in the tail)' : ''}`);
    if (setting === '32768 8 3') pass = ok;
  }
  console.log(`\nX3 (2^15/8/3): ${pass ? 'PASS: keep server-side scrypt' : 'FAIL: switch to client-side KDF (SECURITY.md §6.4)'}`);
  process.exitCode = pass ? 0 : 1;
} else if (test === 'x1') {
  const short = calls.filter((c) => c.setting === 'poke');
  const idle = calls.filter((c) => c.setting === 'idle');
  console.log(`takes with a poke: ${short.filter((c) => c.got).length}/${short.length} delivered; ${stats(short.map((c) => c.ms))}`);
  console.log(`idle takes (no poke, 25 s): ${idle.filter((c) => c.status === 200 && !c.got).length}/${idle.length} ended cleanly; ${stats(idle.map((c) => c.ms))}`);
  const ok = short.length > 0 && short.every((c) => c.got) && idle.every((c) => c.status === 200);
  console.log(`X1 (works from Actions): ${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
} else {
  console.error('usage: bench-summary.mjs x3|x1 <calls.jsonl> [tail.json]');
  process.exitCode = 2;
}
