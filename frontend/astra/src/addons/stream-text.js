// A stream's words as the owner sees them: the torrent's hash taken out. The owner's add-on writes the
// info hash into its text so Astra can reach TorBox directly (addons/link-facts.js reads it from the
// stream object, never from what is shown), and a raw 40-character line on every card says nothing to a
// person. So wherever a stream's name or description is shown, a 40-hex run (the same runs link-facts.js
// reads: never part of a longer hex string) is taken out: a line that is only the hash, with or without an
// emoji or a label before it, is dropped; a hash inside a longer line is cut out with what binds it to the
// line (a "btih:" or "Hash:" before it, brackets around it, one of two separators either side). Nothing
// else of the add-on's text changes.

const HEX = '(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])';
// What belongs to the hash when it stands before it: a magnet's "urn:btih:", "btih:", or a hash label.
const LEAD = String.raw`(?:(?:magnet:\?xt=)?urn:btih:|btih:|(?:info[ _-]?)?hash\s*[:=#]?\s*|ih\s*[:=]\s*)?`;
const HASH = new RegExp(HEX, 'i');
const RUN = new RegExp(String.raw`\[\s*${LEAD}${HEX}\s*\]|\(\s*${LEAD}${HEX}\s*\)|${LEAD}${HEX}`, 'i');
// What may be left on a line that held only the hash: emoji, symbols and punctuation, and at most a short
// label that ends in a colon ("🔑 Torrent: ").
const LABEL_ONLY = /^[\s\p{P}\p{S}\p{M}\p{Extended_Pictographic}\u200d]*(?:[\p{L}\p{N}][\p{L}\p{N} ._-]{0,24}[:=])?[\s\p{P}\p{S}\p{M}\u200d]*$/u;
const SEP = '[|·•,/–—-]';
const SEP_END = new RegExp(`\\s*${SEP}$`, 'u'), SEP_START = new RegExp(`^${SEP}\\s*`, 'u');

/** Text with every hash replaced by a space: what a stream's facts are read from (stream-facts.js), so a hash that
 * happens to begin "dd5…" or "ac3…" is never read as Dolby Digital. */
export const dropHashes = text => String(text ?? '').replace(new RegExp(HEX, 'gi'), ' ');

/** One line with a hash cut out, closing the gap it leaves. */
function cut(line) {
  let s = line, m;
  while ((m = RUN.exec(s))) {
    const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
    const b = before.trimEnd(), a = after.trimStart();
    if (!b) s = a.replace(SEP_START, ''); // at the start: a separator after it goes too
    else if (!a) s = b.replace(SEP_END, ''); // at the end: a separator before it goes too
    else if (SEP_END.test(b) && SEP_START.test(a)) s = `${b} ${a.replace(SEP_START, '')}`; // "a | hash | b": one separator stays
    else s = b + (before !== b || after !== a ? ' ' : '') + a;
  }
  return s;
}

/**
 * A stream's name or description without the hash, as described above; any other text is returned as it is.
 * @param {unknown} text @returns {string}
 */
export function withoutHash(text) {
  const t = String(text ?? '');
  if (!HASH.test(t)) return t;
  const lines = [];
  for (const line of t.split('\n')) {
    if (!HASH.test(line)) { lines.push(line); continue; }
    const rest = line.replace(new RegExp(RUN.source, 'gi'), ' ');
    if (LABEL_ONLY.test(rest)) continue; // a line that only gave the hash
    lines.push(cut(line));
  }
  return lines.join('\n');
}
