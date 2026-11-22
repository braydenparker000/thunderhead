// The voice page's routes (voice.ts), kept beside routes.ts, which spreads them into ROUTES: no
// import here, so the registry stays importable on its own.
export const VOICE_ROUTES = {
  'GET /v1/mind/voice': { who: ['D', 'C', 'N', 'R'], phase: 'P9', note: 'how the mind talks: the page, who changed it last, when and why, and the newest 20 versions without their text' },
  'GET /v1/mind/voice/:id': { who: ['D', 'C', 'N', 'R'], phase: 'P9', note: 'one version of the voice page, with its text' },
  'PUT /v1/mind/voice': { who: ['D', 'C'], phase: 'P9', note: '{text ≤ 4,000, why?}: a new version; mind:chat from a claimed, live session that read no outside text, with a why of 8 to 200 characters (a ledger row with undo and a line in the chat)' },
  'POST /v1/mind/voice/restore': { who: ['D'], phase: 'P9', note: '{id}: that version becomes the page again, as a new version' },
} as const;
