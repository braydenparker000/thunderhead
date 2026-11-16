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

test('a plain MP4 or WebM Astra can read is unpacked like every other film; Chrome plays it only when Astra cannot unpack it', () => {
  // One picture, one sound, nothing to choose: still unpacked (the data saver, the data count, the sound features),
  // marked as one the browser could play itself should unpacking fail before the first picture.
  const mp4 = plan(file('MP4', video('avc', 'avc1.64001e'), [audio('aac', 'mp4a.40.2')]));
  assert.deepEqual([mp4.mode, mp4.whole, mp4.audio.delivery, mp4.notes], ['remux', true, 'direct', []]);
  const vp9 = plan(file('WebM', video('vp9', 'vp09.00.10.08'), [audio('opus', 'opus')]));
  assert.deepEqual([vp9.mode, vp9.whole, vp9.audio.delivery], ['remux', true, 'direct']);
  assert.equal(plan(file('MP4', video('avc', 'avc1.64001e'), [audio('mp3', 'mp3')])).mode, 'remux', 'MP3 in an MP4: its sound converted, so the sound features reach it');
  // VP8 has no place in the MP4 that Media Source takes: Chrome plays the WebM itself, and the stream info says why.
  const webm = plan(file('WebM', video('vp8', 'vp8'), [audio('vorbis', 'vorbis')]));
  assert.equal(webm.mode, 'native');
  assert.match(webm.notes.join(' '), /no way to unpack this file itself\. Chrome will play it as-is/);
  // Sound Astra cannot convert here (no Opus encoder) in a file the browser plays whole: Chrome plays it, with its sound.
  const mp3 = plan(file('MP4', video('avc', 'avc1.64001e'), [audio('mp3', 'mp3')]), caps({ opusEncode: false }));
  assert.deepEqual([mp3.mode, mp3.audio?.track.codec], ['native', 'mp3']);
  // A picture-only plain MP4 is unpacked too.
  assert.equal(plan(file('MP4', video('avc', 'avc1.64001e'))).mode, 'remux');
  // A host that forbids reading, and a file written like a live recording, still go to Chrome.
  assert.equal(plan({ readable: false, error: { kind: 'unreadable', message: 'No.' } }).mode, 'native');
  assert.equal(plan(file('WebM', video('vp9', 'vp09.00.10.08'), [audio('opus', 'opus')], { layout: { unknownClusterSizes: true } })).mode, 'native');
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

test('Dolby TrueHD is decoded and converted on the device, like Dolby Digital', () => {
  const thd = plan(file('Matroska', video('avc', 'avc1.640028'), [audio('truehd', 'mlpa', { label: 'Dolby TrueHD', channels: 8 })]));
  assert.equal(thd.mode, 'remux');
  assert.equal(thd.audio.delivery, 'rebuilt');
  assert.match(thd.notes.join(' '), /Dolby TrueHD audio is converted/);
  // Beside a track the browser takes as it is, that one is chosen first; TrueHD stays on the menu.
  const both = plan(file('Matroska', video('avc', 'avc1.640028'), [audio('truehd', 'mlpa', { label: 'Dolby TrueHD' }), audio('aac', 'mp4a.40.2', { id: 3 })]));
  assert.equal(both.audio.track.id, 3);
  assert.deepEqual(both.audioOptions.map((o) => o.delivery), ['rebuilt', 'direct']);
  // G.711 (µ-law, A-law), which Mediabunny decodes like any PCM.
  for (const codec of ['ulaw', 'alaw', 'pcm-s16be', 'pcm-f64']) assert.equal(plan(file('QuickTime File Format', video('avc', 'avc1.640028'), [audio(codec, codec)])).audio.delivery, 'rebuilt', codec);
  // No Opus encoder here, and the software decoder has no TrueHD build: refused with the reason.
  assert.equal(plan(file('Matroska', video('avc', 'avc1.640028'), [audio('truehd', 'mlpa', { label: 'Dolby TrueHD' })]), caps({ opusEncode: false })).mode, 'unsupported');
});

test('sound only the software decoder has takes the whole file there', () => {
  // A browser that cannot convert audio (no Opus encoder): Dolby Digital still plays, through the software decoder.
  const ac3 = plan(file('Matroska', video('avc', 'avc1.64001e'), [audio('ac3', 'ac-3', { label: 'Dolby Digital' })]), caps({ opusEncode: false }));
  assert.equal(ac3.mode, 'software');
  assert.match(ac3.notes.join(' '), /Dolby Digital in this file plays only through Astra's software decoder/);
  // Sound nothing here decodes: refused, or silent when the viewer said so.
  for (const [id, label] of [['A_ALAC', 'ALAC']]) {
    const film = file('Matroska', video('avc', 'avc1.64001e'), [audio(null, null, { internalCodec: id, label })]);
    assert.equal(plan(film).mode, 'unsupported', id);
    assert.equal(plan(film).silent, true);
    assert.match(plan(film).reason, new RegExp(label.replace(/[()]/g, '\\$&')));
    assert.equal(plan(film, caps(), { allowSilent: true }).mode, 'remux');
  }
  // Windows Media Audio in a Matroska file: libmedia's Matroska reader, patched, hands it to its WMA build.
  const wma = plan(file('Matroska', video('avc', 'avc1.64001e'), [audio(null, null, { internalCodec: 'A_MS/ACM', label: 'Windows audio (WMA)' })]));
  assert.deepEqual([wma.mode, wma.audio?.delivery], ['software', 'software']);
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
  // H.263 in a 3GP file: libmedia's MP4 reader, patched, knows its name and hands it to its H.263 build.
  assert.equal(plan(file('MP4', video(null, null, { internalCodec: 's263', label: 'H.263' }), [audio('aac', 'mp4a.40.2')])).mode, 'software');
  assert.equal(plan(file('MP4', video(null, null, { internalCodec: 's263', label: 'H.263' }), [audio('aac', 'mp4a.40.2')]), caps({ software: false })).mode, 'unsupported');
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


test('a file with no picture and no sound that can play is not handed to a pipeline', () => {
  const subtitlesOnly = plan(file('Matroska', null, [], { subtitles: [{ id: 'mkv:3', format: 'srt', language: 'en' }] }));
  assert.equal(subtitlesOnly.mode, 'unsupported');
  assert.match(subtitlesOnly.reason, /no picture or sound/);
  const deaf = plan(file('Matroska', null, [audio(null, null, { internalCodec: 'A_ALAC', label: 'ALAC' })]), caps(), { allowSilent: true });
  assert.equal(deaf.mode, 'unsupported');
  // Sound alone still plays.
  assert.equal(plan(file('Matroska', null, [audio('aac', 'mp4a.40.2'), audio('aac', 'mp4a.40.2', { id: 3 })])).mode, 'remux');
});

test('Dolby Digital (Plus) and DTS go through as they are where the browser says it decodes them, until that failed here', () => {
  const surround = (more = {}) => file('Matroska', video('avc', 'avc1.640028'), [audio('ac3', 'ac-3', { label: 'Dolby Digital', channels: 6 }), audio('eac3', 'ec-3', { id: 3, label: 'Dolby Digital Plus', channels: 6 }), audio('dts', 'dtsc', { id: 4, label: 'DTS', channels: 6 })], more);
  const dolbyPhone = caps({ mse: (mime) => /avc1|mp4a|opus|ac-3|ec-3/.test(mime) });
  const p = plan(surround(), dolbyPhone);
  assert.equal(p.mode, 'remux');
  assert.deepEqual(p.audioOptions.map((o) => o.delivery), ['direct', 'direct', 'rebuilt']);
  assert.equal(p.audio.delivery, 'direct');
  assert.doesNotMatch(p.notes.join(' '), /converted/, 'nothing is said about converting');
  // DTS too, the day a browser says yes to it.
  assert.equal(plan(surround(), caps({ mse: (mime) => /avc1|dtsc/.test(mime) })).audioOptions[2].delivery, 'direct');
  // A browser that says no: rebuilt as before.
  assert.deepEqual(plan(surround()).audioOptions.map((o) => o.delivery), ['rebuilt', 'rebuilt', 'rebuilt']);
  // Passed through once and failed on this device: rebuilt from then on, the other codec still passed through.
  const failed = plan(surround(), { ...dolbyPhone, passFailed: (codec) => codec === 'ac3' });
  assert.deepEqual(failed.audioOptions.map((o) => o.delivery), ['rebuilt', 'direct', 'rebuilt']);
  assert.equal(failed.audio.track.codec, 'eac3', 'the track that plays as it is is preferred');
  const onlyAc3 = plan(file('Matroska', video('avc', 'avc1.640028'), [audio('ac3', 'ac-3', { label: 'Dolby Digital' })]), { ...dolbyPhone, passFailed: () => true });
  assert.match(onlyAc3.notes.join(' '), /Dolby Digital audio is converted/);
  // A track whose codec string was not read is never passed through on a guess.
  assert.equal(plan(file('Matroska', video('avc', 'avc1.640028'), [audio('ac3', null)]), dolbyPhone).audio.delivery, 'rebuilt');
});

test('a picture that failed in the browser and played in software on this device starts in software', () => {
  const hevc = () => file('Matroska', video('hevc', 'hvc1.1.6.L120.90', { label: 'HEVC' }), [audio('aac', 'mp4a.40.2')]);
  const hevcPhone = caps({ mse: (mime) => /avc1|hvc1|mp4a/.test(mime) });
  assert.equal(plan(hevc(), hevcPhone).mode, 'remux');
  const remembered = plan(hevc(), { ...hevcPhone, failedRoute: (c) => c === 'hvc1.1.6.L120.90' });
  assert.equal(remembered.mode, 'software');
  assert.match(remembered.notes.join(' '), /HEVC video failed in this phone's own decoder before/);
  // Another codec string is not affected, and with no software decoder the memory changes nothing.
  assert.equal(plan(hevc(), { ...hevcPhone, failedRoute: (c) => c === 'hvc1.2.4.L120.90' }).mode, 'remux');
  assert.equal(plan(hevc(), { ...hevcPhone, software: false, failedRoute: () => true }).mode, 'remux');
  // A plain MP4 the browser would play whole goes to software too: the same decoder failed.
  assert.equal(plan(file('MP4', video('avc', 'avc1.64001e'), [audio('aac', 'mp4a.40.2')]), caps({ failedRoute: () => true })).mode, 'software');
});
