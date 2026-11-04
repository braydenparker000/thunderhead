// The entries of a zip the owner dropped (a Spotify or Google Takeout export), read with the runtime's
// own DecompressionStream: no library. Only stored and deflated entries, no zip64 and no encryption,
// which is what those exports are; anything else is not read. Names are kept to pick the files.
const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

export interface ZipEntry {
  name: string;
  read(): Promise<string>;
}

export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

async function inflate(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

/** The zip's entries (directories left out), or null when its end record can't be found. */
export function zipEntries(b: Uint8Array): ZipEntry[] | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--)
    if (u32(v, i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) return null;
  const count = u16(v, end + 10);
  let at = u32(v, end + 16);
  const out: ZipEntry[] = [];
  const names = new TextDecoder();
  for (let n = 0; n < count && at + 46 <= b.length && u32(v, at) === 0x02014b50; n++) {
    const method = u16(v, at + 10);
    const size = u32(v, at + 20);
    const nameLen = u16(v, at + 28);
    const local = u32(v, at + 42);
    const name = names.decode(b.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + u16(v, at + 30) + u16(v, at + 32);
    if (name.endsWith('/') || (method !== 0 && method !== 8) || local + 30 > b.length) continue;
    const data = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    const raw = b.subarray(data, data + size);
    out.push({
      name,
      read: async () => new TextDecoder().decode(method === 0 ? raw : await inflate(raw)),
    });
  }
  return out;
}

/** The entries that are listening history: json and csv, outside macOS's resource folders, and not
 * Spotify's video streams or YouTube's searches. */
export const historyEntries = (es: ZipEntry[]) =>
  es.filter(
    (e) =>
      /\.(json|csv)$/i.test(e.name) &&
      !/__MACOSX|search-history|Streaming_History_Video/i.test(e.name) &&
      /history|scrobble|lastfm|recenttracks/i.test(e.name),
  );
