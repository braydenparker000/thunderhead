// A song arriving over full scale (MUSIC.md §5 "Clipping and headroom"): its input trim, set only when a
// song starts and never changed inside it, so nothing steps where it can be heard.
// - Tagged (ReplayGain peaks): played in album order, the album's peak (one trim for the whole album, no
//   step at a gapless join); otherwise the track's.
// - Untagged: a song that goes over is caught by the output's safety net (limiter.js); the trim its peak
//   calls for applies from the next song of that album played in album order, and carries on through the
//   album (taking a larger trim when a later song needs it, never a smaller one) until a change out of
//   album order or to another album, where it starts again at none.
// "Album order": the next track of the same album (album and album artist) on the same disc, or the first
// track of the next disc. Never a gain up. Pure; dsp.js runs it, the tests run it directly.

const lc = s => String(s ?? '').trim().toLowerCase();
/** The album a song belongs to ('' for none). */
export const albumKey = t => (t?.album ? lc(t.album) + '\u0000' + lc(t.albumArtist || t.artist) : '');

/** Whether t is the song after prev in its album. */
export function inAlbumOrder(prev, t) {
  if (!prev || !t || !albumKey(t) || albumKey(prev) !== albumKey(t)) return false;
  const d0 = prev.disc || 0, d1 = t.disc || 0;
  return (d1 === d0 && t.track > 0 && t.track === (prev.track || 0) + 1) || (d1 === d0 + 1 && t.track === 1);
}

const num = v => (v !== undefined && v !== null && Number.isFinite(+v) && +v > 0 ? +v : 0);

/**
 * A song's trim when it starts: {trim (linear, ≤ 1), carry (what the next song of its album may take)}.
 * gain: its ReplayGain (linear); carry: the last result's carry, updated by learnTrim.
 */
export function songTrim({t, prev, gain = 1, carry = null}) {
  const follows = inAlbumOrder(prev, t), rg = t?.replayGain ?? {};
  const peak = follows ? num(rg.albumPeak) || num(rg.trackPeak) : num(rg.trackPeak) || num(rg.albumPeak);
  const key = albumKey(t);
  if (peak) {
    const over = peak * gain;
    return {trim: over > 1 ? 1 / over : 1, carry: {key, trim: 1, tagged: true}};
  }
  const trim = follows && carry && carry.key === key ? carry.trim : 1;
  return {trim, carry: {key, trim}};
}

/** A song's decoded peak (linear) seen while it played at ReplayGain gain: the trim its album's next songs take. */
export function learnTrim(carry, t, peak, gain = 1) {
  const key = albumKey(t);
  if (!key || !carry || carry.key !== key || carry.tagged) return carry;
  const over = peak * gain;
  return over > 1 ? {key, trim: Math.min(carry.trim, 1 / over)} : carry;
}
