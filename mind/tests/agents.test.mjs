// The mind's own subagents (RUNTIME.md §6.6): .claude/agents/*.md parse, name a model alias from
// the allowed set and exactly the tools the hook gives them (lib/rules.mjs AGENTS); the PreToolUse
// hook lets each role start only its own; the shell ones run th only to read and never push main;
// and their answers taint as RUNTIME.md §6.5 says. Synthetic data only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {AGENTS, decide} from '../hooks/lib/rules.mjs';
import {ROOT} from './helpers.mjs';
import {CONTRACT} from '../cli/lib/contract.mjs';

const MODELS = ['sonnet', 'opus', 'haiku'];
const WEB = ['WebFetch', 'WebSearch'];
const WRITES = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const DIR = join(ROOT, '.claude/agents');
const ctx = (role) => ({role, cwd: '/work/repo', projectDir: '/work/repo', tmpDir: '/tmp/sess',
  allowedHosts: ['api.github.com', 'worker.example.test'], headSubject: () => 'Fix the player'});

/** name → {front: {key: value}, body} for every agent file. */
function agents() {
  const out = {};
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.md'))) {
    const text = readFileSync(join(DIR, f), 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    assert.ok(m, `${f}: frontmatter`);
    const front = Object.fromEntries(m[1].split('\n').map(l => /^([a-zA-Z]+): (.+)$/.exec(l)).filter(Boolean).map(x => [x[1], x[2].trim()]));
    out[f.replace(/\.md$/, '')] = {front, body: m[2]};
  }
  return out;
}

test('the four agent files parse: name, description, tools and a model alias, the hook\'s tools exactly', () => {
  const all = agents();
  assert.deepEqual(Object.keys(all).sort(), Object.keys(AGENTS).sort());
  for (const [name, {front, body}] of Object.entries(all)) {
    assert.equal(front.name, name);
    assert.ok(front.description?.length >= 80 && front.description.length <= 500, `${name}: description`);
    assert.ok(MODELS.includes(front.model), `${name}: model ${front.model}`);
    const tools = front.tools.split(',').map(t => t.trim());
    assert.deepEqual([...tools].sort(), [...AGENTS[name].tools].sort(), `${name}: tools`);
    // Quarantined: outside text in, nothing that acts. Not quarantined: nothing that reaches the web.
    if (AGENTS[name].quarantined) assert.ok(!tools.some(t => WRITES.includes(t)), `${name}: acts`);
    else assert.ok(!tools.some(t => WEB.includes(t)), `${name}: web`);
    // Each says what it must never do: memory, pushes, secrets.
    assert.match(body, /^.*Never.*$/m, `${name}: never`);
    for (const word of [/memory/i, /push/i, /secret/i]) assert.match(body, word, `${name}: ${word}`);
    // Generic aliases only, never a full model name.
    assert.doesNotMatch(`${JSON.stringify(front)}${body}`, /claude-|\b(sonnet|opus|haiku)[- ]\d/i, name);
  }
  assert.equal(all.reader.front.model, 'sonnet');
  assert.equal(all['night-step'].front.model, 'sonnet');
  assert.equal(all.researcher.front.model, 'opus');
  assert.equal(all.coder.front.model, 'opus');
  // The researcher answers in the reader's kinds, so th read --check can check it.
  for (const [kind, k] of Object.entries(CONTRACT.reader.kinds)) {
    assert.ok(all.researcher.body.includes(`\`${kind}\``), kind);
    for (const field of Object.keys(k.schema.properties)) assert.ok(all.researcher.body.includes(`"${field}"`), `${kind}.${field}`);
  }
});

test('mind/ROLES.md stays within its 6,000 characters', () => {
  assert.ok(readFileSync(join(ROOT, 'mind/ROLES.md'), 'utf8').length <= 6000);
});

test('a role starts only its own subagents: all four for chat and night (and the evals\' general-purpose at night), the reader for reflex', () => {
  const start = (role, subagent_type, tool_name = 'Agent') => decide({tool_name, tool_input: {subagent_type, prompt: 'p'}}, ctx(role));
  for (const role of ['chat', 'night'])
    for (const name of ['reader', 'night-step', 'researcher', 'coder']) assert.equal(start(role, name), null, `${role} ${name}`);
  assert.equal(start('night', 'general-purpose'), null);
  assert.equal(start('reflex', 'reader'), null);
  assert.equal(start('chat', 'reader', 'Task'), null);
  for (const [role, name] of [['reflex', 'coder'], ['reflex', 'researcher'], ['reflex', 'night-step'], ['reflex', 'general-purpose'],
    ['chat', 'general-purpose'], ['chat', 'Explore'], ['night', 'Plan'], ['chat', undefined], ['chat', 'constructor']])
    assert.ok(start(role, name), `${role} ${name}`);
  assert.match(start('reflex', 'coder'), /only these subagents: reader \(not coder\)/);
});

test('inside a subagent: its tools only; the researcher is quarantined like the reader; the shell ones read th and never push main', () => {
  const as = (agent_type, tool_name, tool_input) => decide({tool_name, tool_input, agent_type}, ctx('chat'));
  assert.ok(as('researcher', 'Bash', {command: 'ls'}));
  assert.ok(as('researcher', 'Read', {file_path: '/tmp/sess/th/brief.md'}));
  assert.ok(as('researcher', 'WebFetch', {url: 'https://example.com/a?d=notes', prompt: 'p'}));
  assert.equal(as('researcher', 'WebFetch', {url: 'https://example.com/a', prompt: 'p'}), null);
  assert.equal(as('researcher', 'Read', {file_path: '/tmp/sess/th/ext/long.md'}), null);
  assert.ok(as('night-step', 'WebFetch', {url: 'https://example.com/a', prompt: 'p'}));
  assert.ok(as('night-step', 'Write', {file_path: '/tmp/sess/th/work/x.json', content: '{}'}));
  assert.ok(as('coder', 'WebSearch', {query: 'q'}));
  assert.ok(as('coder', 'Agent', {subagent_type: 'reader', prompt: 'p'}));
  assert.equal(as('coder', 'Edit', {file_path: '/work/repo/frontend/app.js', old_string: 'a', new_string: 'b'}), null);
  for (const cmd of ['th day 2026-11-01', 'th recall "practice"', 'th get /v1/memory/facts', 'th brief --section 4', 'th ci abc123',
    `cat > /tmp/sess/th/work/facts.json <<'EOF'\n[]\nEOF`, 'npm test', 'git push -u origin claude/fix-player'])
    assert.equal(as('coder', 'Bash', {command: cmd}), null, cmd);
  for (const name of ['night-step', 'coder']) {
    for (const cmd of ['th facts --batch /tmp/sess/th/work/f.json --night', 'th remember --kind rule --text x --evidence m1', 'th say today hi',
      'th title t1 "A title"', 'th night step 4 done', 'th brief --claim', 'node mind/cli/th.mjs propose --class x', 'git push origin HEAD:main',
      'git push', 'echo ok && th verb music.play \'{}\' --why x'])
      assert.ok(as(name, 'Bash', {command: cmd}), `${name}: ${cmd}`);
  }
  // The session itself is not held to a subagent's rules.
  assert.equal(decide({tool_name: 'Bash', tool_input: {command: 'th facts --batch f.json --night'}}, ctx('chat')), null);
});
