// Measures the password hash inside the Auth object on local workerd (decision X3 still needs
// the production run). Wall time is taken by the test around each call, because in production
// Date.now() and performance.now() stand still during synchronous CPU work. (Local workerd's
// clock does move, so the inside reading is reported too; see MEASUREMENTS.md.)
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { hashPassword, type KdfParams } from '../../src/areas/auth/crypto';
import { auth, login, PASSWORD, setupOwner } from '../helpers';

const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timeInAuth(params: KdfParams | null): Promise<{ wall: number[]; insideClock: number[] }> {
  const wall: number[] = [];
  const insideClock: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    const inside = await runInDurableObject(auth(), () => {
      const p0 = performance.now();
      if (params) hashPassword(PASSWORD, new Uint8Array(16), params, env.AUTH_PEPPER);
      return performance.now() - p0;
    });
    wall.push(Date.now() - t0);
    insideClock.push(inside);
  }
  return { wall, insideClock };
}

describe('scrypt inside the Auth object (local workerd)', () => {
  it('times the decided and the fallback settings', async () => {
    const empty = await timeInAuth(null);
    const n14 = await timeInAuth({ n: 2 ** 14, r: 8, p: 1 });
    const n15 = await timeInAuth({ n: 2 ** 15, r: 8, p: 3 });
    await setupOwner();
    const signins: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = Date.now();
      expect((await login(`192.0.2.${230 + i}`)).status).toBe(200);
      signins.push(Date.now() - t0);
    }
    const report = {
      'empty RPC (overhead)': median(empty.wall),
      'scrypt N=2^14 r=8 p=1': median(n14.wall),
      'scrypt N=2^15 r=8 p=3': median(n15.wall),
      'POST /v1/auth/login end to end': median(signins),
      'scrypt N=2^15 r=8 p=3, clock inside the object': Math.round(median(n15.insideClock)),
      'scrypt N=2^14 r=8 p=1, clock inside the object': Math.round(median(n14.insideClock)),
    };
    console.log(JSON.stringify({ median_wall_ms: report, runs: { n14: n14.wall, n15: n15.wall, signins } }));
    // Loose bounds: this proves the work ran, not how fast the edge is.
    expect(report['scrypt N=2^15 r=8 p=3']).toBeGreaterThan(report['scrypt N=2^14 r=8 p=1']);
    expect(report['scrypt N=2^15 r=8 p=3']).toBeLessThan(5000);
  });
});
