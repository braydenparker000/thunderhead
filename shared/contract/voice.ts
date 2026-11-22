// The voice page (owner, 2026-11-22): one page of plain text that says how the mind talks, kept in
// the site as versions (Core step 52, backend/src/areas/voice). The owner edits it in Settings › The
// mind; the mind may edit it too, with a why, and says so in the chat with an undo. The newest
// version is the page; with none yet it is VOICE_DEFAULT. The briefing carries it whole.
import type { Id, Ms } from './api.ts';

export const VOICE_LIMITS = {
  /** The page, in characters. */
  text: 4_000,
  /** The why the mind's edit gives, in characters. */
  why_min: 8,
  why_max: 200,
  /** Versions GET /v1/mind/voice lists, newest first. */
  history: 20,
} as const;

/** The page while no version is stored; the owner changes its words in Settings. */
export const VOICE_DEFAULT = `Talk like a sharp friend who knows me well: warm, natural, plain words. Humour is welcome when it fits. An emoji now and then is fine; never a row of them.

Be quick by default: answer first, in a few lines. Go deep when the question needs it, or when I say "think": then take the time, show the steps that matter and say what you checked.

Say how sure you are in plain words ("I'm fairly sure", "I don't know"). Use a number only when the doubt is real and it helps me decide.

Don't repeat my question back. Don't end with a row of offers or "let me know if". One good next step is enough, and only when it helps.

When you did something, say what in one line. When you don't know, say so and say how you'd find out. Talk in sentences; a list only for steps or real options.

Disagree when you think I'm wrong: once, with the reason, then let it go. Never flatter.

Call yourself "I" and me "you". Write for my phone: short paragraphs. Answer in the language I write in.

Bring things up yourself when they are worth my time: what I said I would do, what you notice, things I would enjoy. If I pass over one, mention it once more at most, then drop it.

Where I'm learning: Spanish, guitar, study
Here, coach me: ask before you tell, point out one mistake at a time, and let me try again. Everywhere else, do what I ask or give me the answer.`;

/** Who wrote a version: the owner in Settings, the mind with a why, or the first page put by hand. */
export type VoiceBy = 'owner' | 'mind' | 'seed';

/** A version without its text (the history list). */
export interface VoiceVersionInfo {
  id: Id;
  at: Ms;
  by: VoiceBy;
  why: string | null;
  chars: number;
}

export interface VoiceVersion extends VoiceVersionInfo {
  text: string;
}

/** GET /v1/mind/voice: the page now, who changed it last (null while it is the default), and the
 * newest versions without their text. */
export interface VoiceResponse {
  text: string;
  last: VoiceVersionInfo | null;
  versions: VoiceVersionInfo[];
}

/** PUT /v1/mind/voice: the whole new page. `why` is required from the mind (8 to 200 characters). */
export interface PutVoiceRequest {
  text: string;
  why?: string;
}

/** POST /v1/mind/voice/restore: that version becomes the page again, as a new version. */
export interface RestoreVoiceRequest {
  id: Id;
}

// C0 and C1 controls except the newline, bidirectional overrides and line or paragraph separators.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

/** Why a page is refused, in words that say the limit, or null. */
export function voiceTextProblem(text: string): string | null {
  if (!text.trim()) return 'the page is empty (1 to 4,000 characters)';
  if (text.length > VOICE_LIMITS.text) return `the page has ${text.length} characters (at most 4,000)`;
  if (CONTROL.test(text)) return 'no control characters except newlines';
  return null;
}

/** Why a why is refused, or null. */
export function voiceWhyProblem(why: string | undefined): string | null {
  const n = why?.trim().length ?? 0;
  if (n < VOICE_LIMITS.why_min || n > VOICE_LIMITS.why_max)
    return `the why has ${n} characters (${VOICE_LIMITS.why_min} to ${VOICE_LIMITS.why_max})`;
  return null;
}
