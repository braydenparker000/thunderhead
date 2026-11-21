// When covers may use the link (MUSIC.md §6.3): the playing song first. A wait resolves true once nothing
// plays (or the deck is paused) or the playing deck sounds with its stream far enough ahead (`free()`),
// read again on the deck's own events (progress, timeupdate, playing, pause, emptied); false after MAX_MS
// (a link that never gets that far ahead: covers then load one at a time at low priority). One wait is
// shared by every caller: one set of listeners and one timer, no polling.

export const MAX_MS = 3000;
const EVENTS = ['progress', 'timeupdate', 'playing', 'pause', 'emptied'];

/** @param {{audio: HTMLMediaElement|null}} player @param {() => boolean} free */
export function waitLinkFree(player, free, maxMs = MAX_MS) {
  if (free()) return Promise.resolve(true);
  const el = player.audio;
  if (player._linkWait?.el === el) return player._linkWait.p;
  let finish;
  const p = new Promise(resolve => {
    const check = () => { if (free()) finish(true); };
    const timer = setTimeout(() => finish(false), maxMs);
    finish = v => {
      clearTimeout(timer);
      for (const type of EVENTS) el?.removeEventListener(type, check);
      if (player._linkWait?.p === p) player._linkWait = null;
      resolve(v);
    };
    for (const type of EVENTS) el?.addEventListener(type, check);
  });
  player._linkWait = {el, p};
  return p;
}
