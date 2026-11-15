// ASS and the older SSA: the header's styles, a dialogue line's override
// tags, one Matroska block, and a whole file.

import {parseTime, pushText, legacyAlign} from './markup.js';

/** Reads an ASS/SSA header ([Script Info] and [V4+ Styles] or SSA's [V4 Styles]). */
export function parseAssHeader(text) {
  const header = {playResX: 384, playResY: 288, styles: new Map(), eventFormat: null};
  let section = '', format = null;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { section = line.toLowerCase(); format = null; continue; }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (section === '[script info]') {
      if (key === 'playresx') header.playResX = +value || header.playResX;
      if (key === 'playresy') header.playResY = +value || header.playResY;
    } else if (section.includes('styles')) {
      if (key === 'format') format = value.split(',').map(s => s.trim().toLowerCase());
      else if (key === 'style' && format) {
        const f = value.split(','), get = name => f[format.indexOf(name)]?.trim();
        const legacy = section === '[v4 styles]';
        header.styles.set(get('name'), {
          bold: get('bold') === '-1' || get('bold') === '1', italic: get('italic') === '-1' || get('italic') === '1',
          underline: get('underline') === '-1' || get('underline') === '1', color: assColor(get('primarycolour')),
          align: legacy ? legacyAlign(+get('alignment')) : +get('alignment') || 2, size: +get('fontsize') || 0,
        });
      }
    } else if (section === '[events]' && key === 'format') header.eventFormat = value.split(',').map(s => s.trim().toLowerCase());
  }
  return header;
}

/** A line's style by name. Old SSA files write "*Default" for a style named "Default". */
function styleOf(header, name) {
  const key = String(name ?? '').trim();
  return header.styles.get(key) || header.styles.get(key.replace(/^\*/, '')) || header.styles.get('Default');
}

/**
 * '&H00BBGGRR&' → '#rrggbb' (alpha ignored); null when unreadable. A plain
 * number is the same value in decimal, as old .ssa styles write it
 * (16777215 is white).
 */
export function assColor(value) {
  const s = String(value ?? '').trim();
  const hex = /^(?:&H?|H|0x)([0-9a-f]+)&?$/i.exec(s) || (/^\d+$/.test(s) ? null : /^([0-9a-f]+)$/i.exec(s));
  if (!hex && !/^-?\d+$/.test(s)) return null;
  const n = (hex ? parseInt(hex[1].slice(-6), 16) : Number(s)) & 0xffffff;
  const pair = shift => (n >> shift & 0xff).toString(16).padStart(2, '0');
  return '#' + pair(0) + pair(8) + pair(16);
}

/** ASS dialogue text with override tags → {spans, align, pos}. */
export function assText(text, style, header) {
  const base = {i: !!style?.italic, b: !!style?.bold, u: !!style?.underline, color: style?.color && style.color !== '#ffffff' ? style.color : null};
  let current = {...base}, align = style?.align || 2, pos = null, drawing = false;
  const spans = [];
  const parts = String(text).split(/(\{[^}]*\})/);
  for (const part of parts) {
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const tag of part.slice(1, -1).split('\\').slice(1)) {
        let m;
        if ((m = /^i([01])$/.exec(tag))) current = {...current, i: m[1] === '1'};
        else if ((m = /^b(\d+)$/.exec(tag))) current = {...current, b: m[1] !== '0'};
        else if ((m = /^u([01])$/.exec(tag))) current = {...current, u: m[1] === '1'};
        else if ((m = /^1?c&?H([0-9a-f]+)&?$/i.exec(tag))) current = {...current, color: assColor('&H' + m[1])};
        else if ((m = /^an(\d)$/.exec(tag))) align = +m[1];
        else if ((m = /^a(\d+)$/.exec(tag))) align = legacyAlign(+m[1]);
        else if ((m = /^(?:pos|move)\(([-\d.]+),\s*([-\d.]+)/.exec(tag))) pos = {x: +m[1] / header.playResX, y: +m[2] / header.playResY};
        else if ((m = /^p(\d+)$/.exec(tag))) drawing = m[1] !== '0';
        else if (tag === 'r') current = {...base};
      }
      continue;
    }
    if (drawing) continue;
    pushText(spans, part.replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, ' '), current);
  }
  return {spans: spans.filter(s => s.text.trim() || s.text.includes('\n')), align, pos};
}

/** One Matroska S_TEXT/ASS block: "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text". */
export function assBlockCue(text, start, end, header) {
  const fields = String(text).split(',');
  if (fields.length < 9) return null;
  const {spans, align, pos} = assText(fields.slice(8).join(','), styleOf(header, fields[2]), header);
  return spans.length ? {start, end, align, pos, spans, layer: +fields[1] || 0} : null;
}

/** Parses a whole .ass/.ssa file. */
export function parseAss(text) {
  const header = parseAssHeader(text);
  const format = header.eventFormat || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  const cues = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!/^Dialogue:/i.test(raw)) continue;
    const fields = raw.slice(raw.indexOf(':') + 1).trim().split(',');
    const get = name => fields[format.indexOf(name)];
    const textIndex = format.indexOf('text');
    const start = parseTime(get('start')), end = parseTime(get('end'));
    if (start == null || end == null) continue;
    const {spans, align, pos} = assText(fields.slice(textIndex).join(','), styleOf(header, get('style')), header);
    if (spans.length) cues.push({start, end, align, pos, spans, layer: +get('layer') || 0});
  }
  return cues.sort((a, b) => a.start - b.start);
}
