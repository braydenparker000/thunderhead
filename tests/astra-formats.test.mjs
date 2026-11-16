// Astra's three patches to libmedia's readers (frontend/assets/libmedia/licenses/libmedia-modifications.txt) are in
// the vendored chunks, so a fresh copy of libmedia that drops them fails here and not on the owner's phone; and the
// software decoder names the kinds they open to it. The films themselves play in astra-formats-browser.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { softwareAudio, softwareVideo } from '../frontend/astra/src/engine/software.js';

const chunk = (name) => readFileSync(new URL(`../frontend/assets/libmedia/${name}`, import.meta.url), 'utf8');
const once = (text, part) => text.split(part).length - 1;

test('the AVI reader marks H.264 with no decoder setup as Annex B', () => {
  assert.equal(once(chunk('97.avplayer.js'), '}else 27!==e.codecpar.codecId&&173!==e.codecpar.codecId&&196!==e.codecpar.codecId||(e.codecpar.flags|=1);'), 1);
});

test('the MP4 reader knows "s263" (H.263 in 3GP) in both chunks that carry its table', () => {
  assert.equal(once(chunk('749.avplayer.js'), '[(0,r.A)("H263")]:4,[(0,r.A)("s263")]:4,'), 1);
  assert.equal(once(chunk('943.avplayer.js'), '[(0,i.A)("H263")]:4,[(0,i.A)("s263")]:4,'), 1);
});

test('the Matroska reader gives an A_MS/ACM track the codec its WAV format tag names', () => {
  const text = chunk('573.avplayer.js');
  assert.equal(once(text, 'else if("A_MS/ACM"===t.codecId'), 1);
  assert.match(text, /d\.codecpar\.codecId=u\.gi\[d\.codecpar\.codecTag\]\|\|0,d\.codecpar\.bitrate=BigInt\(/);
});

test('the software decoder takes H.263 in 3GP and Windows Media Audio in MKV, and still not what it cannot decode', () => {
  assert.equal(softwareVideo({ codec: null, internalCodec: 's263' }), true);
  assert.equal(softwareAudio({ codec: null, internalCodec: 'A_MS/ACM' }), true);
  assert.equal(softwareAudio({ codec: null, internalCodec: 'A_ALAC' }), false);
  assert.equal(softwareVideo({ codec: null, internalCodec: 'jpeg' }), false, 'Motion JPEG in MOV: read, but no picture came (see the README)');
  assert.equal(softwareVideo({ codec: 'prores' }), false);
});
