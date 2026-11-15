// Subtitle text → cues Astra draws itself.
//
// A cue is {start, end, align, pos, spans}: times in seconds, `align` the ASS
// numpad position (2 = bottom centre, 8 = top centre), `pos` an optional
// {x, y} fraction of the picture for positioned signs, and `spans` the text
// as [{text, i, b, u, color}] where text may contain '\n'.
// Nothing here produces HTML; the renderer builds text nodes.
// Times and inline markup are in markup.js, ASS and SSA in ass.js.

import {STAMP, parseTime, markupSpans, srtAlign} from './markup.js';
import {parseAss} from './ass.js';

export {parseTime, markupSpans} from './markup.js';
export {parseAssHeader, assColor, assText, assBlockCue, parseAss} from './ass.js';

const TIMING = new RegExp(String.raw`^\s*(${STAMP})\s*-->\s*(${STAMP})(.*)$`);
const number = line => /^\s*\d+\s*$/.test(line);

/**
 * Reads SRT or WebVTT line by line, so a file whose "blank" lines hold a
 * space, or that has no blank lines at all, still gives one cue per timing
 * line. A timing line starts a cue. Its text runs to the next timing line
 * (in WebVTT to a blank line, which also keeps NOTE and STYLE blocks out),
 * and a number standing just above a timing line is that cue's counter, not
 * the text of the cue before. Returns [{start, end, settings, body}]; no
 * body ever holds a timing line.
 */
function timedBlocks(text, blankEnds) {
  const out = [];
  let cue = null, above = '', counted = null;
  for (const line of String(text).replace(/^﻿/, '').split(/\r\n?|\n/)) {
    if (line.includes('-->') && /\d\s*-->|-->\s*\d/.test(line)) {
      const last = cue ? cue.lines[cue.lines.length - 1] ?? '' : above;
      counted ??= number(last); // the first cue says whether this file counts its cues
      // In a file that does not, "42" alone under a timing line is that cue's text.
      if (cue && number(last) && (counted || cue.lines.length > 1)) cue.lines.pop();
      const m = TIMING.exec(line);
      cue = m ? {start: parseTime(m[1]), end: parseTime(m[2]), settings: m[3], lines: []} : null; // a timing line that cannot be read ends the cue above and starts none
      if (cue) out.push(cue);
      above = '';
    } else if (!line.trim()) { if (blankEnds) cue = null; }
    else if (cue) cue.lines.push(line);
    else above = line;
  }
  return out.map(c => ({start: c.start, end: c.end, settings: c.settings, body: c.lines.join('\n').trim()})).filter(c => c.body);
}

/** Parses an SRT file. */
export function parseSrt(text) {
  return timedBlocks(text, false).map(c => ({start: c.start, end: c.end, align: srtAlign(c.body), pos: null, spans: markupSpans(c.body)})).filter(c => c.spans.length);
}

/** Text of one Matroska S_TEXT/UTF8 block. */
export function srtBlockCue(text, start, end) {
  const body = String(text).replace(/\r\n?/g, '\n').trim();
  return body ? {start, end, align: srtAlign(body), pos: null, spans: markupSpans(body)} : null;
}

const VTT_ALIGN = {start: 1, left: 1, center: 2, middle: 2, end: 3, right: 3};
/** Parses a WebVTT file (cue settings: line:0 or a low percentage moves the cue to the top). */
export function parseVtt(text) {
  const cues = [];
  for (const c of timedBlocks(text, true)) {
    let align = 2;
    for (const s of c.settings.trim().split(/\s+/)) {
      const [k, v] = s.split(':');
      if (k === 'align' && VTT_ALIGN[v]) align = (align > 6 ? 6 : 0) + VTT_ALIGN[v];
      if (k === 'line' && (/^0+(\.0+)?%?$/.test(v) || (/%$/.test(v) && parseFloat(v) < 30))) align = 6 + (align % 3 || 3);
    }
    const spans = markupSpans(c.body); // <v Speaker>, <c.class> and inline times are dropped there
    if (spans.length) cues.push({start: c.start, end: c.end, align, pos: null, spans});
  }
  return cues;
}

/** Picks a parser from a file name, MIME type or the text itself. */
export function parseSubtitleFile(text, hint = '') {
  // The file's own first line decides; the hint (a format name, a file name or
  // an address) counts only as a real extension. "Glass.Onion.srt" or
  // ".../classic/..." must not read as ASS.
  const h = String(hint).trim().toLowerCase();
  const ext = /^(ass|ssa|vtt|webvtt|srt)$/.test(h) ? h : /\.([a-z0-9]{2,4})(?:[?#].*)?$/.exec(h)?.[1] || '';
  const body = String(text).replace(/^﻿/, '');
  const order = /^\s*\[Script Info\]/i.test(body) ? [parseAss]
    : /^\s*WEBVTT/.test(body) ? [parseVtt]
    : ext === 'ass' || ext === 'ssa' ? [parseAss, parseSrt, parseVtt]
    : ext === 'vtt' || ext === 'webvtt' ? [parseVtt, parseSrt]
    : [parseSrt, parseVtt, parseAss];
  // A file the first reader finds nothing in is offered to the others.
  for (const parse of order) { const cues = parse(text); if (cues.length) return cues; }
  return [];
}
