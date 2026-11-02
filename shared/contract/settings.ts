// The owner's settings as data (MENU-AND-SETTINGS.md §6): one entry for each thing the owner can
// change on a catalogue page of Settings, with the page it sits on, its words, its control, its
// default, where it is kept and whether the mind's briefing lists it.
//   scope 'worker'  Core's settings table, through GET/PATCH /v1/settings (PATCH takes exactly these
//                   keys and P1's own, each checked by its kind; anything else is 422).
//   scope 'phone'   this phone's localStorage, `th.s.<key>`, gone back to the default by removing it.
//   mind: true      listed in the briefing's section 13, "Your settings", as `key: value` lines.
// The phone renders its pages from a generated copy (frontend/apps/settings/catalog-data.js, written
// by scripts/contract.mjs), and tests/settings-browser.test.mjs checks that every row on those pages
// is one of these and that every worker key is taken by PATCH. Add a setting here first.

export type SettingKind = 'switch' | 'choice' | 'range' | 'order' | 'text';
export type SettingScope = 'worker' | 'phone';
/** switch: boolean; choice: one option's string; range: one option's number; order: some option
 * values, each once, in the owner's order; text: a string. */
export type SettingValue = boolean | number | string | readonly string[];

export interface SettingOption {
  readonly value: string | number;
  readonly label: string;
  /** order: the line under that item's row. */
  readonly detail?: string;
}

export interface SettingSpec {
  readonly key: string;
  readonly group: SettingGroup;
  /** A heading inside the page, for a page with more than one part. */
  readonly section?: string;
  readonly label: string;
  /** The one line under the row. */
  readonly detail: string;
  readonly kind: SettingKind;
  /** choice and range: the values allowed; order: the items to arrange. */
  readonly options?: readonly SettingOption[];
  readonly default: SettingValue;
  readonly scope: SettingScope;
  readonly mind: boolean;
  /** range: the unit after each number (`ms`, `px`, `min`, `days`). */
  readonly unit?: string;
  /** phone: the data attribute on <html> that carries the value while it is not the default, so
   * CSS can follow it (`data-glass="flat"`). */
  readonly attr?: string;
  /** text: the longest value, and a pattern (a RegExp source) it must match. */
  readonly max?: number;
  readonly pattern?: string;
}

/** The catalogue's pages, in the order Settings lists them: the page title, its icon (ui/icons.txt),
 * the line under its header, and a note under one of its parts. */
export const SETTING_GROUPS = {
  appearance: {
    title: 'Appearance',
    icon: 'palette',
    lead: 'Theme, text size and a still background are at the top of Settings. These are kept on this phone.',
  },
  chat: { title: 'Home and chat', icon: 'chat-circle', lead: 'How the conversation on home looks and listens. Kept on this phone.' },
  gestures: { title: 'Ring and gestures', icon: 'hand-pointing', lead: 'How holds and swipes feel. Kept on this phone.' },
  island: { title: 'Island', icon: 'music-notes-simple', lead: 'The capsule at the top while Music or Podcasts plays. Kept on this phone.' },
  briefing: { title: 'Briefing', icon: 'newspaper', lead: 'Swipe right on home for the Briefing. These follow you to every phone.' },
  mind: {
    title: 'The mind',
    icon: 'sparkle',
    lead: 'How I talk, work at night and reach you. I read these every time I wake.',
    notes: { 'Standing permissions': 'The mind reads these; enforcement comes with the next release.' },
  },
  privacy: { title: 'Privacy and data', icon: 'shield-check', lead: 'What this phone tells your Worker, and what leaves it at all.' },
} as const satisfies Record<string, { title: string; icon: string; lead: string; notes?: Record<string, string> }>;
export type SettingGroup = keyof typeof SETTING_GROUPS;

const PERMIT = [
  { value: 'ask', label: 'Ask' },
  { value: 'tell', label: 'Do and tell' },
  { value: 'quiet', label: 'Do quietly' },
] as const;
const ON_PHONE = { scope: 'phone', mind: false } as const;
const IN_WORKER = { scope: 'worker', mind: false } as const;
const FOR_MIND = { scope: 'worker', mind: true } as const;
const PERMITS = { group: 'mind', section: 'Standing permissions', kind: 'choice', options: PERMIT, ...FOR_MIND } as const;
const SENSES = { group: 'privacy', section: 'Senses', kind: 'switch', default: true, ...IN_WORKER } as const;

/** Every catalogued setting, in page order. */
export const SETTINGS = [
  // --- Appearance (phone; each sets a data attribute on <html> for CSS to follow) -------------------
  {
    key: 'appearance.accent', group: 'appearance', label: 'Accent intensity', kind: 'choice',
    detail: 'How strongly the blue shows on buttons, switches and links.',
    options: [{ value: 'calm', label: 'Calm' }, { value: 'vivid', label: 'Vivid' }],
    default: 'calm', attr: 'data-accent-intensity', ...ON_PHONE,
  },
  {
    key: 'appearance.glass', group: 'appearance', label: 'Glass', kind: 'choice',
    detail: 'Frosted blurs what is behind a panel; flat is plainer and easier on the battery.',
    options: [{ value: 'frosted', label: 'Frosted' }, { value: 'flat', label: 'Flat' }],
    default: 'frosted', attr: 'data-glass', ...ON_PHONE,
  },
  {
    key: 'appearance.corners', group: 'appearance', label: 'Corners', kind: 'choice',
    detail: 'How round cards, bubbles and buttons are.',
    options: [{ value: 'soft', label: 'Soft' }, { value: 'sharper', label: 'Sharper' }],
    default: 'soft', attr: 'data-corners', ...ON_PHONE,
  },
  {
    key: 'appearance.ring', group: 'appearance', label: 'Ring size', kind: 'choice',
    detail: 'How big the ring of apps is when you hold an empty spot on home.',
    options: [{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }, { value: 'large', label: 'Large' }],
    default: 'regular', attr: 'data-ring-size', ...ON_PHONE,
  },
  {
    key: 'appearance.haptics', group: 'appearance', label: 'Haptics', kind: 'choice',
    detail: 'How much the phone taps back on holds, swipes and switches.',
    options: [{ value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'full', label: 'Full' }],
    default: 'light', attr: 'data-haptics', ...ON_PHONE,
  },
  {
    key: 'appearance.motion', group: 'appearance', label: 'Reduced motion', kind: 'choice',
    detail: 'Always on keeps things still even when the phone allows motion.',
    options: [{ value: 'system', label: 'Follow system' }, { value: 'always', label: 'Always on' }],
    default: 'system', attr: 'data-reduced-motion', ...ON_PHONE,
  },
  // --- Home and chat (phone) ---------------------------------------------------------------------
  {
    key: 'chat.time_markers', group: 'chat', label: 'Time markers', kind: 'switch',
    detail: 'A small time over a turn when a while has passed since the last one.', default: true, ...ON_PHONE,
  },
  {
    key: 'chat.fold', group: 'chat', label: 'Fold long replies', kind: 'switch',
    detail: 'A long answer shows its start; a tap opens the rest.', default: true, ...ON_PHONE,
  },
  {
    key: 'chat.reveal', group: 'chat', label: 'Reply reveal', kind: 'choice',
    detail: 'Words fade up as a reply arrives, or the whole reply appears at once.',
    options: [{ value: 'words', label: 'Words' }, { value: 'instant', label: 'Instant' }], default: 'words', ...ON_PHONE,
  },
  {
    key: 'chat.followups', group: 'chat', label: 'Follow-up suggestions', kind: 'choice',
    detail: 'Two things you might ask next under a reply, or none.',
    options: [{ value: 'two', label: 'Two' }, { value: 'none', label: 'None' }], default: 'two', ...ON_PHONE,
  },
  {
    key: 'chat.enter_sends', group: 'chat', label: 'Send on Enter', kind: 'switch',
    detail: 'Off: Enter starts a new line and only the send button sends.', default: true, ...ON_PHONE,
  },
  {
    key: 'chat.dictation', group: 'chat', label: 'Dictation language', kind: 'choice',
    detail: 'The language the mic listens for. Auto works it out from what you say.',
    options: [{ value: 'auto', label: 'Auto' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }],
    default: 'auto', ...ON_PHONE,
  },
  // --- Ring and gestures (phone) -----------------------------------------------------------------
  {
    key: 'gestures.hold_ms', group: 'gestures', label: 'Hold time', kind: 'range', unit: 'ms',
    detail: 'How long you hold an empty spot on home before the ring opens.',
    options: [{ value: 160, label: '160 ms' }, { value: 220, label: '220 ms' }, { value: 300, label: '300 ms' }],
    default: 220, ...ON_PHONE,
  },
  {
    key: 'gestures.swipe_px', group: 'gestures', label: 'Swipe start', kind: 'range', unit: 'px',
    detail: 'How far a finger moves before a drag counts as a swipe.',
    options: [{ value: 6, label: '6 px' }, { value: 10, label: '10 px' }], default: 6, ...ON_PHONE,
  },
  {
    key: 'gestures.edge_guard', group: 'gestures', label: 'Edge back guard', kind: 'switch',
    detail: "A swipe that starts at the screen's edge is left to the phone's own back gesture.",
    default: true, ...ON_PHONE,
  },
  // --- Island (phone) ----------------------------------------------------------------------------
  {
    key: 'island.art', group: 'island', label: 'Album art', kind: 'switch',
    detail: "The song's or the show's art in the capsule.", default: true, ...ON_PHONE,
  },
  {
    key: 'island.titles', group: 'island', label: 'Long titles', kind: 'choice',
    detail: 'A title too long for the capsule scrolls by once, or fades at its edge.',
    options: [{ value: 'scroll', label: 'Scroll once' }, { value: 'fade', label: 'Fade' }], default: 'scroll', ...ON_PHONE,
  },
  {
    key: 'island.controls', group: 'island', label: 'Expanded controls', kind: 'choice',
    detail: 'The three buttons when the capsule opens up.',
    options: [{ value: 'prev-play-next', label: 'Back, play, next' }, { value: 'play-next-sleep', label: 'Play, next, sleep' }],
    default: 'prev-play-next', ...ON_PHONE,
  },
  {
    key: 'island.alerts', group: 'island', label: 'Alerts in the capsule', kind: 'switch',
    detail: 'Reminders and timers show in the capsule while something plays.', default: true, ...ON_PHONE,
  },
  {
    key: 'island.sleep_min', group: 'island', label: 'Sleep timer', kind: 'range', unit: 'min',
    detail: 'Where the sleep timer starts when you set it.',
    options: [{ value: 15, label: '15 min' }, { value: 30, label: '30 min' }, { value: 45, label: '45 min' }],
    default: 30, ...ON_PHONE,
  },
  // --- Briefing (worker) -------------------------------------------------------------------------
  {
    key: 'briefing.tiles', group: 'briefing', label: 'Tiles, in order', kind: 'order',
    detail: 'Which tiles the Briefing shows, top first. Hidden ones wait below.',
    options: [
      { value: 'weather', label: 'Weather', detail: 'Now, the next hours and tomorrow.' },
      { value: 'due', label: 'Due', detail: 'Reminders and dates coming up.' },
      { value: 'holidays', label: 'Holidays', detail: 'Public holidays coming up.' },
      { value: 'study', label: 'Study', detail: 'Where you are in what you are reading.' },
      { value: 'built', label: 'Built', detail: 'What the night shift made or fixed.' },
      { value: 'podcasts', label: 'Podcasts', detail: 'New episodes from shows you follow.' },
      { value: 'notes', label: 'Notes', detail: 'Short notes the night shift left you.' },
      { value: 'report', label: 'Report', detail: 'How the apps ran yesterday.' },
    ],
    default: ['weather', 'due', 'holidays', 'study', 'built', 'podcasts', 'notes', 'report'], ...FOR_MIND,
  },
  {
    key: 'briefing.units', group: 'briefing', section: 'Tile details', label: 'Units', kind: 'choice',
    detail: 'Temperatures on the weather tile.',
    options: [{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }], default: 'c', ...IN_WORKER,
  },
  {
    key: 'briefing.due_days', group: 'briefing', section: 'Tile details', label: 'Due, days ahead', kind: 'range', unit: 'days',
    detail: 'How far ahead the Due tile looks.',
    options: [{ value: 1, label: '1 day' }, { value: 3, label: '3 days' }, { value: 7, label: '7 days' }],
    default: 3, ...IN_WORKER,
  },
  {
    // The countries the Holidays tile has lists for (BRIEFING.md §2); auto: the weather place's.
    key: 'briefing.holidays', group: 'briefing', section: 'Tile details', label: 'Holiday country', kind: 'choice',
    detail: "Auto uses the country of your weather place.",
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'AU', label: 'Australia' },
      { value: 'CA', label: 'Canada' },
      { value: 'FR', label: 'France' },
      { value: 'DE', label: 'Germany' },
      { value: 'MX', label: 'Mexico' },
      { value: 'ES', label: 'Spain' },
      { value: 'GB', label: 'United Kingdom' },
      { value: 'US', label: 'United States' },
    ],
    default: 'auto', ...IN_WORKER,
  },
  // --- The mind (worker, all in the briefing) ----------------------------------------------------
  {
    key: 'mind.voice', group: 'mind', section: 'How I talk', label: 'Voice', kind: 'choice',
    detail: 'Plain, a little warmer, or drier.',
    options: [{ value: 'plain', label: 'Plain' }, { value: 'warmer', label: 'Warmer' }, { value: 'drier', label: 'Drier' }],
    default: 'plain', ...FOR_MIND,
  },
  {
    key: 'mind.verbosity', group: 'mind', section: 'How I talk', label: 'Length', kind: 'choice',
    detail: 'How much I say when you have not asked for more or less.',
    options: [{ value: 'short', label: 'Short' }, { value: 'normal', label: 'Normal' }, { value: 'full', label: 'Full' }],
    default: 'normal', ...FOR_MIND,
  },
  {
    key: 'mind.night_scope', group: 'mind', section: 'Nights', label: 'Night scope', kind: 'choice',
    detail: 'Only the bookkeeping, also arranging tomorrow, or all of the night shift.',
    options: [{ value: 'bookkeeping', label: 'Bookkeeping' }, { value: 'arrange', label: 'Arrange' }, { value: 'full', label: 'Full' }],
    default: 'full', ...FOR_MIND,
  },
  {
    key: 'mind.night_budget', group: 'mind', section: 'Nights', label: 'Night budget', kind: 'range', unit: 'min',
    detail: 'How long the night shift may run.',
    options: [{ value: 5, label: '5 min' }, { value: 15, label: '15 min' }, { value: 30, label: '30 min' }],
    default: 30, ...FOR_MIND,
  },
  {
    key: 'mind.idle', group: 'mind', section: 'Reaching you', label: 'Awake in a quiet chat', kind: 'range', unit: 'min',
    detail: 'How long I stay awake after the last message before I sleep.',
    options: [{ value: 10, label: '10 min' }, { value: 30, label: '30 min' }, { value: 120, label: '120 min' }],
    default: 120, ...FOR_MIND,
  },
  {
    key: 'mind.pushes', group: 'mind', section: 'Reaching you', label: 'Notifications', kind: 'choice',
    detail: 'When I may send one. Normal keeps the budget of 2 a day and quiet hours.',
    options: [{ value: 'never', label: 'Never' }, { value: 'urgent', label: 'Urgent only' }, { value: 'normal', label: 'Normal' }],
    default: 'normal', ...FOR_MIND,
  },
  {
    key: 'mind.ask_outside', group: 'mind', section: 'Reaching you', label: 'Ask before outside sources', kind: 'switch',
    detail: 'I ask before I read the web or other outside text for you.', default: true, ...FOR_MIND,
  },
  { key: 'mind.permit.music', label: 'Music', detail: 'Playlists, the queue and what plays.', default: 'quiet', ...PERMITS },
  { key: 'mind.permit.podcasts', label: 'Podcasts', detail: 'Following shows and queueing episodes.', default: 'quiet', ...PERMITS },
  { key: 'mind.permit.reminders', label: 'Reminders', detail: 'Setting, moving and cancelling reminders.', default: 'tell', ...PERMITS },
  { key: 'mind.permit.settings', label: 'Settings', detail: 'Changing one of these settings.', default: 'tell', ...PERMITS },
  { key: 'mind.permit.muse', label: 'Muse orders', detail: 'Asking Muse to make something.', default: 'ask', ...PERMITS },
  { key: 'mind.permit.watch', label: 'Watch lists', detail: 'Adding to and tidying your watch lists.', default: 'tell', ...PERMITS },
  { key: 'mind.permit.practice', label: 'Practice', detail: 'Guitar and study practice plans.', default: 'tell', ...PERMITS },
  { key: 'mind.permit.tiles', label: 'Lines and tiles', detail: 'Lines on home and tiles on the Briefing.', default: 'quiet', ...PERMITS },
  { key: 'mind.permit.titles', label: 'Titles', detail: 'Naming conversations.', default: 'quiet', ...PERMITS },
  {
    key: 'mind.permit.outside', label: 'Remembering from outside text',
    detail: 'Keeping a fact learned from something outside our conversations.', default: 'ask', ...PERMITS,
  },
  // --- Privacy and data (worker) -----------------------------------------------------------------
  { key: 'privacy.senses.music', label: 'Music', detail: 'When Music opens and what you rate, as names and times.', ...SENSES },
  { key: 'privacy.senses.podcasts', label: 'Podcasts', detail: 'When Podcasts opens, as a time.', ...SENSES },
  { key: 'privacy.senses.guitar', label: 'Guitar', detail: 'When Guitar opens and your practice, as numbers.', ...SENSES },
  { key: 'privacy.senses.study', label: 'Study', detail: 'When Study opens, as a time.', ...SENSES },
  { key: 'privacy.senses.home', label: 'Home', detail: 'Which Briefing tiles you tap, as names and times.', ...SENSES },
  {
    key: 'privacy.errors', group: 'privacy', section: 'Reports', label: 'Error reports', kind: 'switch',
    detail: 'When something breaks, what broke and where, never what you wrote.', default: true, ...IN_WORKER,
  },
] as const satisfies readonly SettingSpec[];

export type SettingKey = (typeof SETTINGS)[number]['key'];
/** The keys PATCH /v1/settings takes from the catalogue. */
export type WorkerSettingKey = Extract<(typeof SETTINGS)[number], { scope: 'worker' }>['key'];

/** The entry for `key`, or undefined for a key the catalogue doesn't have. */
export function settingSpec(key: string): SettingSpec | undefined {
  return (SETTINGS as readonly SettingSpec[]).find((s) => s.key === key);
}

/** Whether `value` is one `spec` allows: the Worker's PATCH and the phone's reads both hold to it. */
export function validSetting(spec: SettingSpec, value: unknown): value is SettingValue {
  const allowed = (spec.options ?? []).map((o) => o.value);
  switch (spec.kind) {
    case 'switch':
      return typeof value === 'boolean';
    case 'choice':
      return typeof value === 'string' && allowed.includes(value);
    case 'range':
      return typeof value === 'number' && allowed.includes(value);
    case 'order':
      return (
        Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((v) => typeof v === 'string' && allowed.includes(v))
      );
    case 'text':
      return (
        typeof value === 'string' &&
        value.length <= (spec.max ?? 200) &&
        (spec.pattern === undefined || new RegExp(spec.pattern).test(value))
      );
  }
}
