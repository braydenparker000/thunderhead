// The old catalog's shapes (the old repo's frontend/drawercast/r2-library.js, the as-is port's
// format, MUSIC.md §1.3): a track id, the content keys of its audio and art in `jarvis-music`,
// and a waveform (base64 of one byte a bar, 16 to 1000 bars). The import checks each old row
// against them, and a signed link is made only for a key of these shapes.

export const SONG_ID = /^r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
export const AUDIO_KEY =
  /^(?:audio\/[A-Za-z0-9_-]{10,200}\/(?:[a-f0-9]{32}|[a-f0-9]{64})\.[a-z0-9]{1,8}|native\/audio\/[a-f0-9]{64}\.opus)$/;
export const ART_KEY = /^native\/art\/[a-f0-9]{64}\.(jpg|png)$/;

/** Base64 bars to bytes, or null when it isn't a waveform. */
export function waveBytes(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length < 20 || value.length > 1400) return null;
  let text: string;
  try {
    text = atob(value);
  } catch {
    return null;
  }
  if (text.length < 16 || text.length > 1000) return null;
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
