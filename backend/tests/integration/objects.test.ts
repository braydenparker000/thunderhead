// The Durable Objects: classic migrations give SQLite storage, schema steps run once and
// survive restarts, and the cron tidies Auth.
import {
  createExecutionContext,
  createScheduledController,
  evictDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { DeepHealthResponse } from '../../../shared/contract/api';
import worker from '../../src/index';
import { DAY } from '../../src/lib/time';
import { apiJson, auth, authSql, loginOk, setupOwner } from '../helpers';

describe('objects', () => {
  it('runs each migration once, even after the object restarts', async () => {
    await setupOwner();
    await evictDurableObject(auth());
    expect(await authSql('SELECT version FROM _migrations')).toEqual([{ version: 1 }]);
    expect(await authSql('SELECT count(*) AS n FROM credential')).toEqual([{ n: 1 }]);
    const { body } = await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', {
      token: (await loginOk()).token,
    });
    expect(body.schema).toEqual({ core: 9, auth: 1 });
    expect(body.ok).toBe(true);
  });

  it('the cron forgets old sessions, spent counters and old notices', async () => {
    const stale = await loginOk('192.0.2.150');
    await authSql('UPDATE sessions SET idle_expires_at = ? WHERE id = ?', Date.now() - 31 * DAY, stale.session_id);
    await authSql("INSERT INTO throttle VALUES ('signin:old', 3, 1, 1, 1)");
    await authSql(
      "INSERT INTO notices (id, kind, args_json, created_at, expires_at) VALUES ('n-old', 'new_device', '{}', 1, 2)",
    );
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '*/15 * * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await authSql('SELECT id FROM sessions WHERE id = ?', stale.session_id)).toEqual([]);
    expect(await authSql("SELECT key FROM throttle WHERE key = 'signin:old'")).toEqual([]);
    expect(await authSql("SELECT id FROM notices WHERE id = 'n-old'")).toEqual([]);
  });
});
