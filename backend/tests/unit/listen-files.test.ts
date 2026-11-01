// The listening pass's housekeeping (areas/music/listen-files.ts): deleting an expired job's files and
// sweeping what closed jobs left must never stop the next job from being issued. A bucket that fails
// every call is logged as a count and the call goes on.
import { describe, expect, it, vi } from 'vitest';
import { tidy } from '../../src/areas/music/listen-files';

const broken = {
  list: async () => {
    throw new Error('r2 down');
  },
  delete: async () => {
    throw new Error('r2 down');
  },
} as unknown as R2Bucket;

describe('housekeeping never throws', () => {
  it('counts the failures, logs a count only, and returns', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const failed = await tidy(broken, ['0190a0a0-0000-7000-8000-000000000001'], () => false);
    expect(failed).toBe(2);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ evt: 'listen_tidy_failed', count: 2 }));
    log.mockRestore();
  });

  it('without a sweep asked for, lists nothing', async () => {
    const list = vi.fn();
    const quiet = { list, delete: vi.fn() } as unknown as R2Bucket;
    expect(await tidy(quiet, [], null)).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });
});
