// The list for the builder (API.md §11.30, DATA.md §4.1): what annoyed the owner or broke, kept for
// the next building session. The owner says so in the chat and the chat mind files it, citing that
// message; the owner adds, edits, marks done and reopens items in Settings › For the builder; the
// ci key and the builders' tools read it. Notes are only ever added, and nothing is ever deleted.
import type { Id, Ms } from './api.ts';

export const ISSUE_KINDS = ['annoying', 'broken', 'idea'] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_STATES = ['open', 'done'] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export const ISSUE_LIMITS = {
  /** The title, one plain line, in characters. */
  title: 120,
  /** What happened, in characters (newlines kept). */
  what: 1_000,
  /** Where: the app or page, one plain line, in characters. */
  where: 60,
  /** One note, in characters. */
  note: 1_000,
  /** Notes on one item. */
  notes: 50,
  /** How recent the owner's message the mind cites must be, in hours. */
  from_hours: 48,
  /** Items one list answers, newest first. */
  list: 200,
} as const;

export interface IssueNote {
  id: Id;
  at: Ms;
  by: 'owner' | 'mind';
  text: string;
}

export interface Issue {
  id: Id;
  /** When it was filed. */
  at: Ms;
  title: string;
  /** What happened, in the owner's words. */
  what: string;
  /** The app or page it happened in. */
  where: string | null;
  kind: IssueKind;
  /** `owner_device`: added in Settings; `mind`: filed by the chat mind from the owner's message. */
  origin: 'owner_device' | 'mind';
  /** The owner's message it came from (the mind's items always name one). */
  from_message_id: Id | null;
  /** What the site knew then: the Worker's release (the 12-character commit it was deployed from). */
  release: string | null;
  /** …and the newest error (`error:<fingerprint>`) or report (`report:<id>`) matching `where`, if any. */
  seen: string | null;
  state: IssueState;
  done_at: Ms | null;
  updated_at: Ms;
  /** Oldest first. */
  notes: IssueNote[];
}

export interface PutIssueRequest {
  title: string;
  what: string;
  where?: string;
  /** Default `annoying`. */
  kind?: IssueKind;
  /** mind:chat only, and required there: an owner-device message of the last 48 hours. */
  from_message_id?: Id;
}

/** The owner's edit: any of the fields, and `state` to mark it done or reopen it. */
export interface PatchIssueRequest {
  title?: string;
  what?: string;
  where?: string | null;
  kind?: IssueKind;
  state?: IssueState;
}

export interface IssueNoteRequest {
  text: string;
}

export interface IssueResponse {
  issue: Issue;
}

export interface IssuesResponse {
  /** Newest first, at most ISSUE_LIMITS.list. */
  items: Issue[];
  /** More items of that state than the list holds. */
  more: boolean;
}
