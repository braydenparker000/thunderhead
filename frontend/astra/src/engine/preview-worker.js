// The seek previews' decoder, in a worker of its own (preview-decode.js starts one per film and ends it with
// the film): a key frame in, a small picture out, so neither the decoding nor the copy of the decoded frame
// into a picture (tens of milliseconds for 1080p on a slow phone, several times that for 4K) is done on the
// page's thread. One request at a time: the page sends the next only when this one has answered.
//   {type: 'config', config, width, height} → {type: 'config', ok}
//   {type: 'decode', id, data} → {type: 'picture', id, bitmap} | {type: 'picture', id, error}
//   {type: 'stop'}: the request under way ends (its answer is an error)

let decoder = null, config = null, size = null, waiting = null;

function open() {
  if (decoder && decoder.state !== 'closed') return decoder;
  decoder = new VideoDecoder({output: frame => (waiting ? waiting(frame) : frame.close()), error: () => {}});
  return decoder;
}

async function decode(data) {
  const d = open();
  if (d.state === 'configured') d.reset();
  d.configure(config);
  let got = null;
  waiting = frame => { got?.close(); got = frame; };
  try {
    d.decode(new EncodedVideoChunk({type: 'key', timestamp: 0, data}));
    await d.flush();
    if (!got) throw Error('The decoder gave no picture.');
    return await createImageBitmap(got, {resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium'});
  } finally { waiting = null; got?.close(); }
}

self.onmessage = async ({data: m}) => {
  if (m.type === 'config') {
    config = m.config; size = {width: m.width, height: m.height};
    let ok = false;
    try { ok = typeof VideoDecoder === 'function' && (await VideoDecoder.isConfigSupported(config)).supported; } catch {}
    self.postMessage({type: 'config', ok});
  } else if (m.type === 'decode') {
    try { const bitmap = await decode(m.data); self.postMessage({type: 'picture', id: m.id, bitmap}, [bitmap]); }
    catch (e) { self.postMessage({type: 'picture', id: m.id, error: String(e?.message || e)}); }
  } else if (m.type === 'stop') {
    try { if (decoder?.state === 'configured') decoder.reset(); } catch {} // the flush under way rejects: its answer is an error
  }
};
