// Standing permissions (MENU-AND-SETTINGS.md §6.6, API.md §11.11): every action the mind takes on
// the owner's things, as data. Each names its class, whose setting (`mind.permit.<class>`, in
// settings.ts) says how the mind may take it: `ask` (a decision card first), `tell` (do it and say
// so) or `quiet` (do it; the ledger only). An action that spends money, deletes the owner's data,
// touches keys or access, or reaches another person carries its `floor`: it always waits for a card,
// whatever the setting says. Verbs carry theirs in verbs.ts (`permit`, `floor`); the actions Core
// runs itself are listed here. The Worker enforces it at each write the mind makes
// (backend/src/areas/mind/permit.ts), the briefing explains it, and CONTRACT.md lists it. Plain data.
import { type SettingSpec, SETTINGS } from './settings.ts';
import { VERBS } from './verbs.ts';

export const PERMIT_POSITIONS = ['ask', 'tell', 'quiet'] as const;
export type PermitPosition = (typeof PERMIT_POSITIONS)[number];

/** The classes, in Settings' order; each has its `mind.permit.<class>` row. */
export const PERMIT_CLASSES = [
  'music',
  'podcasts',
  'reminders',
  'settings',
  'muse',
  'watch',
  'practice',
  'tiles',
  'titles',
  'outside',
] as const;
export type PermitClass = (typeof PERMIT_CLASSES)[number];

/** The floors no setting lowers, named as the decision-card class an approval of one is filed
 * under (proposals.ts), with the owner's words for each (the Settings page lists them). */
export const PERMIT_FLOORS = {
  money: 'money',
  delete: 'deleting your data',
  access: 'keys and access',
  reach_people: 'reaching another person',
} as const;
export type PermitFloor = keyof typeof PERMIT_FLOORS;

export interface PermitSpec {
  class: PermitClass;
  /** Marked by hand on the action, never inferred from its name. */
  floor?: PermitFloor;
  doc: string;
}

/** The actions Core runs itself for the mind (verbs are in verbs.ts). Not listed, on purpose: the
 * mind's own bookkeeping (session, day and song notes, open threads, predictions, the night's run,
 * its replies), clearing a surface or cancelling a Muse order (each only takes back the mind's own
 * act), a push (it reaches the owner, under `mind.pushes`), and `POST /v1/auth/breakglass`: keys and
 * access, but the way back in when the owner can reach no signed-in device to answer a card, so its
 * ask is its own: the fingerprint the owner gives in their own words, the 24-hour wait and the notice
 * on every device (SIGN-IN.md). */
export const MIND_ACTIONS = {
  'surface.put': { class: 'tiles', doc: 'A line on home or a tile on the Briefing (`PUT /v1/surfaces/:app/:slot`).' },
  'thread.title': { class: 'titles', doc: "A conversation's title or summary (`PATCH /v1/threads/:id`)." },
  'reminder.set': { class: 'reminders', doc: 'A reminder the owner asked for (`PUT /v1/reminders/:id`).' },
  'reminder.cancel': { class: 'reminders', doc: 'Taking a reminder back (`DELETE /v1/reminders/:id`).' },
  'muse.order': { class: 'muse', doc: 'A work order for Muse (`PUT /v1/work/orders/:id`).' },
  'muse.order_personal': {
    class: 'muse',
    floor: 'reach_people',
    doc: "A work order of a kind that carries the owner's data (`personal` in work.ts): Muse runs on another provider (BEHAVIOR.md §7 rule 4). No such kind is built.",
  },
  'memory.outside': {
    class: 'outside',
    doc: 'Keeping a fact learned from outside text. A write from a session that read outside text is labelled outside and waits for the owner\'s Keep in Settings › Memory (MEMORY.md §6 M11); no position loosens that.',
  },
} as const satisfies Record<string, PermitSpec>;
export type MindActionName = keyof typeof MIND_ACTIONS;

/** An action's class and floor: a verb's from verbs.ts, Core's own from MIND_ACTIONS; null for a
 * name that is neither. */
export function permitOf(action: string): PermitSpec | null {
  if (Object.hasOwn(VERBS, action)) {
    const v = VERBS[action as keyof typeof VERBS] as { permit: PermitClass; floor?: PermitFloor; doc: string };
    return { class: v.permit, ...(v.floor ? { floor: v.floor } : {}), doc: v.doc };
  }
  return Object.hasOwn(MIND_ACTIONS, action) ? MIND_ACTIONS[action as MindActionName] : null;
}

/** The action's class, or null for an unknown name. */
export const classOf = (action: string): PermitClass | null => permitOf(action)?.class ?? null;

/** The setting that holds a class's position. */
export const permitKey = (c: PermitClass) => `mind.permit.${c}` as const;

/** Each class's Settings row (its label and default). */
export function permitSetting(c: PermitClass): SettingSpec {
  const s = (SETTINGS as readonly SettingSpec[]).find((x) => x.key === permitKey(c));
  if (!s) throw new Error(`no setting for ${permitKey(c)}`);
  return s;
}

/** What a gated write answers with beside its record, so the chat role knows whether to say what it
 * did: the action, its class and the position it ran under (`ask` once a card approved it). */
export interface Permit {
  action: string;
  class: PermitClass;
  position: PermitPosition;
}

/** The refusal's `details` (403 `proposal_required`, reason `permit`): what was asked and the card
 * that would allow it, ready for `th propose --class <card.class> --spec '<card.spec>'`; then the same
 * call again with the approved card's id (`proposal_id` in a verb's body, `TH-Proposal` elsewhere). */
export interface PermitRefusal {
  reason: 'permit';
  action: string;
  class: PermitClass;
  position: 'ask';
  floor: PermitFloor | null;
  card: { class: PermitFloor | 'permit'; spec: { v: 1; op: 'permit.allow'; args: { action: string; call: string } } };
  /** Why the card the call named (if any) did not count: none such, still waiting for the owner,
   * not approved, already used, approved more than 7 days ago, or approving another call. */
  given?: 'not_found' | 'waiting' | 'not_approved' | 'used' | 'expired' | 'other_call';
}
