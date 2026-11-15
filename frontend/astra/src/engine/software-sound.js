// The sound features in software-decoder mode (software.js): libmedia plays
// the sound itself, into the MediaStream on Astra's <video>, so it never passes
// through the element where enhance/sound.js could take it. Its own path is
// audioSourceNode (an AudioWorklet node, or a fallback that queues buffers;
// both have connect/disconnect) → gainNode (its volume) → a
// MediaStreamDestination whose track is the stream's sound. The chain
// (enhance/sound-chain.js, made by the player with libmedia's shared
// AudioContext, AVPlayer.audioContext) goes between the first two, so the
// stream keeps its track and libmedia keeps its volume.
//
// Read in libmedia 1.x (frontend/assets/libmedia/avplayer.js): the path is
// built once per player, on the first play (playUseDecoder); choosing another
// sound track reopens the decoder and keeps the nodes, and fires 'changed'.
// On every 'changed' the path is looked at again and the chain put back in if
// libmedia built new nodes. Anything that fails puts the source straight back
// on the volume: the film is never left without sound by this.

/**
 * Puts the chain `makeChain(ctx)` returns ({in, out} AudioNodes) into a software session's sound path, now and
 * whenever libmedia builds a new one. Returns true when it is in now.
 */
export function routeSoftwareSound(session, makeChain, log = () => {}) {
  session.makeChain = makeChain;
  if (!session.rerouting && typeof session.engine?.on === 'function') {
    session.rerouting = true;
    session.engine.on('changed', () => { if (!session.destroyed) reroute(session, log); });
  }
  return reroute(session, log);
}

function reroute(session, log) {
  const engine = session.engine, ctx = session.AVPlayer?.audioContext;
  const source = engine?.audioSourceNode, gain = engine?.gainNode;
  if (!session.makeChain || !ctx || !source?.connect || !source.disconnect || !gain?.connect) return false; // no sound (yet)
  const route = session.soundRoute;
  if (route?.source === source && route.gain === gain) return true;
  let chain = null;
  try {
    chain = route?.gain === gain && route.chain ? route.chain : session.makeChain(ctx);
    if (!chain?.in?.connect || !chain.out?.connect || chain.in.context !== ctx) throw Error('the chain is not for this sound');
    chain.out.connect(gain); // the way out first, so the sound has somewhere to go the moment it is moved
    source.disconnect();
    source.connect(chain.in);
    session.soundRoute = {source, gain, chain};
    log('the sound chain is in the software decoder\'s sound');
    return true;
  } catch (error) {
    try { source.disconnect(); } catch {}
    try { source.connect(gain); } catch {}
    try { chain?.out?.disconnect(); } catch {}
    session.soundRoute = null;
    log(`the sound chain could not be put in: ${String(error?.message || error).slice(0, 120)}`);
    return false;
  }
}
