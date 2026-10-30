// Voice memos (HOME.md §6.2) and what the mind is handed: an audio upload with TH-Seconds is
// transcribed by Workers AI Whisper after it is stored, inside a deadline, and its words (at most
// 16,000 characters) stay on the row and come back with it; a failure, a refusal, no binding or the
// deadline leave no words and the upload still succeeds. The owner's message then reaches the mind
// with every attachment and the memo's words: GET /v1/live/wait (`th wait`), the thread reads
// (`th history`), the briefing and the pending ids (the Stop hook). The AI binding is a fake; words synthetic.

import { env } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  Attachment,
  BriefResponse,
  LiveWaitResponse,
  Message,
  PendingResponse,
} from '../../../shared/contract/api';
import { TEXT_MAX, TRANSCRIBE_BYTES, type Transcriber, transcribe, WHISPER } from '../../src/areas/files/transcribe';
import { uuidv7 } from '../../src/lib/ids';
import { bytesOf, upload, uploaded } from '../files-helpers';
import { apiJson, coreSql } from '../helpers';
import { as, CHAT_SESSION, principals } from '../memory-helpers';

let D = '';
let C = '';
const memo = bytesOf('synthetic opus-in-webm bytes');
const WORDS = 'Pick up the synthetic parcel at noon.';
const read = async (s: ReadableStream) => new Uint8Array(await new Response(s).arrayBuffer());

/** A fake AI binding: records each call's model and audio, then answers with `answer(audio)`. */
function fakeAi(answer: (audio: unknown) => unknown) {
  const calls: { model: string; audio: unknown }[] = [];
  const AI: Transcriber = {
    run: async (model, inputs) => {
      const audio = inputs.audio as { body?: ReadableStream; contentType?: string } | string;
      const seen =
        typeof audio === 'string'
          ? audio
          : { contentType: audio.contentType, bytes: await read(audio.body as ReadableStream) };
      calls.push({ model, audio: seen });
      return answer(audio);
    },
  };
  return { calls, env: { ...env, AI } as unknown as Env };
}
const say = (seconds = '42') => ({ token: D, bytes: memo, type: 'audio/webm;codecs=opus', name: 'Memo.webm', seconds });

beforeAll(async () => {
  ({ D, C } = await principals());
});

describe('transcription', () => {
  it('sends the stored memo as a stream with its type; the words come back and stay on the row', async () => {
    const ai = fakeAi(() => ({ text: `  ${WORDS}  `, word_count: 7 }));
    const r = await upload(say(), ai.env);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ type: 'audio/webm', seconds: 42, text: WORDS });
    expect(ai.calls).toEqual([{ model: WHISPER, audio: { contentType: 'audio/webm', bytes: memo } }]);
    expect(await coreSql('SELECT text, seconds FROM files WHERE id = ?', r.id)).toEqual([{ text: WORDS, seconds: 42 }]);
  });

  it('when the model refuses the stream form, the same bytes go once more as base64', async () => {
    const ai = fakeAi((audio) => {
      if (typeof audio !== 'string') throw new Error('AiError: 5006: Type mismatch of input audio');
      return { text: WORDS };
    });
    const r = await upload(say(), ai.env);
    expect([r.status, r.body.text, ai.calls.length]).toEqual([201, WORDS, 2]);
    expect(new Uint8Array(Buffer.from(ai.calls[1].audio as string, 'base64'))).toEqual(memo);
  });

  it('no words after a failure, an answer without text or no binding; the upload still succeeds', async () => {
    for (const ai of [
      fakeAi(() => {
        throw new Error('AiError: 3030: Failed to decode audio file');
      }),
      fakeAi(() => ({ text: '   ' })),
      fakeAi(() => null),
    ]) {
      const r = await upload(say(), ai.env);
      expect([r.status, r.body.text, r.body.seconds]).toEqual([201, undefined, 42]);
    }
    const bare = await upload(say());
    expect([bare.status, bare.body.text]).toEqual([201, undefined]);
    expect((await coreSql<{ text: null }>('SELECT text FROM files WHERE id = ?', bare.id))[0].text).toBeNull();
  });

  it('only a memo (audio with its seconds) is sent; words past 16,000 characters are cut', async () => {
    const ai = fakeAi(() => ({ text: 'word '.repeat(5_000) }));
    await uploaded({ token: D, bytes: memo, type: 'audio/webm', name: 'song.webm' }, ai.env);
    await uploaded({ token: D, bytes: memo, type: 'image/png', name: 'chart.png' }, ai.env);
    expect(ai.calls).toEqual([]);
    const long = await upload(say('600'), ai.env);
    expect([long.status, long.body.text?.length]).toEqual([201, TEXT_MAX - 1]);
  });

  it('gives up at the deadline, and tells the binding to stop', async () => {
    let signal: AbortSignal | undefined;
    const hanging: Transcriber = {
      run: (_m, _i, o) => {
        signal = o?.signal;
        return new Promise(() => undefined);
      },
    };
    const started = Date.now();
    expect(await transcribe(hanging, memo.buffer as ArrayBuffer, 'audio/webm', 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(signal?.aborted).toBe(true);
    expect(await transcribe(null, memo.buffer as ArrayBuffer, 'audio/webm')).toBeNull();
  });

  it('a memo over 10 MB is kept without words, never sent', async () => {
    let calls = 0;
    const counting: Transcriber = { run: async () => ({ text: String(++calls) }) };
    expect(await transcribe(counting, new ArrayBuffer(TRANSCRIBE_BYTES + 1), 'audio/webm')).toBeNull();
    expect(await transcribe(counting, new ArrayBuffer(TRANSCRIBE_BYTES), 'audio/webm')).toBe('1');
    expect(calls).toBe(1);
  });
});

describe('what the mind is handed', () => {
  it('wait, the thread reads and pending carry the owner’s attachments with the memo’s words', async () => {
    const start = (await apiJson<LiveWaitResponse>('GET', '/v1/live/wait?after=0&timeout=1', as(C, CHAT_SESSION))).body;
    const photo = await uploaded({ token: D, bytes: bytesOf(`synthetic photo ${uuidv7()}`) });
    const voice = await upload(say(), fakeAi(() => ({ text: WORDS })).env);
    const sent = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, {
      token: D,
      body: { body: '', kind: 'voice', attachments: [voice.body.ref, photo] },
    });
    expect(sent.status).toBe(201);
    const expected: Attachment[] = [
      { ref: voice.body.ref, name: 'Memo.webm', type: 'audio/webm', bytes: memo.length, seconds: 42, text: WORDS },
      { ref: photo, name: 'synthetic photo.jpg', type: 'image/jpeg', bytes: expect.any(Number) },
    ];
    const waited = await apiJson<LiveWaitResponse>(
      'GET',
      `/v1/live/wait?after=${start.seq}&timeout=1`,
      as(C, CHAT_SESSION),
    );
    expect(waited.body.messages.find((m) => m.id === sent.body.id)?.attachments).toEqual(expected);
    const today = await apiJson<{ messages: Message[] }>('GET', '/v1/threads/today', as(C, CHAT_SESSION));
    expect(today.body.messages.find((m) => m.id === sent.body.id)?.attachments).toEqual(expected);
    const page = await apiJson<{ items: Message[] }>(
      'GET',
      `/v1/threads/${sent.body.thread_id}/messages?limit=5`,
      as(C, CHAT_SESSION),
    );
    expect(page.body.items.find((m) => m.id === sent.body.id)?.attachments).toEqual(expected);
    // The briefing's line names each file, with the memo's length and words.
    const brief = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...as(C, CHAT_SESSION),
      body: { claim: false, session_id: CHAT_SESSION, role: 'chat', constitution_sha256: 'none', th_version: '0.2.0' },
    });
    expect(brief.body.full).toContain(
      `[${voice.body.ref} audio/webm 42 s "Memo.webm": ${WORDS}] [${photo} image/jpeg "synthetic photo.jpg"]`,
    );
    // A name can't close its bracket: it is quoted as JSON.
    const odd = await uploaded({ token: D, bytes: bytesOf(`odd ${uuidv7()}`), type: 'text/plain', name: 'a"] note' });
    const named = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, {
      token: D,
      body: { body: 'odd one', attachments: [odd] },
    });
    expect(named.status).toBe(201);
    const again = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...as(C, CHAT_SESSION),
      body: { claim: false, session_id: CHAT_SESSION, role: 'chat', constitution_sha256: 'none', th_version: '0.2.0' },
    });
    expect(again.body.full).toContain(`text/plain "a\\"] note"]`);
    // The Stop hook's view is ids only: the mind reads the message itself through wait or history.
    const pending = await apiJson<PendingResponse>('GET', '/v1/mind/pending', as(C, CHAT_SESSION));
    expect(pending.body.unanswered).toContain(sent.body.id);
  });
});
