// @ts-check
// A pick in a reply (th/chat/rich.js): where the mind offers an album to add, its line ends with
// `(pick:<MusicBrainz id>)`, drawn as a small Play button that plays the pick's 30-second preview, as
// Settings › Music does (th/music/preview.js, loaded on the first tap: one plays at a time, a second
// tap stops it, leaving stops it, nothing plays without a tap). Its words are drawn by CSS
// (apps/home/chat.css), so the reply's text stays its own; what it says back (loading, no preview) is
// a short line beside it. DOM calls only, never markup.

const SVG = 'http://www.w3.org/2000/svg';

/** @param {string} id the pick's MusicBrainz id @returns {HTMLElement} */
export function pickButton(id) {
  const box = document.createElement('span');
  box.className = 'pick';
  box.dataset.pick = id;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pickplay';
  btn.setAttribute('aria-label', 'Play a preview of this pick');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '/ui/icons.svg#play');
  svg.append(use);
  btn.append(svg);
  const say = document.createElement('span');
  say.className = 'pickline';
  say.setAttribute('aria-live', 'polite');
  /** @param {boolean} on @param {string} line */
  const show = (on, line) => {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-label', on ? 'Stop the preview' : 'Play a preview of this pick');
    use.setAttribute('href', `/ui/icons.svg#${on ? 'stop' : 'play'}`);
    say.textContent = line;
  };
  btn.addEventListener('click', async () => {
    try {
      const { togglePreview } = await import('../music/preview.js');
      await togglePreview(id, box, show);
    } catch {
      show(false, 'I couldn’t play this just now.');
    }
  });
  box.append(btn, say);
  return box;
}
