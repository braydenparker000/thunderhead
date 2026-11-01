// Core's cron tick as a measured call (cost.test.ts). From 02:30 (the owner's time) on Sundays the
// first tick also starts the weekly backup, a job of its own with its own costs (backups' tests):
// it is marked as started first, as the backup itself would be, so every tick measured costs the
// same on any day of the week (on a Sunday, two more reads: the tick looks at the backup's state).
import { runInDurableObject } from 'cloudflare:test';
import { weeklyDue } from '../../src/areas/backups/ops';
import { backupId, insertBackup } from '../../src/areas/backups/store';
import { ownerDay, wallMinute } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';
import type { Core } from '../../src/objects/core';

export async function ticks(k: unknown, measure: (tick: () => Promise<Response>) => Promise<void>): Promise<void> {
  const stub = k as DurableObjectStub<Core>;
  await runInDurableObject(stub, (o: Core) => {
    const c = o as unknown as { db: Db; tz(): string };
    const now = Date.now();
    const day = ownerDay(now, c.tz());
    if (weeklyDue(c.db, day, wallMinute(now, c.tz())))
      insertBackup(c.db, { id: backupId(day, 'core'), date: day, cls: 'core', job_id: 'cost-test', at: now });
  });
  await measure(async () => {
    await runInDurableObject(stub, (o: Core) => o.tick());
    return new Response(null, { status: 204 });
  });
}
