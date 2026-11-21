// An invented music library for the shelves tests (Albums, Singles, Artists, album and artist pages,
// Possible duplicates; MUSIC.md §2.3). Every name is made up.
// - "Harbor Lights": album "Tidewater" (2019, 5 songs), a two-disc album "Lantern Season" (2022, 3 + 2),
//   a one-song release "Paper Moon" (2023), a song with no album and a song on a compilation;
// - "Juno Park": album "Small Rooms" (2017, 3), album "Untitled Tapes" (no year, 3), a two-song release;
// - "Mira Vale": five songs on one- and two-song releases or none (an artist without an album);
// - "Odd Copper": one song on the compilation only (in All artists, not in Artists);
// - "Coastal Roads Vol. 1" (2020, album artist "Various Artists", 4 songs from four artists);
// - two pairs that differ only in case, spacing or punctuation (possible duplicates), and a live version
//   and a "feat." version that do not count.

const T = (id, title, artist, album, o = {}) => ({
  id: 'inv' + id, title, artist, album, albumArtist: o.aa ?? '', track: o.n ?? 0, disc: o.d ?? 0, year: o.y ?? 0,
  durationMs: o.ms ?? 200_000, format: o.f ?? 'FLAC', bitrate: o.br ?? 900, sampleRate: 44100, bits: o.bits ?? 0,
  fileName: `${id}.flac`, added: 1_700_000_000_000 + Number(id) * 1000,
});

export function inventedLibrary() {
  return [
    // Harbor Lights: Tidewater (2019).
    T(1, 'First Light', 'Harbor Lights', 'Tidewater', { aa: 'Harbor Lights', n: 1, y: 2019, ms: 181_000 }),
    T(2, 'Night ferry!', 'Harbor Lights', 'Tidewater', { aa: 'Harbor Lights', n: 2, y: 2019, ms: 204_000 }),
    T(3, 'Rope and Anchor', 'Harbor Lights', 'Tidewater', { aa: 'Harbor Lights', n: 3, y: 2019, ms: 233_000 }),
    T(4, 'Shoals', 'Harbor Lights', 'Tidewater', { aa: 'Harbor Lights', n: 4, y: 2019, ms: 199_000 }),
    T(5, 'Low Water', 'Harbor Lights feat. Mira Vale', 'Tidewater', { aa: 'Harbor Lights', n: 5, y: 2019, ms: 262_000 }),
    // Lantern Season (2022), two discs, listed out of order.
    T(6, 'Second Wind', 'Harbor Lights', 'Lantern Season', { aa: 'Harbor Lights', n: 1, d: 2, y: 2022 }),
    T(7, 'Ember Road', 'Harbor Lights', 'Lantern Season', { aa: 'Harbor Lights', n: 2, d: 1, y: 2022 }),
    T(8, 'Kindling', 'Harbor Lights', 'Lantern Season', { aa: 'Harbor Lights', n: 1, d: 1, y: 2022 }),
    T(9, 'Last Lantern', 'Harbor Lights', 'Lantern Season', { aa: 'Harbor Lights', n: 2, d: 2, y: 2022 }),
    T(10, 'Wick', 'Harbor Lights', 'Lantern Season', { aa: 'Harbor Lights', n: 3, d: 1, y: 2022 }),
    // A one-song release and a song with no album.
    T(11, 'Paper Moon', 'Harbor Lights', 'Paper Moon', { aa: 'Harbor Lights', n: 1, y: 2023 }),
    T(12, 'Night Ferry', 'Harbor Lights', '', { y: 2016, f: 'MP3', br: 320, ms: 205_000 }),
    // Coastal Roads Vol. 1 (2020), a compilation.
    T(13, 'Coast Road', 'Harbor Lights', 'Coastal Roads Vol. 1', { aa: 'Various Artists', n: 1, y: 2020 }),
    T(14, 'Glass Coast', 'Mira Vale', 'Coastal Roads Vol. 1', { aa: 'Various Artists', n: 2, y: 2020, f: 'MP3', br: 256 }),
    T(15, 'Copper Wire', 'Odd Copper', 'Coastal Roads Vol. 1', { aa: 'Various Artists', n: 3, y: 2020 }),
    T(16, 'Small Hours', 'Juno Park', 'Coastal Roads Vol. 1', { aa: 'Various Artists', n: 4, y: 2020 }),
    // Juno Park.
    T(17, 'Front Room', 'Juno Park', 'Small Rooms', { n: 1, y: 2017 }),
    T(18, 'Back Room', 'Juno Park', 'Small Rooms', { n: 2, y: 2017 }),
    T(19, 'Attic', 'Juno Park', 'Small Rooms', { n: 3, y: 2017 }),
    T(20, 'Tape One', 'Juno Park', 'Untitled Tapes', { n: 1 }),
    T(21, 'Tape Two', 'Juno Park', 'Untitled Tapes', { n: 2 }),
    T(22, 'Tape Three', 'Juno Park', 'Untitled Tapes', { n: 3 }),
    T(23, 'Front Room (Demo)', 'Juno Park', 'Small Rooms Demos', { n: 1, y: 2016 }),
    T(24, 'Attic (Demo)', 'Juno Park', 'Small Rooms Demos', { n: 2, y: 2016 }),
    // Mira Vale: no album.
    T(25, 'glass  coast', 'Mira Vale', 'Glass Coast', { n: 1, y: 2021, f: 'FLAC', br: 1010, ms: 241_000 }),
    T(26, 'Undertow', 'Mira Vale', 'Undertow', { n: 1, y: 2021 }),
    T(27, 'Undertow (Live)', 'Mira Vale', 'Undertow', { n: 2, y: 2021 }),
    T(28, 'Salt', 'Mira Vale', '', {}),
    T(29, 'Undertow', 'Mira Vale feat. Juno Park', '', {}),
  ];
}
