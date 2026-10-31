// Dictation (HOME.md §6.4, API.md §11.7): POST /v1/dictate sends a few seconds of the owner's voice
// to Workers AI Whisper and answers the words; nothing is stored (no row, no object), silence is
// '' and a failed hearing is 502 so the phone can tell them apart; only the owner's device may call
// it; audio only, ≤ 1 MiB, never empty; a runaway loop is stopped per isolate. The AI binding is a
// fake; the audio and the words are synthetic.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { DICTATE_LIMITS } from '../../../shared/contract/files';
import { app } from '../../src/app';
import { DICTATE_PER_MINUTE } from '../../src/areas/files/routes';
import { type Transcriber, WHISPER } from '../../src/areas/files/transcribe';
import { bytesOf } from '../files-helpers';
import { coreSql } from '../helpers';
import { principals } from '../memory-helpers';

let D = '';
let C = '';
const piece = bytesOf('synthetic opus-in-webm piece');
const WORDS = 'Remind me to water the synthetic seedlings';

function fakeAi(answer: (audio: unknown) => unknown) {
  const calls: { model: string; type?: string }[] = [];
  const AI: Transcriber = {
    run: async (model, inputs) => {
      const audio = inputs.audio as { contentType?: string } | string;
      calls.push({ model, type: typeof audio === 'string' ? 'base64' : audio.contentType });
      return answer(audio);
    },
  };
  return { calls, env: { ...env, AI } as unknown as Env };
}

async function dictate(e: Env, o: { token?: string; type?: string | null; body?: Uint8Array } = {}) {
  const headers = new Headers({ Authorization: `Bearer ${o.token ?? D}`, 'CF-Connecting-IP': '192.0.2.41' });
  if (o.type !== null) headers.set('Content-Type', o.type ?? 'audio/webm;codecs=opus');
  const request = new Request('https://api.example.test/v1/dictate', {
    method: 'POST',
    headers,
    body: o.body ?? piece,
  });
  const res = await app.fetch(request, e, createExecutionContext());
  const body = (await res.json()) as { text?: string; error?: { code: string; retry_after?: number } };
  return { status: res.status, body };
}

beforeAll(async () => {
  ({ D, C } = await principals());
});

describe('POST /v1/dictate', () => {
  it('answers the words heard, trimmed, and keeps nothing', async () => {
    const files = async () => (await coreSql<{ n: number }>('SELECT COUNT(*) AS n FROM files'))[0].n;
    const before = await files();
    const ai = fakeAi(() => ({ text: `  ${WORDS} ` }));
    expect(await dictate(ai.env)).toEqual({ status: 200, body: { text: WORDS } });
    expect(ai.calls).toEqual([{ model: WHISPER, type: 'audio/webm' }]);
    expect(await files()).toBe(before);
  });

  it("silence is '', a failed hearing is 502, no binding is 503", async () => {
    expect(await dictate(fakeAi(() => ({ text: '   ' })).env)).toEqual({ status: 200, body: { text: '' } });
    const broken = fakeAi(() => {
      throw new Error('AiError: 3030: Failed to decode audio file');
    });
    const r = await dictate(broken.env);
    expect([r.status, r.body.error?.code, broken.calls.length]).toEqual([502, 'upstream', 2]);
    expect((await dictate(fakeAi(() => null).env)).status).toBe(502);
    const { AI: _, ...bare } = env as unknown as Record<string, unknown>;
    expect((await dictate(bare as unknown as Env)).body.error?.code).toBe('not_configured');
  });

  it("only the owner's device; audio only, never empty, at most 1 MiB", async () => {
    const ai = fakeAi(() => ({ text: WORDS }));
    expect((await dictate(ai.env, { token: C })).status).toBe(403);
    expect((await dictate(ai.env, { token: 'thd_not_a_token' })).status).toBe(401);
    expect((await dictate(ai.env, { type: 'image/png' })).status).toBe(422);
    expect((await dictate(ai.env, { type: null })).status).toBe(422);
    expect((await dictate(ai.env, { body: new Uint8Array(0) })).status).toBe(422);
    expect((await dictate(ai.env, { body: new Uint8Array(DICTATE_LIMITS.bytes + 1) })).status).toBe(413);
    expect(ai.calls).toEqual([]);
  });

  it('a runaway loop is stopped for the rest of the minute', async () => {
    const ai = fakeAi(() => ({ text: 'x' }));
    const statuses: number[] = [];
    for (let i = 0; i < DICTATE_PER_MINUTE + 1; i++) statuses.push((await dictate(ai.env)).status);
    const last = await dictate(ai.env);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(DICTATE_PER_MINUTE);
    expect([last.status, last.body.error?.code]).toEqual([429, 'rate_limited']);
    expect(last.body.error?.retry_after).toBeGreaterThan(0);
  });
});
