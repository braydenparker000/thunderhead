// Astra's format for AIOStreams' custom formatter: one name line and one description that carry every
// fact a stream card shows in a fixed order Astra reads exactly, so nothing has to be guessed from free text.
//
// The variables are AIOStreams' own, read from its public source (packages/core/src/formatters/base.ts and
// engine/fields.ts, November 2026): `{stream.resolution}`, `{stream.quality}`, `{stream.visualTags}`,
// `{stream.encode}`, `{stream.audioTags}`, `{stream.audioChannels}`, `{stream.languages}`, `{stream.size}`
// (bytes), `{stream.releaseGroup}`, `{stream.indexer}`, `{addon.name}` (the add-on inside AIOStreams),
// `{service.shortName}` ("TB", "RD"…), `{service.cached}`, `{stream.seeders}`, `{stream.type}`,
// `{stream.filename}`, `{stream.infoHash}`, and `{config.addonName}`. Its template rules, from the same source:
// `{?…?}` renders only when every value inside it is present; `{x["a"||"b"]}` picks by a true or false value
// and renders nothing when there is none; `::join(',')` joins a list; empty lines are dropped.
//
// What it renders, line by line (the first is the one Astra recognises; the others are found by their shape):
//   Astra/1|res=2160p|src=BluRay REMUX|vis=DV,HDR10|enc=HEVC|aud=TrueHD,Atmos|ch=7.1|lang=English,Italian|size=…
//   The.Film.2019.2160p.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos-GROUP.mkv      (the file's name, when known)
//   0123456789abcdef0123456789abcdef01234567                                (the info hash: read, never shown)

/** The name line: the add-on's name, the resolution, and a bolt when the debrid service has the file. */
export const AIO_NAME = '{config.addonName}{? {stream.resolution}?}{service.cached[" ⚡"||" ⏳"]}';

/** The description: the facts line, the file's name, the info hash. */
export const AIO_DESCRIPTION = [
  'Astra/1{?|res={stream.resolution}?}{?|src={stream.quality}?}{?|vis={stream.visualTags::join(\',\')}?}'
    + '{?|enc={stream.encode}?}{?|aud={stream.audioTags::join(\',\')}?}{?|ch={stream.audioChannels::join(\',\')}?}'
    + '{?|lang={stream.languages::join(\',\')}?}{?|size={stream.size}?}{?|grp={stream.releaseGroup}?}{?|idx={stream.indexer}?}'
    + '{?|via={addon.name}?}{?|svc={service.shortName}?}{service.cached["|ready=1"||"|ready=0"]}{?|seed={stream.seeders}?}{?|type={stream.type}?}',
  '{?{stream.filename}?}',
  '{?{stream.infoHash}?}',
].join('\n');

/** What the "Copy Astra's format for AIOStreams" row copies: both parts, each under its own heading. */
export const AIO_FORMAT_TEXT = `NAME\n${AIO_NAME}\n\nDESCRIPTION\n${AIO_DESCRIPTION}\n`;

const LINE = /^Astra\/1((?:\|[a-z]+=[^|\n]*)*)\s*$/m;
const HEX = /^[0-9a-f]{40}$/i;
const list = v => (v ? v.split(',').map(x => x.trim()).filter(x => x && x !== 'Unknown') : []);
const one = v => (v && v !== 'Unknown' ? v.trim() : null);

// AIOStreams' words (utils/constants.ts) as Astra shows them.
const RES = {'2160p': '4K', '1440p': '1440p', '1080p': '1080p', '720p': '720p', '576p': '576p', '480p': '480p', '360p': '360p', '240p': '240p', '144p': '144p'};
const SOURCE = {'BluRay REMUX': 'Remux', 'DVD REMUX': 'Remux', BluRay: 'BluRay', 'WEB-DL': 'WEB-DL', WEBRip: 'WEBRip', HDRip: 'HDRip', 'HC HD-Rip': 'HDRip',
  DVDRip: 'DVDRip', HDTV: 'HDTV', CAM: 'CAM', TS: 'CAM', TC: 'CAM', SCR: 'Screener'};
const PICTURE = {'HDR+DV': ['DV', 'HDR'], 'DV Only': ['DV'], 'HDR Only': ['HDR'], DV: ['DV'], 'HDR10+': ['HDR10+'], HDR10: ['HDR10'], HDR: ['HDR'], HLG: ['HLG'],
  '10bit': ['10-bit'], '3D': ['3D'], IMAX: ['IMAX']};
const PICTURE_ORDER = ['DV', 'HDR10+', 'HDR10', 'HDR', 'HLG', '10-bit', '3D', 'IMAX'];
const CODEC = {AV1: 'AV1', HEVC: 'HEVC', AVC: 'AVC', 'VC-1': 'VC-1', XviD: 'XviD', DivX: 'DivX', 'MPEG-4': 'MPEG-4'};
const SOUND = ['TrueHD', 'DTS:X', 'DTS-HD MA', 'DTS-HD', 'DTS-ES', 'DTS', 'DD+', 'DD', 'PCM', 'FLAC', 'OPUS', 'AAC'];
const SOUND_NAME = {OPUS: 'Opus'};
const RANK = ch => Number(String(ch).replace('.', '')) || 0;

/**
 * The facts of a stream written in Astra's format, exactly as AIOStreams gave them, or null when its
 * description is not in that format. The same shape releaseFacts (release-facts.js) gives, with `exact: true`.
 * @param {{title?: string, filename?: string}} stream
 */
export function readAstraFormat(stream) {
  const text = String(stream?.title ?? '');
  const m = LINE.exec(text);
  if (!m) return null;
  const v = {};
  for (const part of m[1].split('|').slice(1)) { const i = part.indexOf('='); v[part.slice(0, i)] = part.slice(i + 1); }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !LINE.test(l));
  const hash = lines.find(l => HEX.test(l)) || null;
  const file = stream.filename || lines.find(l => !HEX.test(l)) || '';
  const res = one(v.res);
  const picture = [...new Set(list(v.vis).flatMap(t => PICTURE[t] || []))].sort((a, b) => PICTURE_ORDER.indexOf(a) - PICTURE_ORDER.indexOf(b));
  const tags = list(v.aud);
  const codec = tags.map(t => SOUND.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  const channels = list(v.ch).sort((a, b) => RANK(b) - RANK(a))[0] || null;
  const size = Number(v.size);
  const seeders = v.seed != null && /^\d+$/.test(v.seed) ? Number(v.seed) : null;
  return {
    exact: true,
    res: res && RES[res] ? res : null, resLabel: res ? RES[res] || null : null, quality: null, runtime: null, bitrate: null, title: '',
    source: SOURCE[one(v.src)] || null,
    picture,
    codec: CODEC[one(v.enc)] || null,
    sound: {codec: codec == null ? null : SOUND_NAME[SOUND[codec]] || SOUND[codec], channels, atmos: tags.includes('Atmos')},
    languages: list(v.lang),
    bytes: Number.isFinite(size) && size > 0 ? size : null,
    group: one(v.grp), indexer: one(v.idx), via: one(v.via), service: one(v.svc),
    ready: v.ready === '1' ? true : v.ready === '0' ? false : null,
    seeders, kind: one(v.type),
    release: file, hash,
  };
}
