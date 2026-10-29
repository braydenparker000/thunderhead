// The decision card's logic (frontend/th/decide/model.js, HOME.md §3, COPY.md §3.3) and home's
// voice line for decisions (frontend/th/chat/model.js, HOME.md §2.1 rows 4–6 and 8), without a
// browser. Synthetic cards only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../frontend/th/decide/model.js';
import { needsYou, voiceLine } from '../frontend/th/chat/model.js';
import { proposal } from './fixtures/mock-proposals.mjs';

const NOW = Date.parse('2026-10-29T10:00:00Z');
const H = 3_600_000;

test('only waiting cards past their hold show, soonest expiry first, then the oldest', () => {
  const a = proposal({ expires_at: NOW + 50 * H, created_at: NOW - 2 * H }, NOW);
  const b = proposal({ expires_at: NOW + 10 * H }, NOW);
  const c = proposal({ expires_at: NOW + 50 * H, created_at: NOW - 3 * H }, NOW);
  const held = proposal({ show_from: NOW + H }, NOW);
  const done = proposal({ status: 'executed' }, NOW);
  const old = proposal({ expires_at: NOW - 1 }, NOW);
  assert.deepEqual(m.showing([a, b, c, held, done, old], NOW).map((p) => p.id), [b.id, c.id, a.id]);
  assert.equal(m.nextChange([a, held], NOW), NOW + H);
  assert.equal(m.nextChange([done], NOW), null);
});

test("the why line names who asked and, for an ask-first card, the class's words", () => {
  assert.equal(m.whyLine(proposal({ created_by: 'mind:night', class: 'delete' })), "Night shift · Can't be undone");
  assert.equal(m.whyLine(proposal({ created_by: 'mind:chat', class: 'access' })), 'From our chat · Changes access');
  assert.equal(m.whyLine(proposal({ created_by: 'worker', class: 'access' })), 'Safety check · Changes access');
  assert.equal(m.whyLine(proposal({ created_by: 'mind:reflex', class: 'reach_people' })), 'Watchdog · Reaches someone else');
  assert.equal(m.whyLine(proposal({ class: 'memory_big' })), 'Night shift');
  assert.equal(m.whyLine(proposal({ created_by: 'someone-later' })), "The Thunderhead · Can't be undone");
  assert.equal(m.ofLine(0, 1), '');
  assert.equal(m.ofLine(0, 3), '1 of 3');
});

test('the small lines, the buttons and what each answer says', () => {
  assert.deepEqual(m.details(proposal({ odds: 0.9 })), ['They have had no songs since import.', 'About 90% sure.', 'Nothing happens; they stay.']);
  assert.deepEqual(m.buttons(proposal()), { yes: 'Delete', safe: 'Keep them', safeDecision: 'reject' });
  assert.deepEqual(m.buttons(proposal({ safe: 'snooze', options: ['Pin them', 'Not now'] })), { yes: 'Pin them', safe: 'Not now', safeDecision: 'snooze' });
  assert.deepEqual(m.buttons(proposal({ options: [], safe: 'snooze' })), { yes: 'Yes', safe: 'Not yet', safeDecision: 'snooze' });
  const ok = { status: 'executed', ledger_id: 'l' };
  assert.equal(m.toastFor('approve', ok), 'Done.');
  assert.equal(m.toastFor('approve', { ...ok, status: 'approved' }), 'Done.');
  assert.equal(m.toastFor('approve', { ...ok, status: 'failed' }), "That didn't work. Nothing changed.");
  assert.equal(m.toastFor('reject', { ...ok, status: 'rejected' }), "Okay. I won't.");
  assert.equal(m.toastFor('snooze', { ...ok, status: 'waiting' }), "I'll ask again tomorrow.");
  assert.equal(m.toastFor('snooze', { ...ok, status: 'expired' }), 'That one expired. Nothing was done.');
  assert.equal(m.answered('approve', ok), 'yes');
  assert.equal(m.answered('approve', { ...ok, status: 'failed' }), 'other');
  assert.equal(m.answered('reject', ok), 'other');
  for (const code of ['already_decided', 'expired', 'not_found']) assert.equal(m.settled(code), true);
  assert.equal(m.settled('unavailable'), false);
  assert.equal(m.waitingSuffix(1), '1 waiting');
});

test('the voice line counts waiting decisions and says when the last was answered (rows 4–6, 8)', () => {
  const base = { presence: null, firstRun: false, homeLine: null };
  assert.deepEqual(voiceLine({ ...base, decisions: 1 }), ['One thing needs you.', 'The rest is handled.']);
  assert.deepEqual(voiceLine({ ...base, decisions: 2, homeLine: 'Your new playlist is in Music.' }), ['Two things need you.', 'Your new playlist is in Music.']);
  assert.deepEqual(voiceLine({ ...base, decisions: 12 }), ['Many things need you.', 'The rest is handled.']);
  assert.deepEqual(voiceLine({ ...base, answered: 'yes' }), ['Nothing needs you now.', 'Everything is handled.']);
  assert.deepEqual(voiceLine({ ...base, answered: 'other' }), ['Nothing needs you now.', null]);
  assert.deepEqual(voiceLine({ ...base, answered: 'other', homeLine: 'A line.' }), ['Nothing needs you now.', 'A line.']);
  assert.deepEqual(voiceLine(base), ['Nothing needs you.', null]);
  // The mind not waking and the first run still come first.
  assert.deepEqual(voiceLine({ ...base, decisions: 3, presence: { state: 'failed', note: null, since: 0 } }), ["I can't wake just now.", "I'll answer when I'm back."]);
  // HOME.md §2.2: line 1 is at most 22 characters.
  for (let n = 1; n <= 12; n++) assert.ok(needsYou(n).length <= 22, needsYou(n));
});
