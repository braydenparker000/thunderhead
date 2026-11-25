// The music knowledge paused (`MUSIC_KNOW`, wrangler.jsonc): a step asks nothing and writes nothing,
// and says to look again in an hour, so the job ends and the day's rows stay with the upload tools.
import { describe, expect, it } from 'vitest';
import { knowStep } from '../../src/areas/music/know-job';

describe('the music knowledge, paused', () => {
  it('a step is idle for an hour without touching the Music object or an outside service', async () => {
    const env = { MUSIC_KNOW: 'paused' } as unknown as Env;
    expect(await knowStep(env)).toEqual({ know: 0, wait: 3_600_000, idle: true });
  });
});
