// Role knowledge on demand (RUNTIME.md §5.3, shared/contract/skills.ts): mind/skills/ holds exactly
// the contract's skills, each within its characters, with the four headings in order, naming only
// commands `th help` has and GET routes the chat or night role may call; `th skill` prints one and
// lists them; ROLES.md points at them and stays within its cap.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CONTRACT, routeOf} from '../cli/lib/contract.mjs';
import {USAGE} from '../cli/lib/help.mjs';
import {COMMANDS} from '../cli/th.mjs';
import {skillsDir} from '../cli/lib/skill.mjs';
import {env, errCode, ROOT, th} from './helpers.mjs';

const {names, limits, headings} = CONTRACT.skills;
const read = name => readFileSync(join(skillsDir(ROOT), `${name}.md`), 'utf8');

test('mind/skills/ holds exactly the contract\'s skills', () => {
  const files = readdirSync(skillsDir(ROOT)).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  assert.deepEqual([...files].sort(), [...names].sort());
  for (const want of ['music', 'podcasts', 'guitar', 'study', 'astra', 'media', 'briefing', 'memory', 'verbs', 'muse', 'calendar', 'night', 'code'])
    assert.ok(names.includes(want), want);
});

test('each skill is within its characters, a title and the four headings in order', () => {
  for (const name of names) {
    const text = read(name);
    assert.ok(text.length <= limits.chars, `${name}: ${text.length} characters`);
    assert.match(text, /^# \S.*\n\n## /, `${name}: a title, then the first heading`);
    assert.deepEqual(text.match(/^## .+$/gm).map(h => h.slice(3)), headings, `${name}: headings`);
    for (const h of headings) {
      const body = text.slice(text.indexOf(`## ${h}\n`) + h.length + 4).split(/\n## /)[0];
      assert.ok(body.trim().length >= 80, `${name}: "${h}" says something`);
    }
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${name}: no emoji`);
    assert.doesNotMatch(text, /claude-|\b(sonnet|opus|haiku|fable)\b/i, `${name}: no model names`);
  }
});

test('each skill names only commands th help has, and only GET routes the chat or night role may call', () => {
  for (const name of names) {
    const text = read(name);
    const cmds = [...text.matchAll(/\bth ([a-z]+)/g)].map(m => m[1]);
    assert.ok(cmds.length, `${name}: names a th command`);
    for (const c of cmds) {
      assert.ok(Object.hasOwn(USAGE, c), `${name}: th ${c} is not in th help`);
      assert.ok(Object.hasOwn(COMMANDS, c), `${name}: th ${c} does not run`);
    }
    for (const [, path] of text.matchAll(/\bth get (\/v1\/[^\s`'"]+)/g)) {
      const plain = path.replace(/<[a-z ]+>/g, 'x');
      const r = routeOf('GET', plain);
      assert.ok(r, `${name}: th get ${path} is no route`);
      assert.ok(r.who.includes('C') || r.who.includes('N'), `${name}: th get ${path} is not the mind's`);
    }
  }
});

test('th skill prints one, lists them without a name, and refuses one it does not know', async () => {
  const e = env(null);
  const one = await th(['skill', 'music'], e);
  assert.equal(one.code, 0, one.stderr);
  assert.equal(one.stdout, `${read('music').trimEnd()}\n`);
  const all = await th(['skill'], e);
  assert.equal(all.code, 0, all.stderr);
  for (const name of names) assert.ok(all.stdout.includes(name), name);
  const bad = await th(['skill', 'cooking'], e);
  assert.equal(bad.code, 8);
  assert.equal(errCode(bad), 'validation');
  assert.equal((await th(['skill', 'music', 'extra'], e)).code, 8);
  assert.match((await th(['help'], e)).stdout, /^ {2}th skill \[<name>\]$/m);
});

test('ROLES.md points at the skills and stays within its 6,000 characters', () => {
  const roles = readFileSync(join(ROOT, 'mind/ROLES.md'), 'utf8');
  assert.ok(roles.length <= 6000, `${roles.length} characters`);
  assert.match(roles, /th skill <name>/);
});
