// The hourly touch in verify() never fails a request (Free plan: 100,000 rows written a day): once
// the day's writes are spent the touch throws, and the request still goes ahead.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SignedInWithCode } from '../../../shared/contract/api';
import * as account from '../../src/areas/auth/account';
import { tokenHash } from '../../src/areas/auth/crypto';
import { noBreachCheck } from '../../src/areas/auth/passwords';
import { HOUR } from '../../src/lib/time';
import { Db, Meter } from '../../src/objects/base';
import { authSql, inAuth, makeAgent, setupOwner } from '../helpers';

let owner: SignedInWithCode;
let spentKey = '';
beforeAll(async () => {
  owner = await setupOwner();
  spentKey = await makeAgent(owner.token, 'mind:reflex', 'spent-day');
});

/** A store whose writes all throw, as SQLite does once the day's writes are spent. */
class SpentDb extends Db {
  override run(): number {
    throw new Error('daily write limit exceeded');
  }
}

describe('verify() when the day is out of writes', () => {
  it('a device and an agent key still get through when the hourly touch throws', async () => {
    await authSql('UPDATE sessions SET last_seen_at = last_seen_at - ?', 2 * HOUR);
    await authSql('UPDATE agents SET last_used_at = NULL');
    const out = await inAuth((_o, s) => {
      const d = {
        db: new SpentDb(s.storage.sql, new Meter()),
        storage: s.storage,
        pepper: env.AUTH_PEPPER,
        ipKey: env.IP_HASH_KEY,
        setupFp: null,
        resetFp: null,
        breached: noBreachCheck,
      };
      return [
        account.verify(d, tokenHash(owner.token), false, null),
        account.verify(d, tokenHash(spentKey), true, null),
      ];
    });
    expect(out[0]).toMatchObject({ ok: true, kind: 'device' });
    expect(out[1]).toMatchObject({ ok: true, kind: 'agent', role: 'mind:reflex' });
  });
});
