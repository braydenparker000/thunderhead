// Settings → Notifications (MENU-AND-SETTINGS.md §4.3): "Let me reach you", the only place the
// browser is asked for permission; the state line; the budget; once on, a test and turning it off.
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import * as push from '/th/push/phone.js';
import { el, toast } from '/th/ui.js';
import { group, icon, switchRow } from './components.js';

const STATE = {
  off: 'Not set up',
  on: 'On',
  blocked: "Blocked in Chrome. Turn it on in Chrome's site settings for this site.",
  unsupported: "This browser can't show notifications.",
};

/** @param {HTMLElement} body */
export async function notifications(body) {
  const status = el('p', { class: 'shelp', role: 'status' });
  const budget = el('p', { class: 'shelp', text: 'At most 2 a day, never in quiet hours. New sign-ins on another device always reach you.' });
  const host = el('div', { class: 'sform' });
  const line = el('p', { class: 'line', role: 'status' });
  body.replaceChildren(group('This phone', [el('div', { class: 'row' }, [icon('bell'), status]), host]), budget, line);

  /** @param {() => Promise<unknown>} work @param {HTMLButtonElement} button */
  const run = async (work, button) => {
    button.disabled = true;
    line.textContent = '';
    try {
      await work();
    } catch (e) {
      line.textContent = lineFor(failure(e));
    }
    button.disabled = false;
    await draw();
  };

  async function draw() {
    const s = await push.state();
    status.textContent = STATE[s];
    host.hidden = s === 'blocked' || s === 'unsupported';
    if (s === 'on') {
      const testBtn = el('button', { type: 'button', class: 'btn', text: 'Send a test' });
      const off = switchRow('Turn off on this phone', 'bell', true, () => run(() => push.turnOff(), off));
      testBtn.addEventListener('click', () =>
        run(async () => toast((await push.test()) ? 'Sent. It should arrive in a moment.' : "This phone isn't set up yet. Turn it off and on again."), testBtn),
      );
      host.replaceChildren(testBtn, off);
    } else if (s === 'off') {
      const on = switchRow('Let me reach you', 'bell', false, () => run(() => push.turnOn(), on));
      host.replaceChildren(on);
    } else host.replaceChildren();
  }
  await draw();
}
