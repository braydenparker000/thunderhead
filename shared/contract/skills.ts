// The mind's skills (RUNTIME.md §5.3 `th skill`, MEMORY.md §9): role knowledge read on demand, one
// short file per app and area the mind acts in, at mind/skills/<name>.md. The briefing's "On demand"
// section names them, so a session reads one before it acts in that app; ROLES.md keeps only what
// every wake needs. A mind test keeps the folder and this list the same, each file within its size
// and with these headings in this order, naming only commands `th help` has. Plain data.

export const SKILLS = [
  'music',
  'podcasts',
  'guitar',
  'study',
  'astra',
  'media',
  'briefing',
  'calendar',
  'memory',
  'verbs',
  'muse',
  'night',
  'code',
] as const;
export type SkillName = (typeof SKILLS)[number];

export const SKILL_LIMITS = {
  /** Characters in one skill file, at most. */
  chars: 2_500,
} as const;

/** Every skill file's headings (`## <heading>`), in this order. */
export const SKILL_HEADINGS = ['What it is', 'What you can read', 'What you can do', 'What you must not do'] as const;
