// When the phone sends its push subscription again (frontend/th/push/due.js, used by th/push/phone.js `recheck`;
// MENU-AND-SETTINGS.md §4.3): made again, another session or endpoint, never sent, or sent more than a day ago,
// so a subscription the Worker dropped comes back within a day. And Settings never asks to turn an On switch
// off and on again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RESEND_MS, resendDue, sentMark } from '../frontend/th/push/due.js';

const NOW = Date.UTC(2026, 10, 21, 9);
const at = (mark, o = {}) => resendDue({ made: false, mark, session: 's1', endpoint: 'https://push.example.test/a', now: NOW, ...o });

test('a subscription sent for this session within the day is not sent again', () => {
  assert.equal(at(sentMark('s1', 'https://push.example.test/a', NOW - 60_000)), false);
  assert.equal(at(sentMark('s1', 'https://push.example.test/a', NOW - RESEND_MS)), false, 'exactly a day: not yet');
});

test('sent more than a day ago, it is sent again (the PUT is idempotent)', () => {
  assert.equal(at(sentMark('s1', 'https://push.example.test/a', NOW - RESEND_MS - 1)), true);
  assert.equal(RESEND_MS, 24 * 60 * 60 * 1000);
});

test('made again, never sent, another session or endpoint, an older mark without a time, or a clock gone back: sent', () => {
  const fresh = sentMark('s1', 'https://push.example.test/a', NOW - 1000);
  assert.equal(at(fresh, { made: true }), true);
  assert.equal(at(null), true);
  assert.equal(at(fresh, { session: 's2' }), true);
  assert.equal(at(fresh, { endpoint: 'https://push.example.test/b' }), true);
  assert.equal(at('s1|https://push.example.test/a'), true, 'the mark before this one had no time');
  assert.equal(at(sentMark('s1', 'https://push.example.test/a', NOW + 60_000)), true);
});

test('phone.js keeps the time it sent in localStorage and decides by due.js; Settings never says off and on while On', () => {
  const phone = readFileSync(new URL('../frontend/th/push/phone.js', import.meta.url), 'utf8');
  assert.match(phone, /mark\(sentMark\(.*Date\.now\(\)\)\)/);
  assert.match(phone, /localStorage\.setItem\(SENT, value\)/);
  assert.match(phone, /if \(resendDue\(\{ made, mark: await marker\(\)/);
  const settings = readFileSync(new URL('../frontend/apps/settings/notifications.js', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /off and on/i);
  assert.match(settings, /push\.resend\(\)/);
});
