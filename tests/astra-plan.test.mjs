// Astra's playback planner (frontend/astra/src/engine/plan.js) and the software decoder's own
// tables (software.js): which way each kind of file plays. Every film here is invented; the
// browser's answers are stand-ins, so the rules are tested without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPlayback } from '../frontend/astra/src/engine/plan.js';
import { fixAviTags, fixMkvLayers, sniffContainer, softwareAudio, softwareVideo } from '../frontend/astra/src/engine/software.js';

// A phone like the owner's: H.264, VP9 and AV1 through Media Source; VP8 and Vorbis only in a WebM it plays itself.
const caps = (over = {}) => ({
  mse: (mime) => /avc1|vp09|av01|mp4a|opus|flac/.test(mime) && !/mp4a\.6b/.test(mime),
  native: (mime) => !/ac-3|ec-3|dts|mp4v|apco|hvc1/.test(mime) && (/webm/.test(mime) ? /vp8|vp09|av01|vorbis|opus/.test(mime) : /avc1|vp09|av01|mp4a|opus|flac|mp3/.test(mime)),
  opusEncode: true, software: true, ...over,
});
const video = (codec, codecString, more = {}) => ({ id: 1, type: 'video', codec, codecString, label: more.label || codec || 'Video', ...more });
const audio = (codec, codecString, more = {}) => ({ id: 2, type: 'audio', codec, codecString, channels: 2, label: more.label || codec || 'Audio', language: '', ...more });
const file = (container, v, a = [], more = {}) => ({ readable: true, info: { container, video: v ? [v] : [], audio: a, subtitles: [], ...more } });
const plan = (probe, c = caps(), prefs = {}) => planPlayback(probe, c, prefs);

test('a plain MP4 or WebM the browser plays whole goes to it as it is', () => {
  assert.equal(plan(file('MP4', video('avc', 'avc1.64001e'), [audio('aac', 'mp4a.40.2')])).mode, 'native');
  // VP8 has no place in the MP4 that Media Source takes, and Vorbis would be rebuilt: Chrome plays the WebM itself.
  const webm = plan(file('WebM', video('vp8', 'vp8'), [audio('vorbis', 'vorbis')]));
  assert.equal(webm.mode, 'native');
  // MP3 in an MP4: played whole rather than converted.
  assert.equal(plan(file('MP4', video('avc', 'avc1.64001e'), [audio('mp3', 'mp3')])).mode, 'native');
});

test('a file with something to choose or to convert is unpacked', () => {
  const ac3 = plan(file('Matroska', video('avc', 'avc1.640028'), [audio('ac3', 'ac-3', { label: 'Dolby Digital' })]));
  assert.equal(ac3.mode, 'remux');
  assert.equal(ac3.audio.delivery, 'rebuilt');
  assert.match(ac3.notes.join(' '), /Dolby Digital audio is converted/);
  const two = plan(file('MP4', video('avc', 'avc1.64001e'), [audio('aac', 'mp4a.40.2'), audio('aac', 'mp4a.40.2', { id: 3 })]));
  assert.equal(two.mode, 'remux');
  // AC-3 in an MP4 the browser cannot play whole: unpacked, the sound converted.
  assert.equal(plan(file('MP4', video('avc', 'avc1.64001e'), [audio('ac3', 'ac-3')])).mode, 'remux');
});

test('a picture only the software decoder has goes to it, named or not', () => {
  assert.equal(plan(file('Matroska', video('hevc', 'hvc1.1.6.L120.90'), [audio('aac', 'mp4a.40.2')])).mode, 'software');
  for (const id of ['V_MPEG2', 'V_MPEG4/ISO/ASP', 'V_THEORA', 'V_MJPEG', 'V_MS/VFW/FOURCC', 'mp4v']) {
    const p = plan(file('Matroska', video(null, null, { internalCodec: id }), [audio('mp3', 'mp3')]));
    assert.equal(p.mode, 'software', id);
    assert.equal(p.audio.delivery, 'software');
  }
  // No software decoder on this device, or none for the codec: refused with a reason, never a black screen.
  assert.equal(plan(file('Matroska', video(null, null, { internalCodec: 'V_MPEG2' }), []), caps({ software: false })).mode, 'unsupported');
  const prores = plan(file('QuickTime File Format', video('prores', 'apco', { label: 'ProRes' }), [audio('pcm-s16', 'pcm-s16')]));
  assert.equal(prores.mode, 'unsupported');
  assert.match(prores.reason, /ProRes/);
  assert.equal(prores.external, true);
});

test('sound only the software decoder has takes the whole file there', () => {
  // A browser that cannot convert audio (no Opus encoder): Dolby Digital still plays, through the software decoder.
  const ac3 = plan(file('Matroska', video('avc', 'avc1.64001e'), [audio('ac3', 'ac-3', { label: 'Dolby Digital' })]), caps({ opusEncode: false }));
  assert.equal(ac3.mode, 'software');
  assert.match(ac3.notes.join(' '), /Dolby Digital in this file plays only through Astra's software decoder/);
  // Sound nothing here decodes: refused, or silent when the viewer said so.
  for (const [id, label] of [['A_TRUEHD', 'Dolby TrueHD'], ['A_MS/ACM', 'Windows audio (WMA)']]) {
    const film = file('Matroska', video('avc', 'avc1.64001e'), [audio(null, null, { internalCodec: id, label })]);
    assert.equal(plan(film).mode, 'unsupported', id);
    assert.equal(plan(film).silent, true);
    assert.match(plan(film).reason, new RegExp(label.replace(/[()]/g, '\\$&')));
    assert.equal(plan(film, caps(), { allowSilent: true }).mode, 'remux');
  }
  // MPEG Layer II (a DVD's or a broadcast's sound, kept in a Matroska file): the software decoder's MP3 build decodes it.
  const mp2 = plan(file('Matroska', video('avc', 'avc1.64001e'), [audio(null, null, { internalCodec: 'A_MPEG/L2', label: 'MPEG Layer II' })]));
  assert.equal(mp2.mode, 'software');
  assert.match(mp2.notes.join(' '), /MPEG Layer II in this file plays only through Astra's software decoder/);
});

test('a file Astra cannot unpack: the software decoder where it reads the container, a reason where nothing does', () => {
  const unread = (container) => ({ readable: true, info: null, container, error: { kind: 'format', message: 'This is not a video file Astra recognises.' } });
  assert.equal(plan(unread('avi')).mode, 'software');
  assert.equal(plan(unread('mpg')).mode, 'software');
  const wmv = plan(unread('asf'));
  assert.equal(wmv.mode, 'unsupported');
  assert.match(wmv.reason, /Windows Media/);
  assert.equal(wmv.external, true);
  assert.match(plan(unread('rm')).reason, /RealMedia/);
  assert.equal(plan(unread('avi'), caps({ software: false })).mode, 'unsupported');
  // A transport stream whose picture the unpacker did not list (MPEG-2).
  assert.equal(plan(file('MPEG Transport Stream', null, [audio('mp3', 'mp3')], { hiddenVideo: 'ts' })).mode, 'software');
  // Theora in an Ogg file: nothing here decodes it, so it is refused rather than played as sound over black.
  const ogv = plan(file('Ogg', null, [audio('vorbis', 'vorbis')], { hiddenVideo: 'ogg' }));
  assert.equal(ogv.mode, 'unsupported');
  assert.match(ogv.reason, /Theora/);
  assert.equal(plan(file('Ogg', null, [audio('vorbis', 'vorbis')])).mode, 'remux');
  // H.263 in a 3GP file has no decoder here either.
  assert.equal(plan(file('MP4', video(null, null, { internalCodec: 's263', label: 'H.263' }), [audio('aac', 'mp4a.40.2')])).mode, 'unsupported');
});

test('the software decoder names what it can decode', () => {
  assert.equal(softwareVideo({ codec: 'avc' }), true);
  assert.equal(softwareVideo({ codec: null, internalCodec: 'V_MPEG2' }), true);
  assert.equal(softwareVideo({ codec: null, internalCodec: 'V_REAL/RV40' }), false);
  assert.equal(softwareVideo({ codec: 'prores' }), false);
  assert.equal(softwareAudio({ codec: 'dts' }), true);
  assert.equal(softwareAudio({ codec: 'pcm-s24' }), true);
  assert.equal(softwareAudio({ codec: null, internalCodec: 'A_MPEG/L2' }), true);
  assert.equal(softwareAudio({ codec: null, internalCodec: 'A_TRUEHD' }), false);
});

test('containers are told apart by their first bytes', () => {
  const bytes = (...parts) => { const b = new Uint8Array(400); let at = 0; for (const p of parts) { if (typeof p === 'number') at = p; else for (const c of p) b[at++] = typeof c === 'string' ? c.charCodeAt(0) : c; } return b; };
  assert.equal(sniffContainer(bytes('RIFF', 8, 'AVI ')), 'avi');
  assert.equal(sniffContainer(bytes([0x30, 0x26, 0xb2, 0x75])), 'asf');
  assert.equal(sniffContainer(bytes('.RMF')), 'rm');
  assert.equal(sniffContainer(bytes([0, 0, 1, 0xba])), 'mpg');
  assert.equal(sniffContainer(bytes('nothing known')), '');
});

test("an AVI's codec tags are put in the case the software decoder knows", () => {
  const b = new Uint8Array(300), put = (at, text) => { for (let i = 0; i < text.length; i++) b[at + i] = text.charCodeAt(i); };
  const read = (at) => String.fromCharCode(...b.subarray(at, at + 4));
  put(0, 'RIFF'); put(8, 'AVI ');
  put(20, 'strh'); put(28, 'vids'); put(32, 'xvid'); // a video stream: its handler...
  put(90, 'strf'); put(114, 'xvid');                // ...and its format's compression
  put(150, 'strh'); put(158, 'auds'); put(162, 'abcd');
  fixAviTags(b);
  assert.equal(read(32), 'XVID');
  assert.equal(read(114), 'XVID');
  assert.equal(read(162), 'abcd', 'an audio stream is left alone');
  // A tag the decoder knows in lower case stays as it is.
  put(32, 'mp4v'); put(114, 'mp4v');
  fixAviTags(b);
  assert.equal(read(32), 'mp4v');
});

test('a Matroska track of MPEG Layer I or II is named Layer III as the file is read, and nothing else is touched', () => {
  const bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
  const text = (b) => String.fromCharCode(...b);
  assert.equal(text(fixMkvLayers(bytes('..\x86A_MPEG/L2..A_MPEG/L1..A_MPEG/L3..A_AC3..A_MPEG/L'))), '..\x86A_MPEG/L3..A_MPEG/L3..A_MPEG/L3..A_AC3..A_MPEG/L');
  assert.equal(text(fixMkvLayers(bytes('A_MPEG/L4 V_MPEG2 A_MPEG2/L2'))), 'A_MPEG/L4 V_MPEG2 A_MPEG2/L2');
  assert.equal(fixMkvLayers(new Uint8Array(0)).length, 0);
});

