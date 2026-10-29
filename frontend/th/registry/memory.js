// @ts-check
// The Memory page's registry (MENU-AND-SETTINGS.md §4.4, MEMORY.md §12, COPY.md §1.2): how each
// fact kind, source and evidence ref is named on the phone. Forward compatible: a kind, source or
// ref this build doesn't know still renders, under "Other" and by its own name, so a Worker that
// learns a new kind never breaks an older phone. tests/registries.test.mjs checks every kind and
// source in the contract has its entry here.

import { MEMORY } from '../contract.js';

/** @typedef {import('../../../shared/contract/api.ts').Fact} Fact */
/** @typedef {import('../../../shared/contract/api.ts').EvidenceItem} EvidenceItem */

/** Groups in page order. `faith` facts are the owner's beliefs, shown on their own (owner ruling). */
export const GROUPS = [
  { id: 'rule', label: 'How to talk to me', help: 'Standing rules. I follow these every time.' },
  { id: 'beliefs', label: 'Beliefs', help: "Only from your own words. I don't bring these up." },
  { id: 'state', label: 'Right now' },
  { id: 'goal', label: 'Goals' },
  { id: 'preference', label: 'Preferences' },
  { id: 'routine', label: 'Routines' },
  { id: 'fact', label: 'Facts' },
  { id: 'other', label: 'Other' },
];

/** The fact kinds the Add form offers, in that order. */
export const ADD_KINDS = [
  ['preference', 'A preference'],
  ['routine', 'A routine'],
  ['fact', 'A fact'],
  ['goal', 'A goal'],
  ['state', 'Something true right now'],
  ['rule', 'How to talk to me'],
];

/** COPY.md `set.memory.source`. */
export const SOURCES = { user: 'You said', observed: 'I noticed', inferred: 'I inferred' };

/** @param {string} source */
export const sourceLabel = (source) => (Object.hasOwn(SOURCES, source) ? SOURCES[/** @type {keyof typeof SOURCES} */ (source)] : source);

/** Which group a fact is listed in. @param {Pick<Fact, 'kind' | 'tags'>} f */
export function groupOf(f) {
  if (f.kind !== 'rule' && f.tags.includes('faith')) return 'beliefs';
  return GROUPS.some((g) => g.id === f.kind) ? f.kind : 'other';
}

/** Where a current fact goes: the review list, Fading, or its group. @param {Fact} f */
export function shelfOf(f) {
  if (f.tags.includes('imported') && f.source !== 'user') return 'review';
  if (f.kind !== 'rule' && !f.pinned && f.confidence_now < MEMORY.confidence.fading) return 'fading';
  return groupOf(f);
}

/** COPY.md §1.2: one of the odds phrases with its own number, the band nearest the confidence
 * ("Pretty sure, about 8 in 10"). Never "10 in 10". @param {number} c */
export function odds(c) {
  if (c >= 0.85) return 'Almost certainly, about 9 in 10 or more';
  if (c >= 0.75) return 'Pretty sure, about 8 in 10';
  if (c >= 0.6) return 'Probably, about 7 in 10';
  if (c >= 0.4) return 'Maybe, maybe not, about 5 in 10';
  if (c >= 0.15) return 'I doubt it, about 3 in 10';
  return 'Very unlikely, 1 in 10 or less';
}

const REF_LABELS = {
  msg: (/** @type {EvidenceItem} */ e) => (e.who === 'owner' ? 'You said' : e.who === 'mind' ? 'I said' : 'A message'),
  day: () => 'My note on that day',
  ledger: (/** @type {EvidenceItem} */ e) => (e.who === 'owner' ? 'You set this here' : 'A change I made'),
  import: () => 'Your old notebook',
  event: () => 'Something you did',
};

/** How one piece of evidence is introduced. @param {EvidenceItem} e */
export function evidenceLabel(e) {
  return Object.hasOwn(REF_LABELS, e.kind) ? REF_LABELS[/** @type {keyof typeof REF_LABELS} */ (e.kind)](e) : e.kind;
}

/** The ref kinds this registry names (the test checks the evidence kinds the Worker accepts). */
export const REF_KINDS = Object.keys(REF_LABELS);

/** Accent- and case-folded text, for the page's filter. @param {string} s */
export const fold = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
