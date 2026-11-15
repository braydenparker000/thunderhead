// Whether the page may read what a <video> element shows and plays. A film
// the browser fetches from another site without CORS "taints" the element:
// its sound reaches Web Audio as silence and its frames cannot be drawn into
// WebGL (SecurityError). Astra's own pipelines (remux, HLS, DASH) feed the
// element from a blob: MediaSource the page made, which is always readable;
// `native` mode hands the browser the host's address, which often is not.

/**
 * Why the element's media cannot be read by the page, or '' when it can.
 * @param {HTMLVideoElement} video
 */
export function unreadable(video) {
  if (video.srcObject) return ''; // a stream the page made (the software decoder)
  const src = video.currentSrc || video.src;
  if (!src) return 'Nothing is loaded yet.';
  let url;
  try { url = new URL(src, location.href); } catch { return 'The film\'s address could not be read.'; }
  if (url.protocol === 'blob:' || url.origin === location.origin) return '';
  // With crossorigin set, the browser either reads the film with CORS (readable) or refuses to load it (nothing to taint).
  if (video.crossOrigin != null) return '';
  return 'This film comes straight from its host, which does not let the page read it.';
}
