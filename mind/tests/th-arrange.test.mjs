// The verbs of batch 2 from the mind's side: `th help` lists each with its args, where it runs, its
// class and its undo, the classes name them, and the apps' arrangement kinds show their slots.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, startFake, th} from './helpers.mjs';

const VERBS = {
  'astra.shortlist': 'worker · watch · undo stored',
  'media.shortlist': 'worker · watch · undo stored',
  'study.mark_next': 'worker · practice · undo stored',
  'study.pace_goal': 'worker · practice · undo stored',
  'guitar.set_plan': 'worker · practice · undo stored',
  'thread.file': 'worker · titles · undo stored',
  'reminder.snooze_rule': 'worker · reminders · undo stored',
};

test('th help lists batch 2 with where each runs, its class and its undo, and the arrangement slots', async () => {
  const fake = await startFake({});
  try {
    const help = (await th(['help'], env(fake))).stdout;
    for (const [name, tag] of Object.entries(VERBS)) {
      const line = help.split('\n').find(l => l.startsWith(`  ${name} v1 `));
      assert.ok(line, `${name} is listed`);
      assert.ok(line.includes(`[${tag}]`), `${name}: ${line}`);
    }
    assert.match(help, /practice \(default [a-z]+\): study\.mark_next, study\.pace_goal, guitar\.set_plan/);
    assert.match(help, /watch \(default [a-z]+\): astra\.shortlist, media\.shortlist/);
    assert.match(help, /^ {2}shortlist in astra \^tonight\$; media \^tonight\$/m);
    for (const kind of ['mix in music', 'section in guitar', 'episode in podcasts', 'passage in study'])
      assert.match(help, new RegExp(`^ {2}${kind} `, 'm'));
    assert.match(help, /study\.pace_goal v1 \{pages, evidence\}.*the owner's messages/);
  } finally {
    await fake.stop();
  }
});
