// Fires a wake the Core decided on and records the outcome, from a Worker route's waitUntil (the
// owner's request returns at once; the fire runs after it).
import { inSandbox } from '../../http/sandbox';
import { coreObject } from '../../objects/core';
import { fire, fireConfig } from './fire';

export async function fireWake(
  env: Env,
  wake: { id: string; task: 'chat' | 'night' | 'reflex' } | null,
): Promise<void> {
  // The eval sandbox never wakes a real session (EVALS.md §1.1).
  if (!wake || inSandbox()) return;
  const cfg = fireConfig(env, wake.task);
  if (!cfg) return;
  const result = await fire(cfg);
  await coreObject(env).recordFire(wake.id, result);
  if (result.error)
    console.log(JSON.stringify({ evt: 'fire', wake: wake.id, status: result.status, error: result.error }));
}
