// The mind's own subagents (RUNTIME.md §6.6): .claude/agents/*.md parse, name a model alias from
// the allowed set and exactly the tools the hook gives them (lib/rules.mjs AGENTS); the PreToolUse
// hook lets each role start only its own; the shell ones run th only to read and never push main;
// and their answers taint as RUNTIME.md §6.5 says. Synthetic data only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {AGENTS, decide} from '../hooks/lib/rules.mjs';
import {taintOf} from '../hooks/lib/taint.mjs';
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

test('the five agent files parse: name, description, tools and a model alias, the hook\'s tools exactly', () => {
  const all = agents();
  assert.deepEqual(Object.keys(all).sort(), Object.keys(AGENTS).sort());
  for (const [name, {front, body}] of Object.entries(all)) {
    assert.equal(front.name, name);
    assert.ok(front.description?.length >= 80 && front.description.length <= 500, `${name}: description`);
    assert.ok(MODELS.includes(front.model), `${name}: model ${front.model}`);
    // mail names no tools (a connector's tools carry the account's suffix): it inherits the
    // session's, and the hook holds it to its own and the connectors' read tools.
    const tools = AGENTS[name].connectors ? (assert.equal(front.tools, undefined, `${name}: tools`), AGENTS[name].tools) : front.tools.split(',').map(t => t.trim());
    if (!AGENTS[name].connectors) assert.deepEqual([...tools].sort(), [...AGENTS[name].tools].sort(), `${name}: tools`);
    // Quarantined: outside text in, nothing that acts. Not quarantined: nothing that reaches the web.
    if (AGENTS[name].quarantined) assert.ok(!tools.some(t => WRITES.includes(t)), `${name}: acts`);
    else assert.ok(!tools.some(t => WEB.includes(t)), `${name}: web`);
    // Each says what it must never do: memory, pushes, secrets.
    assert.match(body, /^.*Never.*$/m, `${name}: never`);
    for (const word of [/memory/i, /push/i, /secret/i]) assert.match(body, word, `${name}: ${word}`);
    // Generic aliases only, never a full model name.
    assert.doesNotMatch(`${JSON.stringify(front)}${body}`, /claude-|\b(sonnet|opus|haiku)[- ]\d/i, name);
  }
  // The reader is the fastest: a lookup must not keep the owner waiting (mind/ROLES.md, chat).
  assert.equal(all.reader.front.model, 'haiku');
  assert.equal(all['night-step'].front.model, 'sonnet');
  assert.equal(all.researcher.front.model, 'opus');
  assert.equal(all.coder.front.model, 'opus');
  assert.equal(all.mail.front.model, 'haiku');
  // The researcher and mail answer in the reader's kinds, so th read --check can check them.
  for (const name of ['researcher', 'mail'])
    for (const [kind, k] of Object.entries(CONTRACT.reader.kinds)) {
      assert.ok(all[name].body.includes(`\`${kind}\``), `${name} ${kind}`);
      for (const field of Object.keys(k.schema.properties)) assert.ok(all[name].body.includes(`"${field}"`), `${name} ${kind}.${field}`);
    }
});

test('mind/ROLES.md stays within its 6,000 characters', () => {
  assert.ok(readFileSync(join(ROOT, 'mind/ROLES.md'), 'utf8').length <= 6000);
});

test('a role starts only its own subagents: all four for chat and night, mail for chat (and the evals\' general-purpose at night), the reader for reflex', () => {
  const start = (role, subagent_type, tool_name = 'Agent') => decide({tool_name, tool_input: {subagent_type, prompt: 'p'}}, ctx(role));
  for (const role of ['chat', 'night'])
    for (const name of ['reader', 'night-step', 'researcher', 'coder']) assert.equal(start(role, name), null, `${role} ${name}`);
  assert.equal(start('chat', 'mail'), null);
  assert.ok(start('night', 'mail'));
  assert.ok(start('reflex', 'mail'));
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
  // Each hands its report back to the session that started it (the platform's own tool for that).
  for (const who of ['reader', 'researcher', 'mail', 'night-step', 'coder']) assert.equal(as(who, 'SubagentHandback', {report: 'r'}), null, who);
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

test('what a subagent hands back: the walled readers and the shell ones are local (owner, 2026-11-22), any other is a subagent', () => {
  const c = {cwd: '/work/repo', projectDir: '/work/repo', tmpDir: '/tmp/sess', ownHosts: []};
  const back = subagent_type => taintOf({tool_name: 'Agent', tool_input: {subagent_type, prompt: 'p'}}, c);
  assert.equal(back('reader'), null);
  assert.equal(back('researcher'), null);
  assert.equal(back('mail'), null);
  assert.equal(back('night-step'), null);
  assert.equal(back('coder'), null);
  assert.deepEqual(back('general-purpose'), {source: 'subagent', ref: 'file'});
  assert.deepEqual(back('constructor'), {source: 'subagent', ref: 'file'});
});

test('inside a walled reader its own calls mark nothing; inside a shell agent, or the session, they mark as ever', () => {
  const c = {cwd: '/work/repo', projectDir: '/work/repo', tmpDir: '/tmp/sess', ownHosts: []};
  const fetch = {tool_name: 'WebFetch', tool_input: {url: 'https://example.com/a', prompt: 'p'}};
  const mailRead = {tool_name: 'mcp__Gmail__search_threads', tool_input: {query: 'invoice'}};
  for (const agent_type of ['reader', 'researcher']) assert.equal(taintOf({...fetch, agent_type}, c), null, agent_type);
  assert.equal(taintOf({...mailRead, agent_type: 'mail'}, c), null);
  assert.deepEqual(taintOf(fetch, c), {source: 'WebFetch', ref: 'https://example.com/a'});
  assert.deepEqual(taintOf({...fetch, agent_type: 'general-purpose'}, c), {source: 'WebFetch', ref: 'https://example.com/a'});
  assert.deepEqual(taintOf({tool_name: 'Bash', tool_input: {command: 'curl -s https://evil.example/x'}, agent_type: 'coder'}, c),
    {source: 'curl', ref: 'https://evil.example/'});
  assert.deepEqual(taintOf(mailRead, c), {source: 'mcp', ref: ''});
});

test('the mail agent: only the mail and file connectors\' read tools (any account\'s suffix) and the drop folder; the session calls no connector', () => {
  const mail = (tool_name, tool_input = {}) => decide({tool_name, tool_input, agent_type: 'mail'}, ctx('chat'));
  for (const t of ['mcp__Gmail__search_threads', 'mcp__Gmail__get_thread', 'mcp__Gmail_189b086c__get_message', 'mcp__Gmail__list_labels',
    'mcp__Gmail__download_gmail_attachment', 'mcp__Google_Drive__search_files', 'mcp__Google_Drive_c1005530__read_file_content',
    'mcp__Google_Drive__download_file_content', 'mcp__Google_Docs__read_doc', 'mcp__Google_Sheets__get_values',
    'mcp__Google_Slides__read_presentation', 'mcp__Google_Slides__list_x'])
    assert.equal(mail(t), null, t);
  assert.equal(mail('Read', {file_path: '/tmp/sess/th/ext/scan.md'}), null);
  for (const t of ['mcp__Gmail__send_message', 'mcp__Gmail__reply', 'mcp__Gmail__forward', 'mcp__Gmail__create_draft',
    'mcp__Gmail__trash_thread', 'mcp__Gmail__label_message', 'mcp__Google_Drive__share_file', 'mcp__Google_Drive__update_file',
    'mcp__Google_Drive__create_file', 'mcp__Google_Docs__update_doc', 'mcp__Google_Sheets__update_values', 'mcp__Google_Chat__list_messages',
    'mcp__Google_Chat__send_message', 'mcp__GmailEvil__get_x', 'mcp__github__get_file_contents', 'mcp__Phone__phone_list_apps',
    'mcp__x__y', 'WebFetch', 'WebSearch', 'Bash', 'Write', 'Edit', 'Agent'])
    assert.ok(mail(t, {url: 'https://example.com/', query: 'q', command: 'ls', file_path: '/tmp/sess/th/ext/x', content: ''}), t);
  assert.ok(mail('Read', {file_path: '/tmp/sess/th/brief.md'}), 'the drop folder only');
  assert.ok(mail('Read', {file_path: '/work/repo/README.md'}));
  // The session itself, in every role, and every other subagent: no connector at all.
  for (const role of ['chat', 'night', 'reflex']) {
    for (const t of ['mcp__Gmail__search_threads', 'mcp__Google_Drive_c1005530__read_file_content'])
      assert.equal(decide({tool_name: t, tool_input: {}}, ctx(role)), 'Mail and files are read by the mail agent.', `${role} ${t}`);
    for (const t of ['mcp__github__get_file_contents', 'mcp__github__create_pull_request', 'mcp__fetch__fetch', 'mcp__Phone__phone_type_keys'])
      assert.equal(decide({tool_name: t, tool_input: {}}, ctx(role)), 'Connector tools are closed to this session; for GitHub use gh (see the code skill).', `${role} ${t}`);
    for (const t of ['mcp__Gmail__send_message', 'mcp__Google_Drive__share_file'])
      assert.equal(decide({tool_name: t, tool_input: {}}, ctx(role)), 'Sending or changing mail and files is not built. Give the owner the text.', `${role} ${t}`);
  }
  for (const agent_type of ['reader', 'researcher', 'night-step', 'coder', 'general-purpose'])
    assert.ok(decide({tool_name: 'mcp__Gmail__search_threads', tool_input: {}, agent_type}, ctx('night')), agent_type);
});
