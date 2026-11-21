// `th help`: no command → an index (each command, one line, under 2,500 characters, since it stays
// in the session's context); a command → its usage; all → everything, as before.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, th} from './helpers.mjs';
import {INDEX, USAGE} from '../cli/lib/help.mjs';

test('th help prints an index: every command on one line, under 2,500 characters', async () => {
  const r = await th(['help'], env(null));
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.length < 2500, `${r.stdout.length} characters`);
  assert.deepEqual(Object.keys(INDEX).sort(), Object.keys(USAGE).sort(), 'one short line per command');
  for (const name of Object.keys(USAGE)) assert.match(r.stdout, new RegExp(`^ {2}${name}: \\S.*$`, 'm'), name);
  assert.match(r.stdout, /th help <command>: its usage\. th help all: /);
  assert.ok(!r.stdout.includes('Verbs (th verb)'), 'no verbs, routes or permissions in the index');
  assert.equal((await th(['help', 'nope'], env(null))).stdout, r.stdout, 'an unknown command gets the index');
});

test('th help <command> and th help all print the detail', async () => {
  const say = await th(['help', 'say'], env(null));
  assert.match(say.stdout, /^th say today\|system /);
  const all = await th(['help', 'all'], env(null));
  assert.equal(all.code, 0);
  assert.ok(all.stdout.length > 20_000);
  for (const part of ['Verbs (th verb)', 'Surface kinds (th surface):', 'Exit codes:', '  th facts --batch']) assert.ok(all.stdout.includes(part), part);
});
