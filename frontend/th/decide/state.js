// What home knows of the decision cards: how many wait to be seen now, and whether the last one was
// just answered (and with a yes). The card sets it and fires `th:decisions`. (The voice line that
// counted them is gone, HOME.md §2: the docked card says it itself.)

export const decisions = {
  waiting: 0,
  /** @type {null | 'yes' | 'other'} */ answered: null,
};

/** @param {Partial<typeof decisions>} next */
export function setDecisions(next) {
  Object.assign(decisions, next);
  document.dispatchEvent(new CustomEvent('th:decisions'));
}
