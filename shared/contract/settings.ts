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

export { linkProblem, validSetting } from './settings-check.ts';

export type SettingKind = 'switch' | 'choice' | 'range' | 'order' | 'text' | 'links';
export type SettingScope = 'worker' | 'phone';
/** One link of a `links` setting: its address and whether it is the owner's own (`mine`) or someone
 * else's, a shared or an organisation's (its words are then outside text for the mind). */
export interface SettingLink {
  readonly url: string;
  readonly mine: boolean;
}
/** switch: boolean; choice: one option's string; range: one option's number; order: some option
 * values, each once, in the owner's order; text: a string; links: up to `items` links, each address
 * once, each one `linkProblem` passes. */
export type SettingValue = boolean | number | string | readonly string[] | readonly SettingLink[];

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
  /** text: the longest value, and a pattern (a RegExp source) it must match; links: the longest address. */
  readonly max?: number;
  readonly pattern?: string;
  /** links: how many at most. */
  readonly items?: number;
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
    // The floors no setting lowers (permits.ts PERMIT_FLOORS, in its order; a contract test holds them equal).
    notes: { 'Standing permissions': 'Always asks first: money, deleting your data, keys and access, reaching another person.' },
  },
  privacy: { title: 'Privacy and data', icon: 'shield-check', lead: 'What this phone tells your Worker, and what leaves it at all.' },
} as const satisfies Record<string, { title: string; icon: string; lead: string; notes?: Record<string, string> }>;
export type SettingGroup = keyof typeof SETTING_GROUPS;

/** Options from `value:Label` pairs. */
const o = (...pairs: string[]) =>
  pairs.map((p) => ({ value: p.slice(0, p.indexOf(':')), label: p.slice(p.indexOf(':') + 1) }));
/** A range's stops, each labelled with its unit (`160 ms`, `1 day`, `3 days`). */
const stops = (unit: string, ...ns: number[]) =>
  ns.map((n) => ({ value: n, label: `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}` }));
const ON_PHONE = { scope: 'phone', mind: false } as const;
const IN_WORKER = { scope: 'worker', mind: false } as const;
const FOR_MIND = { scope: 'worker', mind: true } as const;
const LOOK = { group: 'appearance', kind: 'choice', ...ON_PHONE } as const;
const CHAT = { group: 'chat', ...ON_PHONE } as const;
const GESTURES = { group: 'gestures', ...ON_PHONE } as const;
const ISLAND = { group: 'island', ...ON_PHONE } as const;
const TILE = { group: 'briefing', section: 'Tile details', ...IN_WORKER } as const;
const MIND = { group: 'mind', ...FOR_MIND } as const;
const PERMIT = { ...MIND, section: 'Standing permissions', kind: 'choice', options: o('ask:Ask', 'tell:Do and tell', 'quiet:Do quietly') } as const;
const SENSES = { group: 'privacy', section: 'Senses', kind: 'switch', default: true, ...IN_WORKER } as const;

/** Every catalogued setting, in page order. */
export const SETTINGS = [
  // Appearance: each puts its `attr` on <html> while it isn't the default, for CSS to follow.
  { ...LOOK, key: 'appearance.accent', label: 'Accent intensity', default: 'calm', attr: 'data-accent-intensity',
    detail: 'How strongly the blue shows on buttons, switches and links.', options: o('soft:Soft', 'calm:Calm', 'vivid:Vivid') },
  { ...LOOK, key: 'appearance.glass', label: 'Glass', default: 'frosted', attr: 'data-glass',
    detail: 'Frosted blurs what is behind a panel; flat is plainer and easier on the battery.', options: o('frosted:Frosted', 'flat:Flat') },
  { ...LOOK, key: 'appearance.corners', label: 'Corners', default: 'soft', attr: 'data-corners',
    detail: 'How round cards, bubbles and buttons are.', options: o('sharper:Sharper', 'soft:Soft', 'round:Rounder') },
  { ...LOOK, key: 'appearance.glyphs', label: 'Ring icons', default: 'filled', attr: 'data-glyphs',
    detail: 'The icons on the ring of apps: solid shapes or outlines.', options: o('filled:Filled', 'outline:Outline') },
  { ...LOOK, key: 'appearance.ring', label: 'Ring size', default: 'regular', attr: 'data-ring-size',
    detail: 'How big the ring of apps is when you hold an empty spot on home.', options: o('compact:Compact', 'regular:Regular', 'large:Large') },
  { ...LOOK, key: 'appearance.haptics', label: 'Haptics', default: 'light', attr: 'data-haptics',
    detail: 'How much the phone taps back on holds, swipes and switches.', options: o('off:Off', 'light:Light', 'full:Full') },
  { ...LOOK, key: 'appearance.motion', label: 'Reduced motion', default: 'system', attr: 'data-reduced-motion',
    detail: 'On keeps things still even when the phone allows motion; off keeps the springs even when it asks for less.',
    options: o('system:Follow system', 'always:On', 'never:Off') },
  // Home and chat.
  { ...CHAT, key: 'chat.density', label: 'Density', kind: 'choice', default: 'comfortable', attr: 'data-chat-density',
    options: o('comfortable:Comfortable', 'compact:Compact'), detail: 'The space between turns in the conversation.' },
  { ...CHAT, key: 'chat.time_markers', label: 'Time markers', kind: 'switch', default: true,
    detail: 'A small time over a turn when a while has passed since the last one.' },
  { ...CHAT, key: 'chat.fold', label: 'Fold long replies', kind: 'switch', default: true,
    detail: 'A long answer shows its start; a tap opens the rest.' },
  { ...CHAT, key: 'chat.reveal', label: 'Reply reveal', kind: 'choice', default: 'words', options: o('words:Words', 'instant:Instant'),
    detail: 'Words fade up as a reply arrives, or the whole reply appears at once.' },
  { ...CHAT, key: 'chat.followups', label: 'Follow-up suggestions', kind: 'choice', default: 'two', options: o('two:Two', 'none:None'),
    detail: 'Two things you might ask next under a reply, or none.' },
  { ...CHAT, key: 'chat.enter_sends', label: 'Send on Enter', kind: 'switch', default: true,
    detail: 'Off: Enter starts a new line and only the send button sends.' },
  { ...CHAT, key: 'chat.mic', label: 'Dictation', kind: 'switch', default: true, attr: 'data-mic',
    detail: 'The mic in the ask bar: tap for a voice memo, hold to dictate. Off hides it.' },
  { ...CHAT, key: 'chat.dictation', label: 'Dictation language', kind: 'choice', default: 'auto', options: o('auto:Auto', 'en:English', 'es:Spanish'),
    detail: 'The language the mic listens for. Auto works it out from what you say.' },
  // Ring and gestures. The ring's seven places: the owner's six apps in their order, then Photos, reserved.
  { ...GESTURES, key: 'gestures.ring_apps', label: 'Apps on the ring', kind: 'order', default: ['music', 'guitar', 'podcasts', 'astra', 'media', 'study'],
    detail: 'Clockwise from the top. The last place stays kept for Photos.',
    options: [
      { value: 'music', label: 'Music', detail: 'Your library and what plays.' },
      { value: 'guitar', label: 'Guitar', detail: 'Pieces and practice.' },
      { value: 'podcasts', label: 'Podcasts', detail: 'Shows you follow.' },
      { value: 'astra', label: 'Astra', detail: 'Films and series.' },
      { value: 'media', label: 'My Media', detail: 'Videos you keep.' },
      { value: 'study', label: 'Study', detail: 'What you are reading.' },
    ] },
  { ...GESTURES, key: 'gestures.hold_ms', label: 'Hold time', kind: 'range', unit: 'ms', default: 220, options: stops('ms', 160, 220, 300),
    detail: 'How long you hold an empty spot on home before the ring opens.' },
  { ...GESTURES, key: 'gestures.swipe_px', label: 'Swipe start', kind: 'range', unit: 'px', default: 6, options: stops('px', 6, 10),
    detail: 'How far a finger moves before a drag counts as a swipe.' },
  { ...GESTURES, key: 'gestures.edge_guard', label: 'Edge back guard', kind: 'switch', default: true,
    detail: "A swipe that starts at the screen's edge is left to the phone's own back gesture." },
  // Island.
  { ...ISLAND, key: 'island.mode', label: 'Behaviour', kind: 'choice', default: 'capsule', attr: 'data-island',
    options: o('capsule:Capsule', 'bar:Bar', 'off:Off'),
    detail: 'Music and Podcasts shrink to a capsule, or to a bar across the top. Off opens them as their own page.' },
  { ...ISLAND, key: 'island.art', label: 'Album art', kind: 'switch', default: true, detail: "The song's or the show's art in the capsule." },
  { ...ISLAND, key: 'island.titles', label: 'Long titles', kind: 'choice', default: 'scroll', options: o('scroll:Scroll once', 'fade:Fade'),
    detail: 'A title too long for the capsule scrolls by once, or fades at its edge.' },
  { ...ISLAND, key: 'island.controls', label: 'Expanded controls', kind: 'choice', default: 'prev-play-next',
    options: o('prev-play-next:Back, play, next', 'play-next-sleep:Play, next, sleep'), detail: 'The three buttons when the capsule opens up.' },
  { ...ISLAND, key: 'island.alerts', label: 'Alerts in the capsule', kind: 'switch', default: true,
    detail: 'Reminders and timers show in the capsule while something plays.' },
  { ...ISLAND, key: 'island.sleep_min', label: 'Sleep timer', kind: 'range', unit: 'min', default: 30, options: stops('min', 15, 30, 45),
    detail: 'Where the sleep timer starts when you set it.' },
  // Briefing.
  {
    key: 'briefing.tiles', group: 'briefing', label: 'Tiles, in order', kind: 'order', ...FOR_MIND,
    detail: 'Which tiles the Briefing shows, top first, under the weather and what waits on you. Hidden ones wait below.',
    options: [
      { value: 'report', label: 'Overnight', detail: 'What the night shift did.' },
      { value: 'today', label: 'Today', detail: 'What is left on your calendars.' },
      { value: 'due', label: 'Due', detail: 'Reminders today and tomorrow.' },
      { value: 'practice', label: 'Practice', detail: 'What to practise next.' },
      { value: 'study', label: 'Study', detail: 'Where you are in what you are reading.' },
      { value: 'built', label: 'Built', detail: 'What the night shift made or fixed.' },
      { value: 'notes', label: 'Notes', detail: 'Short notes the night shift left you.' },
      { value: 'holidays', label: 'Holidays', detail: 'Public holidays coming up.' },
    ],
    default: ['report', 'today', 'due', 'practice', 'study', 'built', 'notes', 'holidays'],
  },
  // The owner's calendars (BRIEFING.md "Today"): ICS links the Worker fetches each morning and when
  // the Briefing opens. Not for the mind: a link is a key to the calendar, so agents see only hosts.
  { key: 'briefing.calendars', group: 'briefing', label: 'Calendars', kind: 'links', ...IN_WORKER, default: [], max: 512, items: 3,
    detail: 'Up to 3 ICS links (https). Mine: your own. Shared: someone else\'s, its titles kept as outside text.' },
  { ...TILE, key: 'briefing.units', label: 'Units', kind: 'choice', default: 'c', options: o('c:°C', 'f:°F'),
    detail: 'Temperatures on the weather tile.' },
  { ...TILE, key: 'briefing.due_days', label: 'Due, days ahead', kind: 'range', unit: 'days', default: 3, options: stops('days', 1, 3, 7),
    detail: 'How far ahead the Due tile looks.' },
  // The countries the Holidays tile has lists for (briefing/holidays.ts); auto: the weather place's.
  { ...TILE, key: 'briefing.holidays', label: 'Holiday country', kind: 'choice', default: 'auto', detail: 'Auto uses the country of your weather place.',
    options: o('auto:Auto', 'AU:Australia', 'CA:Canada', 'FR:France', 'DE:Germany', 'MX:Mexico', 'ES:Spain', 'GB:United Kingdom', 'US:United States') },
  // The mind: all in its briefing.
  { ...MIND, section: 'How I talk', key: 'mind.voice', label: 'Voice', kind: 'choice', default: 'plain',
    options: o('plain:Plain', 'warmer:Warmer', 'drier:Drier'), detail: 'Plain, a little warmer, or drier.' },
  { ...MIND, section: 'How I talk', key: 'mind.verbosity', label: 'Length', kind: 'choice', default: 'normal',
    options: o('short:Short', 'normal:Normal', 'full:Full'), detail: 'How much I say when you have not asked for more or less.' },
  { ...MIND, section: 'Nights', key: 'mind.night_scope', label: 'Night scope', kind: 'choice', default: 'full',
    options: o('bookkeeping:Bookkeeping', 'arrange:Arrange', 'full:Full'), detail: 'Only the bookkeeping, also arranging tomorrow, or all of the night shift.' },
  { ...MIND, section: 'Nights', key: 'mind.night_budget', label: 'Night budget', kind: 'range', unit: 'min', default: 30,
    options: stops('min', 5, 15, 30), detail: 'How long the night shift may run.' },
  { ...MIND, section: 'Reaching you', key: 'mind.idle', label: 'Awake in a quiet chat', kind: 'range', unit: 'min', default: 120,
    options: stops('min', 10, 30, 120), detail: 'How long I stay awake after the last message before I sleep. On a busy day I stay up to twice this, never past 4 hours.' },
  { ...MIND, section: 'Reaching you', key: 'mind.pushes', label: 'Notifications', kind: 'choice', default: 'normal',
    options: o('never:Never', 'urgent:Urgent only', 'normal:Normal'), detail: 'When I may send one. Normal keeps the budget of 2 a day and quiet hours.' },
  // Speech (BEHAVIOR.md §3.7): as needed is no cap at all; the Worker holds the mind to the other two.
  { ...MIND, section: 'Reaching you', key: 'mind.speech', label: 'Speaking up', kind: 'choice', default: 'as_needed',
    options: o('as_needed:As needed', 'quiet:Quiet', 'silent:Silent'),
    detail: 'As needed: when it helps you. Quiet: a line and a card a day at most. Silent: only when you ask; reminders still ring.' },
  // Home lines (HOME.md §2.2): the Worker refuses a line in a slot past this.
  { ...MIND, section: 'Reaching you', key: 'mind.home_lines', label: 'Lines on home', kind: 'range', unit: 'lines', default: 4,
    options: [{ value: 0, label: 'None' }, ...stops('lines', 1, 2, 3, 4)], detail: 'How many of my lines may sit on home at once. None: I only answer in the chat.' },
  { ...MIND, section: 'Reaching you', key: 'mind.ask_outside', label: 'Ask before outside sources', kind: 'switch', default: true,
    detail: 'I ask before I read the web or other outside text for you.' },
  // The day pulse (watches.ts): how many wakes a day the mind may set itself; the Worker refuses the rest.
  { ...MIND, section: 'Waking', key: 'mind.wake_budget', label: 'Wakes I set myself', kind: 'range', unit: 'a day', default: 12,
    options: [{ value: 0, label: 'Off' }, ...stops('a day', 6, 12, 24, 40)], detail: 'A day, to look at something at a time I chose. Your messages never count. Off: none.' },
  { ...PERMIT, key: 'mind.permit.music', label: 'Music', default: 'quiet', detail: 'Playlists, the queue and what plays.' },
  { ...PERMIT, key: 'mind.permit.podcasts', label: 'Podcasts', default: 'quiet', detail: 'Following shows and queueing episodes.' },
  { ...PERMIT, key: 'mind.permit.reminders', label: 'Reminders', default: 'tell', detail: 'Setting, moving and cancelling reminders.' },
  { ...PERMIT, key: 'mind.permit.settings', label: 'Settings', default: 'tell', detail: 'Changing one of these settings.' },
  { ...PERMIT, key: 'mind.permit.muse', label: 'Muse orders', default: 'ask', detail: 'Asking Muse to make something.' },
  { ...PERMIT, key: 'mind.permit.watch', label: 'Watch lists', default: 'tell', detail: 'Adding to and tidying your watch lists.' },
  { ...PERMIT, key: 'mind.permit.practice', label: 'Practice', default: 'tell', detail: 'Guitar and study practice plans.' },
  { ...PERMIT, key: 'mind.permit.tiles', label: 'Lines and tiles', default: 'quiet', detail: 'Lines on home and tiles on the Briefing.' },
  { ...PERMIT, key: 'mind.permit.titles', label: 'Titles', default: 'quiet', detail: 'Naming conversations.' },
  { ...PERMIT, key: 'mind.permit.outside', label: 'Remembering from outside text', default: 'ask',
    detail: 'Keeping a fact learned from something outside our conversations.' },
  // Privacy and data.
  // One switch for each app's senses (senses.ts SENSE_APPS; the phone sends nothing of an app whose
  // switch is off, and the Worker keeps nothing of it). The details say what each sends: ids and times.
  { ...SENSES, key: 'privacy.senses.music', label: 'Music', detail: 'When Music opens, what plays, what you skip and what you rate, as ids and times.' },
  { ...SENSES, key: 'privacy.senses.podcasts', label: 'Podcasts', detail: 'When Podcasts opens, what plays, finishes or gets skipped, and the shows you follow, as ids and times.' },
  { ...SENSES, key: 'privacy.senses.guitar', label: 'Guitar', detail: 'When Guitar opens, the pieces you open and your practice, as numbers.' },
  { ...SENSES, key: 'privacy.senses.study', label: 'Study', detail: 'When Study opens, the books you read and for how long, and how many results a search found.' },
  { ...SENSES, key: 'privacy.senses.media', label: 'Astra and My Media', detail: 'When they open, and how long you watch each title, as ids and minutes.' },
  { ...SENSES, key: 'privacy.senses.home', label: 'Home', detail: 'Which of my lines you saw, which tiles and chips you tap and which cards you answer, as ids and times.' },
  { ...SENSES, key: 'privacy.senses.shell', label: 'Ring and island', detail: 'Which apps you open and close and when, and which setting you change, never its value.' },
  { ...SENSES, section: 'Reports', key: 'privacy.errors', label: 'Error reports',
    detail: 'When something breaks, what broke and where, never what you wrote.' },
] as const satisfies readonly SettingSpec[];

export type SettingKey = (typeof SETTINGS)[number]['key'];
/** The keys PATCH /v1/settings takes from the catalogue. */
export type WorkerSettingKey = Extract<(typeof SETTINGS)[number], { scope: 'worker' }>['key'];

/** The entry for `key`, or undefined for a key the catalogue doesn't have. */
export function settingSpec(key: string): SettingSpec | undefined {
  return (SETTINGS as readonly SettingSpec[]).find((s) => s.key === key);
}
