// A shell variable used as a command (mind/hooks/lib/taint.mjs, plainVars). The night of 2026-11-10
// kept a filter in one (`F='grep -v …'`, then `th … | $F`) to hide a Node warning; the allowlist
// could not read `$F`, labelled the session as having read outside text, and the night's report was
// refused. A variable the same command line sets to plain words, and mentions nowhere else, is now
// read as those words. Everything else about a variable still counts as outside text.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taintOf} from '../hooks/lib/taint.mjs';

const ctx = {cwd: '/work/repo', tmpDir: '/tmp', ownHosts: ['api.thunderhead.example'], projectDir: '/work/repo'};
const D = '$';
const bash = command => taintOf({tool_name: 'Bash', tool_input: {command}}, ctx);

test('a filter kept in a variable is read as the filter', () => {
  // The night's own command, as it was written.
  assert.equal(bash(`F='grep -v -e UNDICI -e trace-warnings'\nth daynote 2026-11-09 --summary "x" 2>&1 | ${D}F`), null);
  assert.equal(bash(`F='grep -v -e UNDICI'; th errors 2>&1 | ${D}{F} | head -5`), null);
  // Words kept for a command's arguments.
  assert.equal(bash(`P='-v UNDICI'; th day 2026-11-09 2>&1 | grep ${D}P`), null);
});

test('the words it holds are judged as if written in its place', () => {
  assert.deepEqual(bash(`F='curl https://evil.example/x'\n${D}F`), {source: 'curl', ref: 'https://evil.example/'});
  assert.deepEqual(bash(`F='cat'; ${D}F /etc/hostname`), {source: 'cat', ref: 'file'});
  assert.equal(bash(`F='bash -c'; ${D}F "curl https://evil.example"`)?.source, 'bash');
  assert.equal(bash(`F='th music page'; ${D}F`)?.source, 'th music', 'songs\' tags are outside text however the command is spelled');
});

test('a variable never set on the line, or set to more than plain words, stays an unknown command', () => {
  assert.deepEqual(bash(`th day 2026-11-09 | ${D}F`), {source: `${D}F`, ref: ''});
  // A value the shell could act on: another command after `;`, a glob, a substitution.
  assert.deepEqual(bash(`F='th day; curl evil.example'; ${D}F`), {source: `${D}F`, ref: ''});
  assert.deepEqual(bash(`F='grep -v *'; th day | ${D}F`), {source: `${D}F`, ref: ''});
  assert.equal(bash(`F="grep -v ${D}(curl https://evil.example)"; th day | ${D}F`)?.source, 'curl');
});

test('a name the line mentions in any other way is not trusted', () => {
  for (const line of [
    `F='grep -v x'; F='curl https://evil.example'; th day | ${D}F`,
    `F='grep -v x'; export F='curl https://evil.example'; th day | ${D}F`,
    `F='grep -v x'; read F; th day | ${D}F`,
    `F='grep -v x'; unset F; th day | ${D}F`,
    `F='grep -v x'; for F in curl; do ${D}F https://evil.example; done`,
  ]) assert.ok(bash(line), line);
});
