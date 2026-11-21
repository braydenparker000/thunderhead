// @ts-check
// Settings → Notifications (MENU-AND-SETTINGS.md §4.3): every way of reaching the owner on one page,
// under plain headings. This phone: a stable on/off switch (only turning it on asks the browser) and
// a test. What I send: `mind.pushes` and `mind.speech` from the catalogue (catalog.js), kept by the
// Worker. Quiet hours and Go quiet now (home.js quietPart). The old Quiet hours page opens here at
// that section (settings.js).
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import * as push from '/th/push/phone.js';
import { el, toast } from '/th/ui.js';
import { renderGroup } from './catalog.js';
import { group, icon, switchRow } from './components.js';
import { quietPart } from './home.js';

const STATE = {
  off: 'Not set up',
  on: 'On',
  blocked: "Blocked in Chrome. Turn it on in Chrome's site settings for this site.",
  unsupported: "This browser can't show notifications.",
};

/** This phone's push: its state, the switch and the test. @returns {Node[]} */
function phonePart() {
  const status = el('p', { class: 'shelp', role: 'status' });
  const host = el('div', { class: 'sform' });
  const line = el('p', { class: 'line', role: 'status' });
  const state = el('div', { class: 'row', 'data-info': '' }, [icon('bell'), status]);

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
  /** @param {HTMLElement} n */
  const act = (n) => { n.dataset.action = 'push'; return n; };

  async function draw() {
    const s = /** @type {keyof typeof STATE} */ (await push.state());
    status.textContent = STATE[s];
    host.hidden = s === 'blocked' || s === 'unsupported';
    if (s === 'on') {
      const testBtn = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'btn', text: 'Send a test' }));
      const off = act(switchRow('Notifications on this phone', 'bell', true, () => run(() => push.turnOff(), /** @type {any} */ (off))));
      // The switch reads On, so a test that reached no phone sends this phone's subscription again and tries
      // once more; it never asks to flip the switch.
      const sent = async () => (await push.test()) || (await push.resend(), await push.test());
      testBtn.addEventListener('click', () =>
        run(async () => toast((await sent()) ? 'Sent. It should arrive in a moment.' : "Couldn't reach this phone. Try again."), testBtn),
      );
      host.replaceChildren(testBtn, off);
    } else if (s === 'off') {
      const on = act(switchRow('Notifications on this phone', 'bell', false, () => run(() => push.turnOn(), /** @type {any} */ (on))));
      host.replaceChildren(on);
    } else host.replaceChildren();
  }
  void draw();
  return [
    group('This phone', [state, host]),
    el('p', { class: 'shelp', text: "At most 2 a day from me, never in quiet hours. Reminders you set and the usage alarm don't count toward the 2. New sign-ins on another device always reach you." }),
    line,
  ];
}

/** @param {HTMLElement} body */
export async function page(body) {
  const quiet = el('div', { class: 'squiet' });
  const done = quietPart(quiet);
  await renderGroup(body, 'notifications', { before: phonePart(), after: [quiet] });
  return await done;
}
