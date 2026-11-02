// @ts-check
// Cards docked by the ask bar (HOME.md §3; owner, 2026-10-31: home is a chat, so what the owner acts
// on sits by the ask bar, never at the top of the thread): the decision card, and above it the
// working card (th/chat/working.js). Each dock is a slot just before #ask; they stack upward in
// ORDER, each told the height under it (--under), and --dock-h is their height together, so the
// conversation, the "New reply" pill and the toasts keep above them however tall they are.

const ORDER = ['decision', 'working'];
/** @type {Map<string, HTMLElement>} */
const slots = new Map();
const sizes = new ResizeObserver(() => {
  let under = 0;
  for (const id of ORDER) {
    const slot = slots.get(id);
    if (!slot) continue;
    slot.style.setProperty('--under', `${under}px`);
    if (slot.offsetHeight) under += slot.offsetHeight + 10;
  }
  document.documentElement.style.setProperty('--dock-h', `${under}px`);
});

/** The slot for one docked card, made once. @param {string} id @param {Element} ask */
export function dock(id, ask) {
  let slot = slots.get(id);
  if (slot) return slot;
  slot = document.createElement('div');
  slot.id = id;
  slot.className = 'dock';
  ask.before(slot);
  slots.set(id, slot);
  sizes.observe(slot);
  return slot;
}
