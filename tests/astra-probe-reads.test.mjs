// What describing a film asks Mediabunny for (probe.js). DTS's codec string and decoder setup come from its first
// frame, which Mediabunny finds by reading the film's first cluster whole: on a 25 Mbit/s film that was 5 MB before
// anything could be planned, and Mediabunny's getMimeType() asked the same of every track again once describing was over
// (scripts/astra/real.mjs, 2026-11-18). Where the browser takes no DTS as it is (here: Node has no Media Source at all),
// neither is asked, and the film's MIME type is put together from the codec strings read. dts.mkv: scripts/astra/fixtures.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as MB from '../frontend/astra/vendor/mediabunny.js';
import { probe } from '../frontend/astra/src/engine/probe.js';

const bytes = new Uint8Array(readFileSync(new URL('./fixtures/astra/dts.mkv', import.meta.url)));

/** A host that honours ranges, from the bytes above. */
const fetchFn = async (url, { headers = {}, method = 'GET' }) => {
  const [, a, b] = /bytes=(\d*)-(\d*)/.exec(headers.Range || 'bytes=0-');
  const from = +a, to = b ? Math.min(+b + 1, bytes.length) : bytes.length;
  const body = method === 'HEAD' ? null : bytes.slice(from, to);
  return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${to - 1}/${bytes.length}`, 'content-length': String(to - from) } });
};

test('a DTS track the browser cannot take as it is: its first frame is not asked for, nor the MIME type of Mediabunny', async (t) => {
  const asked = [];
  for (const [proto, name] of [[MB.InputAudioTrack.prototype, 'getDecoderConfig'], [MB.InputAudioTrack.prototype, 'getCodecParameterString'], [MB.Input.prototype, 'getMimeType']]) {
    const own = proto[name];
    proto[name] = function (...args) { asked.push(`${name} ${this.codec ?? ''}`.trim()); return own.apply(this, args); };
    t.after(() => { proto[name] = own; });
  }
  const probed = await probe('https://files.example/film.mkv', { fetchFn });
  t.after(() => { probed.input?.dispose(); probed.source?.close(); });
  const dts = probed.info.audio.find((a) => a.codec === 'dts');
  assert.ok(dts, 'the film has a DTS track');
  assert.deepEqual(asked.filter((x) => /dts|getMimeType/.test(x)), [], `nothing of the DTS track (${asked.join(', ')})`);
  assert.equal(dts.codecString, null);
  assert.equal(dts.label, 'DTS', 'it is still named');
  assert.match(probed.info.mime, /^video\/x-matroska; codecs="avc1\.[0-9a-f]+/);
});
