// The night's report was refused on 2026-11-21 (`session_tainted`): at step 4 the night ran a shell
// loop of recalls (`for q in …; do th recall …; done`), and the hooks read `for` as a command they
// can't vouch for, which labels the session (mind/hooks/lib/taint.mjs, an unknown command). The
// rule stays; the night no longer needs one: `th recall --each -` takes every query on stdin and
// `th day --first|--last <n>` bounds a part. This walks every th command the night section of
// mind/ROLES.md and the night skill document and checks that none of them labels the session, as
// run plainly from the repository (with a heredoc for the stdin ones).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROOT, env, startFake, th} from './helpers.mjs';
import {taintOf} from '../hooks/lib/taint.mjs';

const read = p => readFileSync(`${ROOT}/${p}`, 'utf8');
const roles = read('mind/ROLES.md');
const nightRoles = roles.slice(roles.indexOf('## night'), roles.indexOf('## reflex'));
const ctx = {cwd: ROOT, tmpDir: '/tmp/th-night-plain', ownHosts: [], projectDir: ROOT};

/** A documented command as the night would type it: placeholders filled, the first of alternatives. */
function runnable(doc) {
  return doc.replace(/\s+/g, ' ')
    .replace(/"<[^>]*>"|'<[^>]*>'/g, '"x"')
    .replace(/<(\d)-(\d+)>/g, '$1').replace(/<[^>]*>/g, 'x')
    .replace(/(\S+)\|\S+/g, (m, first) => (m.startsWith('--') || /^[a-z-]+$/.test(first) ? first : m))
    .replace(/…/g, '').replace(/\s+/g, ' ').trim();
}

const documented = [...nightRoles.matchAll(/`(th [^`]+)`/g), ...read('mind/skills/night.md').matchAll(/`(th [^`]+)`/g)]
  .map(m => m[1]).filter(c => !/^th (eval|music)\b/.test(c)); // steps 9 and 11 come after the report, and label by design

test('every th command the night documents runs without labelling the session', () => {
  assert.ok(documented.length >= 25, `${documented.length} commands found`);
  const tainting = [];
  for (const doc of documented) {
    const cmd = runnable(doc);
    const plain = taintOf({tool_name: 'Bash', tool_input: {command: cmd}}, ctx);
    const stdin = / - ?|--batch -|--each -/.test(cmd) ? taintOf({tool_name: 'Bash', tool_input: {command: `${cmd} <<'EOF'\ntea\nEOF`}}, ctx) : null;
    if (plain || stdin) tainting.push(`${cmd}: ${JSON.stringify(plain ?? stdin)}`);
  }
  assert.deepEqual(tainting, []);
  for (const need of ['th recall --each -', 'th day', '--first']) assert.ok(documented.some(c => c.includes(need)) || nightRoles.includes(need), need);
});

test('the shapes that labelled the night still label it: the rule is not loosened', () => {
  for (const cmd of ['for q in tea bike; do th recall "$q" --kind facts; done', 'head -c 2000 /tmp/th/day.json'])
    assert.ok(taintOf({tool_name: 'Bash', tool_input: {command: cmd}}, ctx), cmd);
});

test('th recall --each answers every line of stdin; the empty and the over-long are refused', async () => {
  const fake = await startFake();
  try {
    const e = env(fake);
    await th(['brief', '--claim'], e);
    const r = await th(['recall', '--each', '-', '--kind', 'facts'], e, 'tea\nthe bike\n\n');
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.results.map(x => x.q), ['tea', 'the bike']);
    const none = await th(['recall', '--each', '-'], e, '\n');
    assert.equal(none.code, 8);
    const many = await th(['recall', '--each', '-'], e, Array.from({length: 51}, (_, i) => `q${i}`).join('\n'));
    assert.equal(many.code, 8);
  } finally { await fake.stop(); }
});

test('th day --first/--last keep that many items of a part, from its start or its end', async () => {
  const {bounded} = await import('../cli/lib/memory.mjs');
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(bounded(items, {first: '2'}), [1, 2]);
  assert.deepEqual(bounded(items, {last: '2'}), [4, 5]);
  assert.deepEqual(bounded(items, {}), items);
  assert.deepEqual(bounded(items, {first: 'x'}), items);
});
