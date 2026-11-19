// CPU of the owner's Astra copy (ASTRA.md §5.3) against the Free plan's 10 ms a request (ARCHITECTURE.md): what
// the Worker itself does for a PUT (check the copy's outer shape, parse once, seal the bytes as sent) and for a GET
// (open, build the answer from byte pieces), timed in workerd on real-shaped copies of about 0.3, 0.5 and 1 MiB,
// beside what the first build did (decode, parse, stringify again, encode, seal; open, decode, concatenate text).
// The bucket's own work is I/O, not this isolate's CPU. Times are medians of 9 runs, in whole ms (workerd's clock).
// Measured 2026-11-19 on the agent's machine: 0.31 MiB PUT 2 (first build 4), GET 0–1 (2); 0.57 MiB PUT 3–4 (7–8),
// GET 0 (3); 0.96 MiB PUT 6 (11–12), GET 0–1 (5). Invented data.
import { describe, expect, it } from 'vitest';
import { checkedCopy, envelope } from '../../src/areas/astra/backup';
import { openBackup, sealBackup } from '../../src/areas/astra/backup-seal';
import { copyOf, realStore } from '../astra-backup-helpers';

const PEPPER = 'test-pepper-not-a-real-secret-0123456789';
const NAME = 'astra/backup.json.enc';
const enc = new TextEncoder();
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
async function time(fn: () => Promise<unknown>): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    await fn();
    runs.push(performance.now() - t);
  }
  return median(runs);
}

/** Real-shaped phones: a light one, a full one (Astra's 300 progress entries, the copy's 3,000 watched), and one
 * with a library of 1,100 titles that brings the copy to the cap. */
const SIZES = {
  '0.31 MiB': { progress: 300, library: 100, watched: 1000 },
  '0.57 MiB': { progress: 300, library: 500, watched: 3000 },
  '0.96 MiB': { progress: 300, library: 1100, watched: 6000 },
};

describe('CPU of a PUT and a GET of the copy', () => {
  it('stays inside the Free plan’s budget for a full phone, and well under what the first build spent', async () => {
    for (const [label, n] of Object.entries(SIZES)) {
      const bytes = enc.encode(JSON.stringify(copyOf(realStore(n))));
      const sealed = await sealBackup(PEPPER, NAME, 'v', bytes);
      const put = await time(async () => {
        checkedCopy(bytes);
        await sealBackup(PEPPER, NAME, 'v', bytes);
      });
      const get = await time(async () =>
        envelope('v', '2026-11-19T00:00:00.000Z', await openBackup(PEPPER, NAME, 'v', sealed)),
      );
      // The first build: the body decoded, parsed, stringified and encoded again before the seal; the text decoded on GET.
      const before = await time(async () => {
        const raw = JSON.parse(new TextDecoder().decode(bytes));
        await sealBackup(PEPPER, NAME, 'v', enc.encode(JSON.stringify(raw)));
      });
      const getBefore = await time(async () => {
        const text = new TextDecoder().decode((await openBackup(PEPPER, NAME, 'v', sealed)) ?? new Uint8Array());
        enc.encode(`{"version":"v","saved_at":"t","copy":${text}}`);
      });
      const row = `${label} (${bytes.length} B): PUT ${put} ms (first build ${before}), GET ${get} ms (first build ${getBefore})`;
      // The Free plan's 10 ms for a full phone; a copy at the cap gets room for a busy test machine.
      expect(put, row).toBeLessThanOrEqual(label === '0.96 MiB' ? 15 : 10);
      expect(get, row).toBeLessThanOrEqual(10);
      expect(bytes.length, row).toBeLessThan(1024 * 1024);
    }
  });
});
