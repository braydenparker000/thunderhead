// What home's voice line needs from the decision cards (HOME.md §2.1 rows 4–6 and 8): how many wait
// to be seen now, and whether the last one was just answered (and with a yes). The card sets it;
// the conversation repaints its voice line on the `th:decisions` event.

export const decisions = {
  waiting: 0,
  /** @type {null | 'yes' | 'other'} */ answered: null,
};

/** @param {Partial<typeof decisions>} next */
export function setDecisions(next) {
  Object.assign(decisions, next);
  document.dispatchEvent(new CustomEvent('th:decisions'));
}
