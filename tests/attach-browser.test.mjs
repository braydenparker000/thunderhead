// The + sheet signed in, in Chromium at 390×844 against the mocked Worker (tests/fixtures/mock-api.mjs):
// photos redrawn and sent above the words, files as rows, the limit of four, a voice memo recorded
// from Chrome's fake microphone and played back, attachments the Worker sends, a photo full screen,
// Remind me with its Undo and its quiet-hours line, and a photo that waits offline in the outbox
// through a reload. CSP violations are console errors, so each test also proves the page fits its CSP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const launch = (args = []) => chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args });
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function open({ chat = {}, b = browser, context = null } = {}) {
  context ??= await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const api = await mockApi(page, { chat });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), TOKEN);
  errors.length = 0;
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('#talk', { state: 'attached' });
  await page.waitForTimeout(300);
  return { page, context, errors, api };
}
async function eventually(read, want, message) {
  const end = Date.now() + 5_000;
  let got = await read();
  while (!isDeepStrictEqual(got, want) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20));
    got = await read();
  }
  assert.deepEqual(got, want, message);
}
/** A synthetic photo this test draws: a field with a light square, `w`×`h`, as PNG bytes. */
const picture = (page, w, h) => page.evaluate(async ([w, h]) => {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#2e7d5b';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#f4f1e8';
  g.fillRect(w / 10, h / 10, w / 3, h / 3);
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())];
}, [w, h]).then((a) => Buffer.from(a));
/** Taps a + sheet item and answers its file picker. */
async function pick(page, item, files) {
  await page.click('#plus');
  await page.waitForSelector('#opts.show');
  const chooser = page.waitForEvent('filechooser');
  await page.click(`#opts [data-act="${item}"]`);
  await (await chooser).setFiles(files);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** A synthetic memo: a second of a tone that swells, as 8 kHz 16-bit WAV. */
function tone() {
  const n = 8000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 4) * 30000 * (i / n)), 44 + i * 2);
  return b;
}

test('photos: redrawn to 2,048 px, shown in the bar, sent with the message and shown above its words', opts, async () => {
  const { page, context, errors, api } = await open();
  const png = await picture(page, 3000, 1500);
  await pick(page, 'photos', [{ name: 'garden.png', mimeType: 'image/png', buffer: png }]);
  await page.waitForSelector('#ask.hasfiles .tray .ti.tpic img');
  assert.match(await page.getAttribute('.tray .ti.tpic img', 'src'), /^data:image\/jpeg/);
  assert.ok(await page.$eval('#ask', (a) => a.classList.contains('typing')), 'send shows with no words');
  await page.fill('#q', 'The garden today');
  await page.press('#q', 'Enter');
  await eventually(() => api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 1);
  const up = api.calls.find((c) => c.call.startsWith('PUT /v1/files/'));
  assert.equal(up.file.type, 'image/jpeg');
  assert.equal(up.file.name, 'garden.jpg');
  assert.equal(up.file.sha256, sha(up.file.body), 'the hash is of the bytes sent');
  assert.equal(up.auth, `Bearer ${TOKEN}`);
  const [w, h] = await page.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    return [bmp.width, bmp.height];
  }, [...up.file.body]);
  assert.deepEqual([w, h], [2048, 1024], 'the long edge is 2,048 px');
  const say = api.calls.find((c) => c.call.startsWith('PUT /v1/messages/'));
  assert.deepEqual(say.body.attachments, [up.file.ref]);
  assert.equal(say.body.body, 'The garden today');
  assert.equal(await page.$('#ask.hasfiles'), null, 'the bar is empty again');
  await page.waitForSelector('#talk .mine .atts .pics.one .pic.ready img');
  assert.deepEqual(await page.$eval('#talk .mine', (m) => [...m.children].map((c) => c.className)), ['atts', 'you'], 'the photo sits above the words');
  assert.deepEqual(errors, []);
  await context.close();
});

test('files: any file as a row; over 25 MB is refused; a message can be only its files', opts, async () => {
  const { page, context, errors, api } = await open();
  await pick(page, 'files', [{ name: 'too-big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) }]);
  await page.waitForSelector('.toast.show');
  assert.equal(await page.textContent('.toast'), 'too-big.bin is over 25 MB.');
  assert.equal(await page.$('#ask.hasfiles'), null);
  const notes = Buffer.from('Plan for the week\n'.repeat(200));
  await pick(page, 'files', [{ name: 'week-plan.txt', mimeType: 'text/plain', buffer: notes }]);
  await page.waitForSelector('.tray .ti.tdoc');
  assert.equal(await page.textContent('.tray .ti.tdoc span'), 'week-plan.txt');
  await page.click('#ask .send');
  await eventually(() => api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 1);
  const say = api.calls.find((c) => c.call.startsWith('PUT /v1/messages/'));
  assert.equal(say.body.body, '');
  assert.equal(say.body.attachments.length, 1);
  await page.waitForSelector('#talk .mine .frow');
  assert.deepEqual(await page.$$eval('#talk .mine .frow span', (s) => s.map((x) => x.textContent)), ['week-plan.txt', '4 KB']);
  assert.equal(await page.$('#talk .mine .you'), null, 'no empty bubble');
  assert.deepEqual(errors, []);
  await context.close();
});

test('at most four on a message', opts, async () => {
  const { page, context, errors } = await open();
  const png = await picture(page, 400, 300);
  await pick(page, 'photos', Array.from({ length: 5 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: png })));
  await page.waitForSelector('.toast.show');
  assert.equal(await page.textContent('.toast'), 'Up to 4 at a time.');
  assert.equal(await page.$$eval('.tray .ti', (t) => t.length), 4);
  await page.click('.tray .ti:first-child .tix');
  assert.equal(await page.$$eval('.tray .ti', (t) => t.length), 3);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a voice memo: the strip shows the level, × throws it away, Stop keeps it; it uploads with its length and plays', opts, async (t) => {
  const fake = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
  // Closed even when an assertion fails: an open browser keeps the run alive until CI's timeout.
  t.after(() => fake.close());
  const context = await fake.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['microphone'] });
  const { page, errors, api } = await open({ b: fake, context });
  const record = async () => {
    await page.click('#plus');
    await page.waitForSelector('#opts.show');
    await page.click('#opts [data-act="memo"]');
    await page.waitForSelector('#ask.recording .rec .rlevel i');
  };
  await record();
  assert.equal(await page.isVisible('#q'), false, 'the strip takes the bar');
  assert.ok(await page.$eval('#edge', (e) => e.classList.contains('listen')), 'the edge shows the microphone is open');
  await page.click('.rec .rx');
  await page.waitForSelector('#ask:not(.recording)');
  assert.equal(await page.$('#ask.hasfiles'), null, 'thrown away');
  assert.equal(await page.$('#edge.listen'), null);
  await record();
  // Chrome's fake microphone beeps once a second: the bars rise with it.
  await page.waitForFunction(() => [...document.querySelectorAll('.rlevel i')].some((b) => parseFloat(b.style.transform.slice(7)) > 0.2), null, { timeout: 4000 });
  await page.waitForFunction(() => document.querySelector('.rtime')?.textContent === '0:02');
  await page.click('.rec .rstop');
  await page.waitForSelector('.tray .ti.tmemo');
  // Leaving the page stops the microphone and keeps what was recorded (PRIVACY.md §7).
  await record();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForSelector('#ask:not(.recording)');
  await eventually(() => page.$$eval('.tray .ti.tmemo', (t) => t.length), 2);
  await page.evaluate(() => { delete document.hidden; });
  await page.click('.tray .ti.tmemo:last-child .tix');
  assert.match(await page.textContent('.tray .ti.tmemo span'), /^0:0[23]$/);
  await page.fill('#q', 'Listen to this');
  await page.press('#q', 'Enter');
  await eventually(() => api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 1);
  const up = api.calls.find((c) => c.call.startsWith('PUT /v1/files/'));
  assert.equal(up.file.type, 'audio/webm');
  assert.ok(up.file.seconds >= 2 && up.file.seconds <= 3, `${up.file.seconds} s`);
  await page.waitForSelector('#talk .mine .vrow');
  await page.click('#talk .mine .vplay');
  await page.waitForSelector('#talk .mine .vplay[aria-label="Pause the voice memo"]');
  await page.waitForFunction(() => document.querySelectorAll('#talk .vwave i.on').length > 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('dictation: hold the mic and the words fill the bar as you speak; let go to edit; a slip or a tap does not dictate', opts, async (t) => {
  const fake = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
  t.after(() => fake.close());
  const context = await fake.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['microphone'] });
  const { page, errors, api } = await open({ b: fake, context });
  const mic = await page.$('#mic');
  const box = await mic.boundingBox();
  const press = () => page.mouse.move(box.x + box.width / 2, box.y + box.height / 2).then(() => page.mouse.down());
  const dictated = () => api.calls.filter((c) => c.call === 'POST /v1/dictate');

  // The mic shows only on an empty bar (once there are words it is send), so a take starts empty.
  await press();
  await page.waitForSelector('#ask.listening #mic[aria-pressed="true"]');
  assert.ok(await page.$eval('#edge', (e) => e.classList.contains('listen')), 'the edge shows the microphone is open');
  // While the finger is down, the piece so far goes every 2 s and its words show at once.
  await page.waitForFunction(() => /^words \d+$/.test(document.querySelector('#q').value), null, { timeout: 5000 });
  assert.ok(await page.isVisible('#mic'), 'the mic stays under the finger while words arrive');
  await page.mouse.up();
  await page.waitForSelector('#ask:not(.listening):not(.finishing)');
  // The last answer is the whole piece, sent once more when the finger lifts.
  const n = dictated().length;
  assert.ok(n >= 2, `${n} pieces sent`);
  assert.equal(await page.inputValue('#q'), `words ${n}`);
  assert.match(dictated()[0].body.type, /^audio\/(webm|ogg)/);
  assert.ok(dictated().every((c) => c.body.bytes > 0));
  assert.equal(await page.$('#edge.listen'), null, 'the microphone is closed');
  assert.equal(await page.$('#ask.recording'), null, 'a hold is not a voice memo');
  assert.equal(await page.getAttribute('#q', 'placeholder'), 'Ask anything');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'q', 'ready to edit');
  assert.ok(await page.isVisible('#ask .send'), 'send is back once the words are in');

  // A slip of the finger (under 0.6 s of listening) keeps nothing and sends nothing.
  await page.fill('#q', '');
  await press();
  await page.waitForSelector('#ask.listening');
  await page.mouse.up();
  await page.waitForSelector('.toast.show');
  assert.match(await page.textContent('.toast'), /Too short\. Nothing was kept\./);
  assert.equal(dictated().length, n);
  assert.equal(await page.inputValue('#q'), '');

  // When the Worker can't hear, the owner is told, and nothing lands in the bar.
  api.state.chat.deaf = true;
  await press();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await page.waitForFunction(() => /Couldn.t hear that/.test(document.querySelector('.toast')?.textContent ?? ''));
  assert.equal(await page.inputValue('#q'), '');
  api.state.chat.deaf = false;

  // A tap is still a voice memo.
  await page.click('#mic');
  await page.waitForSelector('#ask.recording .rec');
  await page.click('.rec .rx');
  await page.waitForSelector('#ask:not(.recording)');
  // The one console line allowed: the 502 the deaf Worker answered on purpose.
  assert.deepEqual(errors.filter((e) => !/status of 502/.test(e)), []);
  await context.close();
});

test("what the Worker sends: a reply's photo opens full screen, files are rows, a memo shows its words, a reminder its line", opts, async () => {
  const ctx = await browser.newContext();
  const scratch = await ctx.newPage();
  const png = await picture(scratch, 600, 400);
  await ctx.close();
  const files = {
    f1: { ref: 'file:f1', name: 'chart.png', type: 'image/png', bytes: png.length, body: png },
    f2: { ref: 'file:f2', name: 'notes.pdf', type: 'application/pdf', bytes: 2_520_000, body: Buffer.from('%PDF-1.4 synthetic') },
    f3: { ref: 'file:f3', name: 'Voice memo 09.12.wav', type: 'audio/wav', bytes: 16_044, body: tone() },
  };
  const att = (f) => ({ ref: f.ref, name: f.name, type: f.type, bytes: f.bytes });
  const at = Date.now() - 60_000;
  const messages = [
    { seq: 1, id: 'm1', thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author: 'owner', origin: 'owner_device', kind: 'text', body: 'What does the week look like?', meta: null, attachments: [{ ...att(files.f3), seconds: 7, text: 'Remember the garden plan and the call on Friday.' }], reply_to: null, created_at: at, delivered_at: null, acked_at: null, answered_at: at },
    { seq: 2, id: 'm2', thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author: 'mind', origin: 'mind', kind: 'text', body: 'Here it is, and the notes.', meta: null, attachments: [att(files.f1), att(files.f2)], reply_to: 'm1', created_at: at + 1000, delivered_at: null, acked_at: null, answered_at: null },
    { seq: 3, id: 'm3', thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author: 'system', origin: 'system', kind: 'text', body: 'Water the seedlings', meta: { reminder: { id: 'r1', at: at + 2000 } }, attachments: [], reply_to: null, created_at: at + 2000, delivered_at: null, acked_at: null, answered_at: null },
  ];
  const { page, context, errors } = await open({ chat: { messages, files } });
  await page.waitForSelector('#talk .reply .atts .pic.ready');
  assert.equal(await page.textContent('#talk .reply .frow .fname'), 'notes.pdf');
  assert.equal(await page.textContent('#talk .reply .frow .fsize'), '2.4 MB');
  assert.equal(await page.textContent('#talk .mine .vtext'), 'Remember the garden plan and the call on Friday.');
  assert.equal(await page.textContent('#talk .mine .vlen'), '0:07');
  // Its real waveform, drawn once it is in view: the tone swells, so the bars rise left to right.
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('#talk .mine .vwave i')].map((i) => parseFloat(i.style.transform.slice(7)) || 0); return b.length === 32 && b[31] > 0.9 && b[1] < 0.2; });
  assert.equal(await page.textContent('#talk .sys.reminder'), 'Water the seedlings');
  assert.equal(await page.$eval('#talk .sys.reminder', (n) => getComputedStyle(n).opacity), '1', 'the line shows');
  await page.click('#talk .reply .pic');
  await page.waitForSelector('.viewer.in img[src^="data:image/png"]');
  assert.equal(await page.$('.ractions'), null, 'a tap on a photo is not a tap on the reply');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.viewer', { state: 'detached' });
  const download = page.waitForEvent('download');
  await page.click('#talk .reply .frow');
  assert.equal((await download).suggestedFilename(), 'notes.pdf');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Remind me: the words in the bar, a quick time, the toast and its Undo; a time in quiet hours says so', opts, async () => {
  const { page, context, errors, api } = await open();
  await page.fill('#q', 'Call the bank');
  // Taken before the sheet opens: it works out "In 1 hour" as it opens (to the minute), so a moment
  // taken after could land a few ms past a minute's turn and the time look early (a CI flake).
  const before = Date.now();
  await page.click('#plus');
  await page.click('#opts [data-act="remind"]');
  await page.waitForSelector('.remind.in');
  assert.equal(await page.inputValue('.remind .rwhat input'), 'Call the bank');
  const labels = await page.$$eval('.remind .rwhen button', (b) => b.map((x) => x.textContent));
  assert.equal(labels[0], 'In 1 hour');
  assert.equal(labels.at(-1), 'Pick a time');
  await page.click('.remind .rwhen button:first-child');
  await eventually(() => api.calls.filter((c) => c.call.startsWith('PUT /v1/reminders/')).length, 1);
  const put = api.calls.find((c) => c.call.startsWith('PUT /v1/reminders/'));
  assert.equal(put.body.text, 'Call the bank');
  assert.ok(put.body.at >= before + 3_600_000 && put.body.at <= Date.now() + 3_660_000);
  await page.waitForSelector('.toast.show .tact');
  const hm = (t) => new Date(t).toTimeString().slice(0, 5);
  assert.match(await page.textContent('.toast'), new RegExp(`^I'll remind you (tomorrow )?at ${hm(put.body.at)}\\.Undo$`));
  assert.equal(await page.inputValue('#q'), '', 'the words left the bar');
  await page.waitForSelector('.remind', { state: 'detached' });
  await page.click('.toast .tact');
  await eventually(() => api.calls.some((c) => c.call === `DELETE ${put.call.slice(4)}`), true);
  await eventually(() => page.textContent('.toast'), 'Reminder cancelled.');

  api.chat.state.shiftTo = new Date(new Date().setHours(30, 30, 0, 0)).getTime(); // 06:30 tomorrow
  await page.click('#plus');
  await page.click('#opts [data-act="remind"]');
  await page.waitForSelector('.remind.in');
  await page.click('.remind .rwhen button:first-child');
  await page.waitForSelector('.toast.show');
  assert.equal(await page.inputValue('.remind .rwhat input'), '', 'nothing in the bar this time');
  await eventually(() => page.$eval('.toast', (t) => t.firstChild?.textContent), 'Say what to remind you of.');
  await page.fill('.remind .rwhat input', 'Stretch');
  await page.click('.remind .rwhen button:first-child');
  await eventually(() => page.$eval('.toast', (t) => t.firstChild?.textContent), "That's in quiet hours. I'll remind you tomorrow at 06:30.");
  assert.deepEqual(errors, []);
  await context.close();
});

test('offline, a photo waits in the outbox, survives a reload, and goes when the phone is back', opts, async () => {
  const first = await open();
  const png = await picture(first.page, 800, 600);
  // Tests block the service worker, which on the phone serves these offline from its cache.
  await first.page.evaluate(() => Promise.all(['sheet', 'show', 'upload'].map((m) => import(`/th/attach/${m}.js`))));
  await first.context.setOffline(true);
  await pick(first.page, 'camera', [{ name: 'shot.png', mimeType: 'image/png', buffer: png }]);
  await first.page.waitForSelector('.tray .ti.tpic');
  await first.page.fill('#q', 'Before I forget');
  await first.page.press('#q', 'Enter');
  await first.page.waitForSelector('#talk .mine .meta');
  assert.equal(await first.page.textContent('#talk .mine .meta'), "Sends when you're back online");
  await first.page.waitForSelector('#talk .mine .pic img[src^="data:"]');
  assert.equal(first.api.calls.filter((c) => c.call.startsWith('PUT /v1/files/')).length, 0);
  await first.page.close();
  await first.context.setOffline(false);
  // The same phone opens home again: the outbox (and the photo's bytes) come back from IndexedDB.
  const again = await open({ context: first.context });
  await eventually(() => again.api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 1);
  const up = again.api.calls.find((c) => c.call.startsWith('PUT /v1/files/'));
  assert.equal(up.file.sha256, sha(up.file.body));
  const say = again.api.calls.find((c) => c.call.startsWith('PUT /v1/messages/'));
  assert.equal(say.body.body, 'Before I forget');
  assert.deepEqual(say.body.attachments, [up.file.ref]);
  assert.deepEqual(again.errors, []);
  await first.context.close();
});
