// What a verb is (verbs.ts), and the schema pieces the verb files share: a song, the owner's own
// messages. Plain data; Node imports it without a build.
import * as z from 'zod/mini';
import type { PermitClass, PermitFloor } from './permits.ts';

export interface VerbVersion {
  args: z.ZodMiniType;
  result: z.ZodMiniType;
}

export interface VerbSpec {
  /** The app that owns it; `shell` = the Thunderhead's own home and menu. An intent's app is the
   * one that applies it when it opens. */
  app: string;
  /** `reversible`: done under its class's standing permission; `ask_first`: it has a floor, so only
   * ever with an approved card. */
  class: 'reversible' | 'ask_first';
  /** The standing permission that decides how the mind may queue it (`mind.permit.<class>`); null
   * only for a verb that is the owner's own words and nothing else (`memory.note`: the Worker's
   * memory rules check that its evidence is the owner's messages), so no position applies. */
  permit: PermitClass | null;
  /** Money, the owner's data deleted, keys or access, another person reached: always a card first.
   * Set exactly on the `ask_first` verbs (tests/contract-gen.test.mjs). */
  floor?: PermitFloor;
  /** Never below `tell`, whatever the class's position: it takes away something the owner chose,
   * so the mind always says so (areas/mind/permit.ts). */
  tell_min?: true;
  /** Where it runs: inside the `worker`, in the commit that queues it (`done` at once), or on a
   * signed-in `phone` (claim → result). */
  side: 'worker' | 'phone';
  /** A phone verb that the app `app` applies when it next opens (GET /v1/verbs/pending?app=);
   * home's own loop never takes it, so it is accepted while the app is closed. */
  intent?: true;
  /** Whether an agent may queue it with PUT /v1/verbs/:id. `false` = owner taps only (a chip), or
   * only ever another verb's inverse. */
  queueable: boolean;
  /** `stored`: the Worker keeps the inverse (`{op, args}`) on the ledger row; `reported`: the phone
   * returns its inverse verb as `undo`; `none`: nothing to undo. */
  undo: 'stored' | 'reported' | 'none';
  /** Schema versions, newest last. A device runs the newest version it knows. */
  versions: Record<number, VerbVersion>;
  /** One line for the briefing's verb table (≤ 60 characters). */
  what: string;
  doc: string;
}

export const SONG_ID = /^r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
export const SONG_REF = /^music:r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
export const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const song = z.string().check(z.regex(SONG_REF));
export const songs = (max: number) => z.array(song).check(z.minLength(1), z.maxLength(max));
/** The owner's own messages a verb rests on (`msg:<id>`); the Worker checks that they are. */
export const ownerWords = z
  .array(z.string().check(z.regex(/^msg:[A-Za-z0-9_-]{1,64}$/)))
  .check(z.minLength(1), z.maxLength(5));
