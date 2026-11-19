// The stream list's states with nothing (or not yet anything) to list: the placeholders while an add-on is
// asked (the designed card's own geometry, so the cards arrive without moving anything), an add-on that did not
// answer (its name, the reason, Retry for it alone), and the empty states (no add-ons, none compatible, no
// streams). A state has no origin, so it fades in place (stream-motion.js fadeIn), never slides.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {press} from '../ui/motion.js';
import {fadeIn} from './stream-motion.js';

/** A placeholder card while an add-on is asked: a badge, a name and a facts line, at a designed card's height. */
export const skeletonStream = () => h('div', {class: 'stream-skeleton', 'aria-hidden': 'true'},
  h('span', {class: 'sk-top'}, h('i', {class: 'skeleton sk-res'}), h('i', {class: 'skeleton sk-tech'})), h('i', {class: 'skeleton sk-name'}), h('i', {class: 'skeleton sk-facts'}));

/** An add-on that failed: its name, why, and Retry for that add-on only. */
export function failedRow(g, retry) {
  return h('div', {class: 'group-error', role: 'status'},
    h('span', {class: 'group-error-icon', 'aria-hidden': 'true'}, icon('info', {size: 20})),
    h('span', {class: 'group-error-text'}, h('b', {}, `${g.addon.name} didn't answer`), g.error?.message ? h('small', {}, g.error.message) : null),
    press(h('button', {class: 'chip', type: 'button', 'aria-label': `Retry ${g.addon.name}`, onclick: retry}, 'Retry')));
}

/** An empty state: a quiet icon, a headline, a line of help and, when something can be done, one button. Fades in. */
export function emptyState(title, body, action = null, iconName = 'sources') {
  const el = h('div', {class: 'state-card', role: 'status'}, h('span', {class: 'state-icon', 'aria-hidden': 'true'}, icon(iconName, {size: 28})),
    h('h3', {}, title), h('p', {}, body), action ? press(h('button', {class: 'btn primary wide', type: 'button', onclick: action.run}, action.label)) : null);
  queueMicrotask(() => fadeIn(el, 'fade:streams-state'));
  return el;
}
