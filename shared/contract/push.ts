// Web Push (P8; API.md, SECURITY.md §10, BEHAVIOR.md §3.4): a phone's subscription, the words a
// push points at (the payload itself is only a kind and an id), and the mind's nudge.
import type { Ms } from './api.ts';


/** What a push is: the mind's nudge, a sign-in notice, or the owner's own test. */
export type PushKind = 'nudge' | 'security' | 'test';
export interface PushKeyResponse {
  /** The VAPID public key, base64url (the uncompressed P-256 point). */
  vapid_public_key: string;
}
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
/** The words a push points at; the phone fetches them with its own token. */
export interface PushItem {
  title: string;
  body: string;
  url: string;
}
export interface PutPushRequest {
  /** ≤ 40 characters, no exclamation marks. */
  title: string;
  /** ≤ 100 characters, no exclamation marks. */
  body: string;
  ref?: string;
  /** Why it needs the owner now, ≥ 8 characters (BEHAVIOR.md §3.4 rule 7). */
  why: string;
  topic_key: string;
  /** Dropped if no natural pause comes by then; default 3 hours. */
  deadline?: Ms;
}
export interface PutPushResponse {
  queued_until: Ms;
}
export interface PushTestResponse {
  /** Phones the test went to (0: this phone has no subscription). */
  sent: number;
}
