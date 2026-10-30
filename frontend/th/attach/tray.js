// @ts-check
// What is picked for the next message, inside the ask bar above the text (HOME.md §6.2): a photo as
// a 40 px thumbnail, a file as its icon and name, a voice memo as its length, each with × to take
// it out. While anything is there the bar can send without words.
import { clock, onPicked, picked, remove, size } from './state.js';

const ask = /** @type {HTMLFormElement} */ (document.querySelector('#ask'));
const q = /** @type {HTMLTextAreaElement} */ (document.querySelector('#q'));
const tray = document.createElement('div');
tray.className = 'tray';
tray.setAttribute('role', 'list');
tray.setAttribute('aria-label', 'Attached');
ask.prepend(tray);

/** @param {string} name */
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${name}"/></svg>`;

function draw() {
  tray.replaceChildren(
    ...picked.map((f) => {
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      if (f.thumb) {
        item.className = 'ti tpic';
        const img = document.createElement('img');
        img.src = f.thumb;
        img.alt = f.name;
        item.append(img);
      } else {
        const memo = f.seconds !== undefined;
        item.className = `ti ${memo ? 'tmemo' : 'tdoc'}`;
        item.innerHTML = icon(memo ? 'waveform' : 'file-text');
        const label = document.createElement('span');
        label.textContent = memo ? clock(f.seconds ?? 0) : f.name;
        item.title = memo ? 'Voice memo' : `${f.name}, ${size(f.bytes)}`;
        item.append(label);
      }
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tix';
      x.setAttribute('aria-label', `Remove ${f.seconds !== undefined ? 'the voice memo' : f.name}`);
      x.innerHTML = icon('x');
      x.addEventListener('click', () => remove(f.id));
      item.append(x);
      return item;
    }),
  );
  ask.classList.toggle('hasfiles', picked.length > 0);
  // home.js decides between the mic and send on input.
  q.dispatchEvent(new Event('input'));
}

onPicked(draw);
draw();
