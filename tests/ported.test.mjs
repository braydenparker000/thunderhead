// The as-is port (MIGRATION.md §5.1, SECURITY.md §4.4), checked against frontend/ported.json without
// the old repo: every ported byte is the old byte except the recorded edits, each folder reaches
// only its recorded hosts, and its pages keep their recorded CSP. scripts/ported.mjs writes the record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT, cspOf, filesUnder, hostsIn, undo } from '../scripts/ported.mjs';

const SITE = fileURLToPath(new URL('../frontend/', import.meta.url));
const P = JSON.parse(await readFile(join(SITE, 'ported.json'), 'utf8'));
// `improvement`: a change to a ported app the owner agreed to (ROADMAP P5–P8, P10), with its decisions line.
const KINDS = ['paths', 'route-folder', 'api-address', 'csp', 'data-move', 'improvement'];
/** Apps whose data has moved to the new Worker (SECURITY.md §4.4 rule 4), and the one new-site file
 * each may load: Music in P5, through its own worker; Guitar in P6, its sources with the session. */
const MOVED = { 'music/sw.js': ['/th/music/bridge.js'], 'guitar/sources.js': ['/th/ported/session.js'], 'podcasts/sw.js': ['/th/podcasts/bridge.js'] };
/** Improvements the owner agreed to that load a new-site file of the player's own (never the session). */
const IMPROVED = {
  'music/src/app.js': ['/th/music/dj.js'],
  'music/src/player/player.js': ['/th/music/dj.js'],
  'music/src/list/sources.js': ['/th/music/search.js'],
  'guitar/reader.js': ['/th/guitar/teacher.js'],
  'astra/src/main.js': ['/th/astra/open.js'],
  'music/sw.js': [],
};
const sha = b => createHash('sha256').update(b).digest('hex');
const listed = async dir => (await filesUnder(join(SITE, dir))).map(f => relative(SITE, f));

async function checkFile(rel, r) {
  const bytes = await readFile(join(SITE, rel));
  assert.equal(sha(bytes), r.sha256, `${rel} changed since ported.json was written (re-run scripts/ported.mjs)`);
  for (const k of r.adjustments) assert.ok(KINDS.includes(k), `${rel}: unknown adjustment ${k}`);
  if (r.adjustments.includes('data-move')) assert.ok(rel in MOVED, `${rel}: a data move only where its app moved`);
  if (r.edits?.length) {
    assert.ok(r.adjustments.length, `${rel}: edits without an adjustment kind`);
    assert.equal(sha(Buffer.from(undo(bytes.toString('utf8'), r.edits), 'utf8')), r.old_sha256, `${rel}: differs from the old file beyond its recorded edits`);
  } else {
    assert.deepEqual(r.adjustments, [], `${rel}: adjustments without edits`);
    assert.equal(r.sha256, r.old_sha256, `${rel}: not byte-equal to the old file`);
  }
}

test('ported.json names the old repo commit and the five apps', () => {
  assert.equal(P.v, 1);
  assert.match(P.old_repo_commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(P.folders).sort(), ['astra', 'guitar', 'media', 'music', 'podcasts']);
  for (const name of Object.keys(P.folders)) assert.ok(existsSync(join(SITE, name, 'index.html')), `${name}/index.html is a real page`);
});

test('every ported byte is the old byte, except the recorded edits', async () => {
  for (const [name, f] of Object.entries(P.folders)) {
    assert.deepEqual((await listed(name)).sort(), Object.keys(f.files).sort(), `${name}/: files differ from ported.json`);
    for (const [rel, r] of Object.entries(f.files)) await checkFile(rel, r);
  }
  const shared = [...await listed('assets'), ...await listed('drawercast')].sort();
  assert.deepEqual(shared, Object.keys(P.shared).sort(), 'assets/ and drawercast/ differ from ported.json');
  for (const [rel, r] of Object.entries(P.shared)) await checkFile(rel, r);
});

test('every shared old file is loaded by a ported folder, and every listed one exists', () => {
  const wanted = Object.values(P.folders).flatMap(f => f.assets);
  for (const a of wanted) assert.ok(a.endsWith('/') ? Object.keys(P.shared).some(s => s.startsWith(a)) : a in P.shared, `missing shared file ${a}`);
  for (const s of Object.keys(P.shared)) assert.ok(wanted.some(a => a.endsWith('/') ? s.startsWith(a) : a === s), `${s} is loaded by no ported folder`);
});

test('each ported folder reaches only its recorded hosts and keeps its recorded CSP', async () => {
  for (const [name, f] of Object.entries(P.folders)) {
    for (const rel of Object.keys(f.files).filter(r => TEXT.test(r))) {
      const text = await readFile(join(SITE, rel), 'utf8');
      for (const h of hostsIn(text)) assert.ok(f.hosts.includes(h), `${rel} reaches ${h}, not in its ported.json hosts`);
      if (rel.endsWith('.html')) {
        const csp = cspOf(text);
        assert.ok(csp, `${rel} has no meta CSP`);
        assert.equal(csp, f.csp[rel], `${rel}: CSP differs from ported.json`);
        for (const [, h] of csp.matchAll(/https?:\/\/([^\s;]+)/g)) assert.ok(f.hosts.includes(h), `${rel}: CSP host ${h} not in its ported.json hosts`);
      }
    }
  }
  for (const rel of Object.keys(P.shared).filter(r => TEXT.test(r)))
    for (const h of hostsIn(await readFile(join(SITE, rel), 'utf8'))) assert.ok(P.shared_hosts.includes(h), `${rel} reaches ${h}`);
});

test('no ported page touches the new sign-in (SECURITY.md §4.4 rule 3)', async () => {
  const all = [...Object.values(P.folders).flatMap(f => Object.keys(f.files)), ...Object.keys(P.shared)].filter(r => /\.(js|html)$/.test(r));
  for (const rel of all) {
    const text = await readFile(join(SITE, rel), 'utf8');
    const fromTh = [...text.matchAll(/['"]((?:\/|\.\.\/)+th\/[a-z/-]+\.js)['"]/g)].map((m) => m[1]);
    assert.deepEqual(fromTh, [...(MOVED[rel] ?? []), ...(IMPROVED[rel] ?? [])], `${rel} loads from th/`);
    assert.doesNotMatch(text, /thunderhead-api\./, `${rel} names the new API`);
  }
});
