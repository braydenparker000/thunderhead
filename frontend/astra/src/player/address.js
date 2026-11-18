// Where the film's address came from, said in the player (the app resolves it, addons/debrid.js, and loads
// the stream with `resolved: {via, reason}`; the lab's streams carry none, so nothing is said there).
// Stream info gains one line; and when Chrome's own player takes over because the host would not let the
// page read the film, the notice says why the add-on's link was used instead of the general sentence.

// The engine's note when a host does not let a web page read the file (engine/http-source.js, engine/plan.js).
const UNREADABLE = /does not let a web page read/;

/** Stream info's line for how the address was found, or null. @param {{via?: string, reason?: string | null} | null | undefined} resolved @param {string} mode */
export function addressLine(resolved, mode) {
  if (resolved?.via === 'torbox') return 'From TorBox directly';
  if (resolved?.via === 'follow') return 'Where the add-on’s link leads, found by your server';
  if (resolved?.via !== 'addon') return null;
  return mode === 'native' && resolved.reason ? resolved.reason : 'Through the add-on’s link';
}

/** The notice to show for `text`: why the add-on's link was used, when Chrome plays it because it could not be read. */
export function addressNotice(resolved, text) {
  if (resolved?.via !== 'addon' || !resolved.reason || !UNREADABLE.test(String(text))) return text;
  return `${resolved.reason} So Chrome plays the add-on’s link as it is: no audio track choice and no built-in subtitles.`;
}
