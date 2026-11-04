// @ts-check
// Music's "tonight" (`music/tonight`, kind `mix`; MIND-PLAN §3.7): a mix the mind saved with
// music.mix_save and placed on the home shelf, as one card over the library's home (shown while
// the home list is on screen: `data-cp-home` and `data-cp-list`, set by the list), with its why
// behind a tap and Dismiss (th/ported/arrangement.js sends the senses). Play is the owner's tap: the
// mix's songs (GET /v1/music/mixes/:id) become the queue through music.play_mix's own executor, so
// the Queue sheet and its undo are the same, and it starts at once, the tap being the gesture.
// Loaded by th/music/dj.js `installDj`, which the player runs.
import { getJson, mount } from '../ported/arrangement.js';
import { EXECUTORS } from './intents.js';

/** @param {any} ctx the player's context (its library) @param {any} player */
export function installTonight(ctx, player) {
  /** @param {string} id */
  const play = async (id) => {
    const mix = await getJson(`/v1/music/mixes/${encodeURIComponent(id)}`);
    if (!Array.isArray(mix?.refs)) return;
    const out = await EXECUTORS['music.play_mix'][1]({ player, library: ctx.library }, { refs: mix.refs, index: 0 });
    if (out.ok) player.play();
  };
  void mount(
    'music',
    'tonight',
    (a) => ({
      label: 'Tonight',
      title: String(a.payload.name ?? 'A mix'),
      detail: a.payload.tracks ? `A mix · ${a.payload.tracks} songs` : 'A mix',
      action: 'Play',
      go: () => play(String(a.payload.mix_id)),
    }),
    (card) => document.body.append(card),
  );
}
