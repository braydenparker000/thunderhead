// Reminders' pure rules on a fixed clock (BEHAVIOR.md §3.4 "Owner-set reminders", HOME.md §6.2):
// a time inside the owner's quiet hours moves to their end, in the owner's zone, across midnight
// and a clock change, never before 06:30; a reminder's push waits only for quiet hours, not for the
// natural pause, "go quiet", the 2 a day or the 2 h gap.
import { describe, expect, it } from 'vitest';
import { mayGo, type PushContext } from '../../src/areas/push/rules';
import { fireAt } from '../../src/areas/reminders/ops';
import { QUIET_DEFAULT, type QuietWindow } from '../../src/areas/settings/quiet';

const ZONE = 'Pacific/Chatham';
const iso = (s: string) => Date.parse(s);

describe('a reminder in quiet hours moves to their end (22:00–06:30, the owner’s zone)', () => {
  const q = QUIET_DEFAULT;
  it('just before, inside, at the end and after the window', () => {
    // Late October 2026 the zone is on daylight time, UTC+13:45.
    const before = iso('2026-10-30T21:59:00+13:45');
    expect(fireAt(before, ZONE, q)).toBe(before);
    expect(fireAt(iso('2026-10-30T22:00:00+13:45'), ZONE, q)).toBe(iso('2026-10-31T06:30:00+13:45'));
    expect(fireAt(iso('2026-10-31T06:29:00+13:45'), ZONE, q)).toBe(iso('2026-10-31T06:30:00+13:45'));
    const end = iso('2026-10-31T06:30:00+13:45');
    expect(fireAt(end, ZONE, q)).toBe(end);
    const after = iso('2026-10-31T15:00:00+13:45');
    expect(fireAt(after, ZONE, q)).toBe(after);
  });

  it('across midnight: before it to the next morning, after it to the same morning', () => {
    expect(fireAt(iso('2026-10-30T23:30:00+13:45'), ZONE, q)).toBe(iso('2026-10-31T06:30:00+13:45'));
    expect(fireAt(iso('2026-10-31T02:00:00+13:45'), ZONE, q)).toBe(iso('2026-10-31T06:30:00+13:45'));
  });

  it('across the clock change: 06:30 on the new clock', () => {
    // The zone leaves daylight time at 03:45 on 2027-04-04 (UTC+13:45 → +12:45) and enters it at
    // 02:45 on 2027-09-26.
    expect(fireAt(iso('2027-04-03T23:00:00+13:45'), ZONE, q)).toBe(iso('2027-04-04T06:30:00+12:45'));
    expect(fireAt(iso('2027-09-26T01:30:00+12:45'), ZONE, q)).toBe(iso('2027-09-26T06:30:00+13:45'));
  });

  it('the same instant in another zone is its own wall clock', () => {
    const at = iso('2026-10-30T08:45:00Z'); // 22:30 in the zone (inside), 08:45 in UTC (outside)
    expect(fireAt(at, ZONE, q)).toBe(iso('2026-10-31T06:30:00+13:45'));
    expect(fireAt(at, 'UTC', q)).toBe(at);
  });

  it('a later end and an earlier start move it to that end; quiet hours off move nothing', () => {
    const late: QuietWindow = { start: 21 * 60, end: 7 * 60 + 15 };
    expect(fireAt(iso('2026-10-30T21:00:00+13:45'), ZONE, late)).toBe(iso('2026-10-31T07:15:00+13:45'));
    expect(fireAt(iso('2026-10-31T07:00:00+13:45'), ZONE, late)).toBe(iso('2026-10-31T07:15:00+13:45'));
    const off: QuietWindow = { start: 6 * 60 + 30, end: 6 * 60 + 30 };
    const at = iso('2026-10-31T03:00:00+13:45');
    expect(fireAt(at, ZONE, off)).toBe(at);
  });
});

describe('a reminder’s push (rules.ts mayGo)', () => {
  const at = (h: number, m: number) => Date.UTC(2026, 9, 30, h, m);
  const ctx = (now: number, more: Partial<PushContext> = {}): PushContext => ({
    now,
    tz: 'UTC',
    quiet: QUIET_DEFAULT,
    quiet_until: 0,
    looking: false,
    owner_at: null,
    ...more,
  });

  it('never inside quiet hours', () => {
    expect(mayGo('reminder', ctx(at(6, 29)))).toBe(false);
    expect(mayGo('reminder', ctx(at(22, 0)))).toBe(false);
    expect(mayGo('reminder', ctx(at(6, 30)))).toBe(true);
  });

  it('no natural pause, and "go quiet" does not hold it', () => {
    expect(mayGo('reminder', ctx(at(12, 0), { looking: true }))).toBe(true);
    expect(mayGo('reminder', ctx(at(12, 0), { owner_at: at(11, 59) }))).toBe(true);
    expect(mayGo('reminder', ctx(at(12, 0), { quiet_until: at(14, 0) }))).toBe(true);
    expect(mayGo('nudge', ctx(at(12, 0), { looking: true }))).toBe(false);
  });
});
