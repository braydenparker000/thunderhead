// ids and time (DATA.md §2.1–2.2).
import { describe, expect, it } from 'vitest';
import { importedId, UUIDV7, uuidv7, uuidv7Time } from '../../src/lib/ids';
import { floorHour, ownerDay, utcDay } from '../../src/lib/time';

describe('ids and time', () => {
  it('makes UUIDv7s that carry their time, sort by it and stay unique within one ms', () => {
    const at = Date.UTC(2026, 9, 28, 12, 0, 0);
    const a = uuidv7(at);
    expect(a).toMatch(UUIDV7);
    expect(uuidv7Time(a)).toBe(at);
    expect(a < uuidv7(at + 1)).toBe(true);
    expect(new Set(Array.from({ length: 10_000 }, () => uuidv7(at))).size).toBe(10_000);
  });

  it('gives an imported row the same UUIDv7 on every run, from its dataset, old id and time', async () => {
    const at = Date.UTC(2025, 2, 4, 9, 30);
    const a = await importedId('messages', 'm1', at);
    expect(a).toMatch(UUIDV7);
    expect(uuidv7Time(a)).toBe(at);
    expect(await importedId('messages', 'm1', at)).toBe(a);
    expect(await importedId('threads', 'm1', at)).not.toBe(a);
    expect(await importedId('messages', 'm2', at)).not.toBe(a);
  });

  it("gives the owner's local day for a zone, not the UTC day", () => {
    const at = Date.UTC(2026, 9, 28, 2, 30); // 23:30 the evening before in a UTC-3 zone
    expect(ownerDay(at, 'Etc/GMT+3')).toBe('2026-10-27');
    expect(utcDay(at)).toBe('2026-10-28');
    expect(floorHour(at)).toBe(Date.UTC(2026, 9, 28, 2, 0));
  });
});
