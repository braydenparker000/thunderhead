// The files a mind session reads (RUNTIME.md §2): mind/CONSTITUTION.md is the constitution's loaded
// text byte for byte (CONSTITUTION.md rule 2) and stays ≤ 5,000 characters (rule 3); mind/ROLES.md
// has the chat, night and reflex sections and stays ≤ 6,000 characters; the hooks block the owner
// pastes names only hooks that exist.
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

test('the hooks block to paste names hooks that exist and never writes .claude/', () => {
  const block = JSON.parse(read('mind/hooks/settings.example.json'));
  for (const entries of Object.values(block.hooks))
    for (const e of entries)
      for (const h of e.hooks) {
        const file = /mind\/hooks\/([a-z-]+\.mjs)/.exec(h.command)?.[1];
        assert.ok(file && existsSync(join(ROOT, 'mind/hooks', file)), h.command);
      }
  assert.equal(existsSync(join(ROOT, '.claude/settings.json')), false, 'the owner pastes it; th never writes it');
});
