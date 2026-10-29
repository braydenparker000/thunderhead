// The constitution pin (mind/CONSTITUTION.md, "The constitution pin"): the Worker keeps the SHA-256
// of the laws file the owner last approved (setting `laws.pin`). Every claim sends the hash of its
// clone's mind/CONSTITUTION.md: a match is `laws: pinned`; any other version raises one `access`
// card ("keep the change?") and that session's rule writes are refused until the owner decides.
// The first pin is the owner's tap too ("Pin the laws as they are now?"), so no hash is trusted
// before the owner has seen it. A card is raised once per version: a "No" is never asked again for
// the same text, and a newer text replaces a card still waiting. Rejecting a change leaves the pin
// as it was; the briefing then tells the mind to restore the approved file from git history.

import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { getSetting, putSetting } from '../settings/store';
import * as store from './store';

export interface LawsPin {
  sha256: string;
  pinned_at: number;
  proposal_id: string | null;
}

export function lawsPin(db: Db): LawsPin | null {
  const v = getSetting(db, 'laws.pin') as LawsPin | undefined;
  return v && typeof v.sha256 === 'string' ? v : null;
}

/** M12 and the pin: a session without the file, or with a version the owner has not approved,
 * may not write or replace rules. Before the first pin nothing is refused (P3's rule). */
export function lawsBroken(db: Db, sha: string): boolean {
  if (sha === 'none') return true;
  const pin = lawsPin(db);
  return pin !== null && pin.sha256 !== sha;
}

/** The briefing's laws line (section 1). */
export function lawsLine(db: Db, sha: string): string {
  if (sha === 'none') return 'laws: mind/CONSTITUTION.md missing';
  const pin = lawsPin(db);
  if (pin?.sha256 === sha) return 'laws: pinned';
  const card = store.latestFor(db, `laws:${sha}`);
  if (!pin) {
    const why =
      card?.status === 'waiting'
        ? 'a card waits for the owner'
        : card?.status === 'expired'
          ? 'its card expired unanswered'
          : card?.status === 'rejected'
            ? 'the owner said not now'
            : 'no card yet';
    return `laws: not pinned (${why}; sha256 ${sha.slice(0, 12)})`;
  }
  const restore =
    card?.status === 'rejected' ? '; the owner said restore it: put back the approved file from git history' : '';
  return `laws: CHANGED, NOT APPROVED (approved sha256 ${pin.sha256.slice(0, 12)}, this clone ${sha.slice(0, 12)}); rule writes are refused${restore}`;
}

export interface LawsCard {
  question: string;
  why: string;
  if_ignored: string;
  options: [string, string];
  safe: 'reject' | 'snooze';
  args: { sha256: string; previous: string | null };
}

/** The card a claim's laws hash calls for, or null: pinned already, missing, or this version was
 * asked about before (waiting, decided, or left to expire, which counts as a no). */
export function lawsCard(db: Db, sha: string): LawsCard | null {
  if (sha === 'none') return null;
  const pin = lawsPin(db);
  if (pin?.sha256 === sha) return null;
  if (store.askedAbout(db, `laws:${sha}`)) return null;
  const short = sha.slice(0, 12);
  return pin
    ? {
        question: 'The laws file changed without your OK. Keep the change?',
        why: `mind/CONSTITUTION.md is now sha256 ${short}; you approved ${pin.sha256.slice(0, 12)}. Rule writes wait for you.`,
        if_ignored: 'Rule writes stay refused; nothing else changes.',
        options: ['Keep the change', 'Restore it'],
        safe: 'reject',
        args: { sha256: sha, previous: pin.sha256 },
      }
    : {
        question: 'Pin the laws as they are now?',
        why: `Then any change to mind/CONSTITUTION.md needs your OK first. This version is sha256 ${short}.`,
        if_ignored: 'Nothing happens; the laws stay unpinned.',
        options: ['Pin them', 'Not now'],
        safe: 'snooze',
        args: { sha256: sha, previous: null },
      };
}

/** Approving a laws card: the pin moves to its version. */
export function pin(w: Writer, sha: string, proposalId: string): string {
  putSetting(
    w.db,
    'laws.pin',
    { sha256: sha, pinned_at: w.at, proposal_id: proposalId } satisfies LawsPin,
    'owner',
    w.at,
  );
  w.change('setting', 'setting:laws.pin');
  return w.ledger({
    kind: 'note',
    actor: 'owner',
    what: `pinned the laws file (sha256 ${sha.slice(0, 12)})`,
    why: 'the owner approved this version of mind/CONSTITUTION.md',
    ref: `proposal:${proposalId}`,
    undoable: false,
  });
}
