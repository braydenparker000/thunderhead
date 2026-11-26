// The names of songs saved to the phone's Downloads (owner, 2026-11-26; widgets/downloads.js): a song is
// "Artist - Title.opus" (the catalogue's own extension for the few that are not Opus), a playlist's or an
// album's songs are numbered "01 - Artist - Title.opus" in their order (as wide as the count needs, two
// digits at least), and the zip is named after the playlist, the album ("Album Artist - Album") or the list.
// Every name loses the characters Android and Windows refuse (\ / : * ? " < > | and control characters),
// its spaces collapsed and its ends trimmed, and is cut to NAME_MAX characters before its extension; names
// alike (ignoring case, as the phone's storage does) become unique with " (2)", " (3)"…

export const NAME_MAX = 120;
/** What a name that is left with nothing is called. */
const FALLBACK = 'Untitled';

/** A name's text as a file may carry it: refused characters out, spaces collapsed, trimmed, at most NAME_MAX characters. */
export function cleanName(text, fallback = FALLBACK) {
  const s = String(text ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  const cut = chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join('').trim() : s;
  return cut || fallback;
}

/** The song's extension: its stored file's ("opus" for the rest). */
export function extensionOf(t) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(t?.fileName || t?.path || ''));
  return m ? m[1].toLowerCase() : 'opus';
}

/** "Artist - Title" (the title alone without an artist). */
export function songTitle(t) {
  const title = String(t?.title ?? '').trim(), artist = String(t?.artist ?? '').trim();
  return artist && title ? `${artist} - ${title}` : title || artist;
}

/** A song's file name: "Artist - Title.opus". */
export const songFile = t => `${cleanName(songTitle(t))}.${extensionOf(t)}`;

/** Names made unique, in their order: the second "A.opus" is "A (2).opus" (case does not tell names apart). */
export function unique(names) {
  const used = new Set(), out = [];
  for (const name of names) {
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    let n = 1, got = name;
    while (used.has(got.toLowerCase())) got = `${stem} (${++n})${ext}`;
    used.add(got.toLowerCase());
    out.push(got);
  }
  return out;
}

/** The songs' names in a zip, unique: numbered ("01 - …") for a playlist or an album, else as they are. */
export function entryNames(tracks, {numbered = false} = {}) {
  const width = Math.max(2, String(tracks.length).length);
  return unique(tracks.map((t, i) => {
    const name = cleanName(songTitle(t));
    if (!numbered) return `${name}.${extensionOf(t)}`;
    // The number is kept whole: the name after it is cut to fit NAME_MAX.
    const n = `${String(i + 1).padStart(width, '0')} - `;
    return `${n}${cleanName(Array.from(name).slice(0, NAME_MAX - n.length).join(''))}.${extensionOf(t)}`;
  }));
}

/** An album's zip name: "Album Artist - Album". */
export const albumName = (artist, album) => cleanName(artist && album ? `${artist} - ${album}` : album || artist);
