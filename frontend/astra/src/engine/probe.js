// Reads a file's header and describes what is inside, before anything plays.

import * as MB from '../../vendor/mediabunny.js';
import {HttpSource, SourceError} from './http-source.js';
import {readLayout, subtitleTracks} from './mkv.js';
import {readMoov, readMp4Subtitles, mp4DolbyVision} from './mp4.js';
import {mp4Chapters} from './chapters.js';
import {languageName} from './languages.js';
import {videoCodecName, audioCodecName} from './labels.js';
import {adaptiveKind} from './plan.js';
import {sniffContainer} from './software.js';
import {mseSupports} from './capabilities.js';

// DTS's codec string comes from its first frame, which Mediabunny finds by reading the film's first cluster whole: on a
// 25 Mbit/s film, 5 MB before anything could be planned (scripts/astra/real.mjs, 2026-11-18). It only decides whether
// the browser takes the sound as it is; where it takes no DTS at all, it is left unread (the converter reads its own),
// and the film's MIME type is put together from the codec strings read (mimeOf) rather than asked of Mediabunny.
const DTS = ['dtsc', 'dtse', 'dtsh', 'dtsl', 'dtsx'];
const unread = t => t.codec === 'dts' && !DTS.some(c => mseSupports(`audio/mp4; codecs="${c}"`));

/**
 * Opens and describes a file. Resolves {readable: true, source, input, info}
 * or {readable: false, error} when a page cannot read it (the planner then
 * hands the address to the browser as-is).
 */
export async function probe(url, {headers = {}, signal, onStatus = () => {}, onSource = () => {}, fetchFn, renew = null} = {}) {
  const source = new HttpSource(url, {headers, renew, ...(fetchFn ? {fetchFn} : {})});
  onSource(source); // so the loading screen can say how much has arrived
  source.probing = true; // read only what describing the file needs; playback may start elsewhere
  // A playlist is known by its address before anything is read, and by its type once the host answers, even
  // when the host does not honour byte ranges (a playlist needs none) or does not say how large it is.
  const named = adaptiveKind(url);
  onStatus('Opening the file…');
  let opened;
  try {
    opened = await source.open(signal); // closes the source if the load is ended, now or later
  } catch (error) {
    source.close();
    if (signal?.aborted) throw error;
    const kind = ['range', 'size'].includes(error?.kind) && (named || adaptiveKind(url, error.contentType || ''));
    if (kind) return {readable: true, adaptive: kind, info: {container: kind.toUpperCase(), size: null}};
    return {readable: false, error: error instanceof SourceError ? error : new SourceError('unreadable', String(error?.message || error))};
  }
  const kind = adaptiveKind(url, opened.contentType);
  if (kind) { source.close(); return {readable: true, adaptive: kind, info: {container: kind.toUpperCase(), size: opened.size}}; }
  let input = null;
  const drop = () => { input?.dispose(); input = null; };
  signal?.addEventListener('abort', drop, {once: true});
  try {
    return await describe(url, source, opened, signal, onStatus, i => { input = i; });
  } catch (error) {
    // Whatever went wrong while describing (or the load was ended): nothing is left reading.
    drop(); source.close();
    throw error;
  } finally { signal?.removeEventListener('abort', drop); }
}

async function describe(url, source, opened, signal, onStatus, keep) {
  onStatus('Reading what is inside…');
  const input = new MB.Input({
    source: new MB.CustomSource({getSize: () => source.size, read: (start, end) => source.read(start, end), maxCacheSize: 8 << 20}),
    formats: MB.ALL_FORMATS,
  });
  keep(input);
  let format;
  try { format = await input.getFormat(); } catch (error) {
    if (signal?.aborted) throw error;
    input.dispose();
    // The source stays open: the software decoder reads formats Mediabunny does not (the caller closes it otherwise).
    source.doneProbing();
    const container = sniffContainer(await source.read(0, Math.min(source.size, 400)).catch(() => new Uint8Array(0)));
    return {readable: true, source, info: null, container, error: new SourceError('format', 'This is not a video file Astra recognises.', String(error?.message || error))};
  }
  const container = String(format.name || '').toLowerCase();
  const tracks = await input.getTracks();
  const describeTrack = async t => {
    const disposition = t.disposition || {};
    const base = {
      ref: t, id: t.id, number: t.number, codec: t.codec, internalCodec: t.internalCodecId,
      codecString: unread(t) ? null : await t.getCodecParameterString().catch(() => null),
      language: t.languageCode === 'und' ? '' : t.languageCode, name: t.name || '',
      default: !!disposition.default, forced: !!disposition.forced, commentary: !!disposition.commentary,
      hearingImpaired: !!disposition.hearingImpaired,
    };
    if (t.isVideoTrack()) {
      // An MP4's frame times are in its index, already read: Mediabunny works the rate out from the first frames' times.
      const fps = /mp4|quicktime|mov/.test(container) ? frameRate(await t.computeFrameRateMetrics({targetPacketCount: 48}).then(m => m.underlyingFrameRate ?? m.bestGuessFrameRate, () => null)) : undefined;
      if (fps) base.frameRate = fps;
      return {...base, type: 'video', width: t.displayWidth, height: t.displayHeight, hdr: await t.hasHighDynamicRange().catch(() => false), decoderConfig: await t.getDecoderConfig().catch(() => null)};
    }
    return {...base, type: 'audio', channels: t.numberOfChannels, sampleRate: t.sampleRate, decoderConfig: unread(t) ? null : await t.getDecoderConfig().catch(() => null)};
  };
  const described = await Promise.all(tracks.map(describeTrack));
  const video = described.filter(t => t.type === 'video');
  const audio = described.filter(t => t.type === 'audio');
  for (const t of video) t.label = videoCodecName(t);
  for (const t of audio) t.label = audioCodecName(t);
  let duration = await input.getDurationFromMetadata().catch(() => null);
  if (!duration) duration = await input.computeDuration().catch(() => null);

  let layout = null, subtitles = [], chapters = [];
  if (container.includes('matroska') || container.includes('webm')) {
    try {
      layout = await readLayout((s, e) => source.read(s, e), source.size);
      subtitles = subtitleTracks(layout);
      chapters = layout.chapters;
      const dv = layout.tracks.find(t => t.type === 1 && t.dolbyVision)?.dolbyVision;
      if (dv && video[0]) video[0].dolbyVision = dv;
      // The frame rate as the header gives it (each frame's duration); read from the frames themselves it would cost clusters.
      const each = layout.tracks.find(t => t.type === 1)?.defaultDuration;
      if (each > 0 && video[0] && !video[0].frameRate) video[0].frameRate = frameRate(1e9 / each);
    } catch {}
  } else if (/mp4|quicktime|mov/.test(container)) {
    try {
      const moov = await readMoov((s, e) => source.read(s, e), source.size);
      subtitles = await readMp4Subtitles(null, 0, moov);
      chapters = moov ? mp4Chapters(moov) : [];
      const dv = mp4DolbyVision(moov); // Mediabunny does not read the sample entry's dvcC/dvvC box
      if (dv && video[0]) video[0].dolbyVision = dv;
    } catch {}
  }
  for (const s of subtitles) s.languageName = languageName(s.language);
  // Mediabunny lists no picture it cannot name in a transport stream (MPEG-2) or an Ogg file (Theora).
  const hiddenVideo = video.length ? '' : container.includes('transport') ? 'ts' : container.includes('ogg') && (/\.ogv$/i.test(pathOf(url)) || /^video\//i.test(opened.contentType || '')) ? 'ogg' : '';
  source.learn(duration); // the reader's reach and cache follow the film's bitrate from here
  source.doneProbing();
  return {
    readable: true, source, input,
    info: {container: format.name || container, mime: mimeOf(format, described), size: source.size, duration, video, audio, subtitles, layout, hiddenVideo, chapters},
  };
}

/**
 * The film's MIME type with its codecs, for the report, from what describing read. Mediabunny's getMimeType() asks every
 * track for its decoder setup, which for DTS means its first frame: the first cluster read whole, 5 MB of a 25 Mbit/s
 * film, after describing was over and with a playback download's reach (scripts/astra/real.mjs, 2026-11-18).
 */
const mimeOf = (format, tracks) => {
  const codecs = tracks.map(t => t.codecString).filter(Boolean);
  return (format.mimeType || '') + (codecs.length ? `; codecs="${codecs.join(', ')}"` : '');
};

/** A frame rate fit to show and to step by (23.976, 25, 59.94), or undefined when there is none worth the name. */
export const frameRate = fps => Number.isFinite(fps) && fps >= 1 && fps <= 1000 ? Math.round(fps * 1000) / 1000 : undefined;

const pathOf = url => { try { return new URL(url).pathname; } catch { return String(url); } };

/** A plain-object copy of the info for reports (no track handles or bytes). */
export function describeInfo(info) {
  if (!info) return null;
  const clean = t => Object.fromEntries(Object.entries(t).filter(([k]) => !['ref', 'decoderConfig', 'header', 'samples'].includes(k)));
  return {container: info.container, mime: info.mime, size: info.size, duration: info.duration,
    video: (info.video || []).map(clean), audio: (info.audio || []).map(clean), subtitles: (info.subtitles || []).map(clean)};
}
