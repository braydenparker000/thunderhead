// Attachments on messages (API.md §11.7, PUT /v1/messages/:id): refs only; an owner message takes
// at most 4 of the owner's files, a chat mind message at most 10 of the mind's; each file must exist,
// come from the same kind of author, appear once, and not be on another message (409). The message
// keeps the full attachments in the order given and the files become its in the same commit; a
// refusal changes nothing; a retry answers as before; only an owner message with files may have
// no words. Synthetic bytes and words only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Attachment, ErrorBody, Message } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { bytesOf, uploaded } from '../files-helpers';
import { apiJson, core, coreSql, makeAgent, rowsDuring } from '../helpers';
import { as, CHAT_SESSION, principals } from '../memory-helpers';

let D = '';
let C = '';
let R = '';
type Out = Message & ErrorBody;
const put = (token: string, body: object, id = uuidv7(), session?: string) =>
  apiJson<Out>('PUT', `/v1/messages/${id}`, session ? { ...as(token, session), body } : { token, body });
const owner = (body: object, id?: string) => put(D, body, id);
const mind = (body: object, id?: string) => put(C, body, id, CHAT_SESSION);
const files = (token: string, n: number, type = 'image/jpeg') =>
  Promise.all(
    Array.from({ length: n }, (_, i) => uploaded({ token, bytes: bytesOf(`synthetic file ${i} ${uuidv7()}`), type })),
  );
const takenBy = async (refs: string[]) =>
  (
    await coreSql<{ id: string; message_id: string | null }>(
      `SELECT id, message_id FROM files WHERE id IN (${refs.map(() => '?').join(',')})`,
      ...refs.map((r) => r.slice(5)),
    )
  ).map((r) => r.message_id);

beforeAll(async () => {
  ({ D, C } = await principals());
  R = await makeAgent(D, 'mind:reflex');
});

describe('owner messages', () => {
  it('take up to 4 of the owner’s files, in the order given, which become the message’s', async () => {
    const refs = await files(D, 4);
    const order = [refs[2], refs[0], refs[3], refs[1]];
    const r = await owner({ body: 'Four synthetic photos.', attachments: order });
    expect(r.status).toBe(201);
    expect(r.body.attachments.map((a: Attachment) => a.ref)).toEqual(order);
    expect(r.body.attachments[0]).toEqual({
      ref: order[0],
      name: 'synthetic photo.jpg',
      type: 'image/jpeg',
      bytes: 53,
    });
    expect(await takenBy(refs)).toEqual([r.body.id, r.body.id, r.body.id, r.body.id]);
    const again = await owner({ body: 'Four synthetic photos.', attachments: order }, r.body.id);
    expect([again.status, again.body]).toEqual([200, r.body]);
    const today = await apiJson<{ messages: Message[] }>('GET', '/v1/threads/today', { token: D });
    expect(today.body.messages.find((m) => m.id === r.body.id)?.attachments).toEqual(r.body.attachments);
  });

  it('refuse a fifth, a mind file, an unknown file, one listed twice and a ref that is no file (422), changing nothing', async () => {
    const [a, b, c, d, e] = await files(D, 5);
    const [m] = await files(C, 1);
    const cases: [string[], { path: string; issue: string }[]][] = [
      [[a, b, c, d, e], [{ path: 'attachments', issue: 'at most 4 on an owner message' }]],
      [[a, m], [{ path: 'attachments.1', issue: "uploaded by the mind, not this message's author" }]],
      [[`file:${uuidv7()}`, a], [{ path: 'attachments.0', issue: 'no such file' }]],
      [[a, b, a], [{ path: 'attachments.2', issue: 'listed twice' }]],
      [
        [a, `msg:${uuidv7()}`, 'file:nope'],
        [
          { path: 'attachments.1', issue: 'a file:<id> ref' },
          { path: 'attachments.2', issue: 'a file:<id> ref' },
        ],
      ],
    ];
    for (const [refs, details] of cases) {
      const id = uuidv7();
      const r = await owner({ body: 'synthetic', attachments: refs }, id);
      expect([r.status, r.body.error.code, r.body.error.details], refs.join()).toEqual([422, 'validation', details]);
      expect(await coreSql('SELECT id FROM messages WHERE id = ?', id)).toEqual([]);
    }
    expect(await takenBy([a, b, c, d, e, m])).toEqual([null, null, null, null, null, null]);
  });

  it('a file already on another message is a conflict (409)', async () => {
    const [a, b] = await files(D, 2);
    expect((await owner({ body: 'first', attachments: [a] })).status).toBe(201);
    const r = await owner({ body: 'second', attachments: [b, a] });
    expect([r.status, r.body.error.code, r.body.error.details]).toEqual([
      409,
      'conflict',
      [{ path: 'attachments.1', issue: 'already on another message' }],
    ]);
    expect((await takenBy([b]))[0]).toBeNull();
  });

  it('may have no words only with files', async () => {
    const [a] = await files(D, 1, 'audio/webm');
    const r = await owner({ body: '', kind: 'voice', attachments: [a] });
    expect([r.status, r.body.body, r.body.attachments.length]).toEqual([201, '', 1]);
    const bare = await owner({ body: '' });
    expect([bare.status, bare.body.error.details]).toEqual([
      422,
      [{ path: 'body', issue: 'empty: a message has words or attachments' }],
    ]);
    expect((await owner({ body: 'still fine without files' })).body.attachments).toEqual([]);
  });
});

describe('mind messages', () => {
  it('take up to 10 of the mind’s files; 11 and owner files are refused; words are still needed', async () => {
    const refs = await files(C, 11, 'image/png');
    const r = await mind({ body: 'Ten synthetic charts.', attachments: refs.slice(0, 10) });
    expect([r.status, r.body.attachments.length]).toEqual([201, 10]);
    expect(r.body.attachments.map((a: Attachment) => a.ref)).toEqual(refs.slice(0, 10));
    const eleven = await mind({ body: 'Eleven.', attachments: refs });
    expect([eleven.status, (eleven.body.error.details as { path: string }[])[0]]).toEqual([
      422,
      expect.objectContaining({ path: 'attachments' }),
    ]);
    const [o] = await files(D, 1);
    const wrong = await mind({ body: 'Yours.', attachments: [o] });
    expect([wrong.status, wrong.body.error.details]).toEqual([
      422,
      [{ path: 'attachments.0', issue: "uploaded by the owner, not this message's author" }],
    ]);
    const silent = await mind({ body: '', attachments: [refs[10]] });
    expect([silent.status, silent.body.error.details]).toEqual([
      422,
      [{ path: 'body', issue: 'empty: only an owner message with files' }],
    ]);
  });

  it('night and reflex error lines carry no files', async () => {
    const [m] = await files(C, 1);
    const r = await put(R, { body: 'Synthetic failure.', kind: 'error', thread_id: 'system', attachments: [m] });
    expect([r.status, r.body.error.details]).toEqual([
      422,
      [{ path: 'attachments', issue: 'only the owner and the chat mind' }],
    ]);
  });

  it('a message with 4 files reads and writes 2 and 1 rows more per file', async () => {
    const refs = await files(D, 4);
    const plain = await rowsDuring(core(), async () => {
      expect((await owner({ body: 'no files' })).status).toBe(201);
    });
    const withFiles = await rowsDuring(core(), async () => {
      expect((await owner({ body: 'four files', attachments: refs })).status).toBe(201);
    });
    expect(withFiles.read - plain.read).toBe(8);
    expect(withFiles.written - plain.written).toBe(4);
  });
});
