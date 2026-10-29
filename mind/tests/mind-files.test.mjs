// The files a mind session reads (RUNTIME.md §2): mind/CONSTITUTION.md is the constitution's loaded
// text byte for byte (CONSTITUTION.md rule 2) and stays ≤ 5,000 characters (rule 3); mind/ROLES.md
// has the chat, night and reflex sections and stays ≤ 6,000 characters; the hooks block the owner
// pastes names only hooks that exist, and the pasted copy is that block.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './helpers.mjs';

const read = path => readFileSync(join(ROOT, path), 'utf8');

test('mind/CONSTITUTION.md is the loaded text of docs/mind/CONSTITUTION.md, byte for byte', () => {
  const doc = read('docs/mind/CONSTITUTION.md');
  const start = doc.indexOf('```markdown\n') + '```markdown\n'.length;
  const block = doc.slice(start, doc.indexOf('\n```\n', start) + 1);
  assert.equal(read('mind/CONSTITUTION.md'), block);
  assert.ok(block.length <= 5000, `${block.length} characters`);
});

test('mind/ROLES.md has the three role sections and stays under 6,000 characters', () => {
  const roles = read('mind/ROLES.md');
  assert.deepEqual(roles.match(/^## .+$/gm), ['## chat', '## night', '## reflex']);
  assert.ok(roles.length <= 6000, `${roles.length} characters`);
});

test('the night section walks the contract\'s steps: each step that works by P3 in order, and the commands th has', () => {
  const roles = read('mind/ROLES.md');
  const night = roles.slice(roles.indexOf('## night'), roles.indexOf('## reflex'));
  const contract = JSON.parse(read('mind/cli/contract.json')).night;
  const built = contract.steps.filter(s => s.phase === 'P3' || (s.phase === 'P4' && !s.deferred)).map(s => s.step);
  const named = [...night.matchAll(/^ {3}- (\d+) /gm)].map(m => Number(m[1]));
  assert.deepEqual(named, built, 'one bullet per step built by P3, in order');
  for (const cmd of ['th night start', 'th night steps', 'th night step <n> done', 'th night done', 'th day', 'th facts --batch <file> --night'])
    assert.ok(night.includes(cmd), cmd);
  assert.match(night, new RegExp(`at ${contract.budget_min.hard} \\(${contract.budget_min.sunday_hard} on the`));
});

test('the hooks block to paste names hooks that exist, and the pasted copy is that block', () => {
  const block = JSON.parse(read('mind/hooks/settings.example.json'));
  for (const entries of Object.values(block.hooks))
    for (const e of entries)
      for (const h of e.hooks) {
        const file = /mind\/hooks\/([a-z-]+\.mjs)/.exec(h.command)?.[1];
        assert.ok(file && existsSync(join(ROOT, 'mind/hooks', file)), h.command);
      }
  // The owner pastes .claude/settings.json (SETUP.md K1); nothing here writes it. Once it is there,
  // it holds exactly this block, so the hooks that run are the ones these tests cover.
  if (existsSync(join(ROOT, '.claude/settings.json')))
    assert.deepEqual(JSON.parse(read('.claude/settings.json')).hooks, block.hooks, 'the pasted hooks are mind/hooks/settings.example.json');
});
