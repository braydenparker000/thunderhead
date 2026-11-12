// @ts-check
// A short line over the photo for a moment, on whatever board is up (docs/design/EDITOR.md): the header's Undo says
// which step it took back ("Undid Exposure +0.80"), so a tap that changed something out of sight is not a mystery.
import { history, undo as back } from './session.js';

const line = document.createElement('div');
line.setAttribute('role', 'status');
line.className = 'glass'; line.id = 'told';
line.style.cssText = 'position: absolute; left: 50%; top: 60px; transform: translateX(-50%); max-width: 360px; padding: 6px 14px; border-radius: 16px; font: 500 12px Inter, system-ui, sans-serif; color: #f2efe8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 8; pointer-events: none; display: none';
let timer = 0;

/** Says `text` over the photo for a couple of seconds. @param {string} text */
export function tell(text) {
  const frame = document.getElementById('frame');
  if (!frame) return;
  if (!line.isConnected) frame.append(line);
  line.textContent = text; line.style.display = 'block';
  clearTimeout(timer); timer = window.setTimeout(() => { line.style.display = 'none'; }, 2400);
}
/** What is said now ('' when nothing is). */
export const said = () => (line.style.display === 'none' ? '' : line.textContent || '');

/** The header's Undo: back one step of the history, saying which. */
export function undo() {
  const h = history(), step = h.steps[h.at];
  if (!step || h.at <= 0) { tell('Nothing to undo'); return; }
  back();
  tell(`Undid ${step.name}${step.val ? ` ${step.val}` : ''}`);
}
