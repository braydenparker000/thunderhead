// @ts-check
// A preview build (.github/workflows/preview.yml): a branch's site at the preview address, talking to
// the live Worker, for the owner to try a change on the phone before merging it. A small label says
// which branch this is, so a preview is never mistaken for the live app. It takes no touches.
import { CONFIG } from '/config.js';

const label = document.createElement('div');
label.textContent = `Preview · ${String(CONFIG.preview).replace(/^claude\//, '')}`;
label.setAttribute('role', 'note');
label.style.cssText =
  'position:fixed;z-index:2147483647;left:50%;bottom:calc(4px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);padding:3px 10px;border-radius:999px;background:#f2b632;color:#3a2600;font:600 11px/1.4 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;opacity:.92';
document.body.append(label);
