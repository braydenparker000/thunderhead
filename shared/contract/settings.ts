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

import { hours, o, stops } from './settings-kit.ts';
import { PHONE_SETTINGS } from './settings-phone.ts';

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
  music: {
    title: 'Music',
    icon: 'music-notes-simple',
    lead: 'Your listening history, from the exports you drop here. Your Worker keeps the counts.',
  },
  photos: {
    title: 'Photos',
    icon: 'aperture',
    lead: 'Your Worker keeps the shelf and a small preview of each photo; the originals stay in your Drive.',
  },
  privacy: { title: 'Privacy and data', icon: 'shield-check', lead: 'What this phone tells your Worker, and what leaves it at all.' },
} as const satisfies Record<string, { title: string; icon: string; lead: string; notes?: Record<string, string> }>;
export type SettingGroup = keyof typeof SETTING_GROUPS;

const IN_WORKER = { scope: 'worker', mind: false } as const;
const FOR_MIND = { scope: 'worker', mind: true } as const;
const TILE = { group: 'briefing', section: 'Tile details', ...IN_WORKER } as const;
const MIND = { group: 'mind', ...FOR_MIND } as const;
const PERMIT = { ...MIND, section: 'Standing permissions', kind: 'choice', options: o('ask:Ask', 'tell:Do and tell', 'quiet:Do quietly') } as const;
const SENSES = { group: 'privacy', section: 'Senses', kind: 'switch', default: true, ...IN_WORKER } as const;

/** Every catalogued setting, in page order. */
export const SETTINGS = [
  // On this phone (settings-phone.ts): Appearance, Home and chat, Ring and gestures, Island.
  ...PHONE_SETTINGS,
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
  // The mind: all in its briefing. Its name, the owner's alone (mind-set.ts ownerOnly), phrase-linted
  // by the Worker's PATCH (settings/catalog.ts); the shell says it wherever it would say "the mind".
  { ...MIND, section: 'How I talk', key: 'mind.name', label: 'Name', kind: 'text', default: '', max: 20, pattern: '^[^\\u0000-\\u001f\\u007f]*$',
    detail: 'What you call me, up to 20 characters. Empty: the mind.' },
  { ...MIND, section: 'How I talk', key: 'mind.voice', label: 'Voice', kind: 'choice', default: 'plain',
    options: o('plain:Plain', 'warmer:Warmer', 'drier:Drier'), detail: 'Plain, a little warmer, or drier.' },
  { ...MIND, section: 'How I talk', key: 'mind.verbosity', label: 'Length', kind: 'choice', default: 'normal',
    options: o('short:Short', 'normal:Normal', 'full:Full'), detail: 'How much I say when you have not asked for more or less.' },
  // The owner's day (theme.js's Auto, the briefing's "now", brief-day.ts dayPart): day from the one, evening from the other.
  { ...MIND, section: 'Day and evening', key: 'mind.day_start', label: 'Day starts', kind: 'choice', default: '07:00',
    options: hours(5, 6, 7, 8, 9, 10), detail: 'From this hour Auto shows the day theme, and I count it as your day.' },
  { ...MIND, section: 'Day and evening', key: 'mind.night_start', label: 'Evening starts', kind: 'choice', default: '22:00',
    options: hours(18, 19, 20, 21, 22, 23), detail: 'From this hour Auto shows the night theme, and I count it as your evening.' },
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
  // Off since 2026-11-11 (the owner: having to tell it to look things up was the annoyance): the
  // mind looks up what a look would make right, unasked; on, it asks first.
  { ...MIND, section: 'Reaching you', key: 'mind.ask_outside', label: 'Ask before looking things up', kind: 'switch', default: false,
    detail: 'Off: I look things up on the web whenever that makes the answer right, and say where it came from. On: I ask you first.' },
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
  { key: 'music.history', group: 'music', label: 'Use my listening history', kind: 'switch', default: true, ...FOR_MIND,
    detail: 'Find and my brief weigh songs by how much you played their artist.' },
  { ...SENSES, key: 'privacy.senses.music', label: 'Music', detail: 'When Music opens, what plays, what you skip and what you rate, as ids and times.' },
  { ...SENSES, key: 'privacy.senses.podcasts', label: 'Podcasts', detail: 'When Podcasts opens, what plays, finishes or gets skipped, and the shows you follow, as ids and times.' },
  { ...SENSES, key: 'privacy.senses.guitar', label: 'Guitar', detail: 'When Guitar opens, the pieces you open and your practice, as numbers.' },
  { ...SENSES, key: 'privacy.senses.study', label: 'Study', detail: 'When Study opens, the books you read and for how long, and how many results a search found.' },
  { ...SENSES, key: 'privacy.senses.photos', label: 'Photos', detail: 'When you import, rate or delete a photo, its id and format only, never the picture or its name.' },
  { ...SENSES, key: 'privacy.senses.media', label: 'Astra and My Media', detail: 'When they open, and how long you watch each title, as ids and minutes.' },
  { ...SENSES, key: 'privacy.senses.home', label: 'Home', detail: 'Which of my lines you saw, which tiles and chips you tap and which cards you answer, as ids and times.' },
  { ...SENSES, key: 'privacy.senses.shell', label: 'Ring and island', detail: 'Which apps you open and close and when, and which setting you change, never its value.' },
  { ...SENSES, section: 'Reports', key: 'privacy.errors', label: 'Error reports',
    detail: 'When something breaks, what broke and where, never what you wrote.' },
  // The editor's timings (th/workshop/timings.js): kept on this phone, passed on by home to the owner's storage.
  { key: 'privacy.editor_timings', group: 'privacy', section: 'Reports', label: 'Editor timings', kind: 'switch', scope: 'phone', mind: false, default: true,
    detail: 'How long opening, zooming and exporting a photo took, as numbers only, to your own storage, so a slow step can be found and fixed. Never a photo or its name.' },
  // Photos (PHOTOS.md §3.6): the phone makes each preview at this size; what stays on the phone.
  { key: 'photos.preview_size', group: 'photos', section: 'On this phone', label: 'Preview size', kind: 'choice', ...IN_WORKER,
    default: '2048', options: o('1024:1,024 px', '2048:2,048 px'),
    detail: 'The preview your Worker keeps of each photo, its longest side. Smaller is quicker on a slow line.' },
  { key: 'photos.keep', group: 'photos', section: 'On this phone', label: 'What stays on the phone', kind: 'choice', ...IN_WORKER,
    default: 'previews', options: o('previews:Previews only', 'recent:Recent originals too'),
    detail: 'Previews keep the shelf working offline. Keeping recent originals comes with editing.' },
  // What Photos is (th/registry/apps.js `landing`): the new editor and its own Library, or, with
  // Classic, the shelf and the editor before (kept on hand until its Drive side has moved over).
  { key: 'photos.editor', group: 'photos', section: 'Editor', label: 'Photos opens', kind: 'choice', scope: 'phone', mind: false,
    default: 'new', options: o('new:The new editor', 'classic:Classic'),
    detail: 'The new editor and its Library, with your RAFs kept on this phone. Classic is the shelf and editor before, with your Drive.' },
  // The new editor's own (lab/editor/app/session.js, zoom.js; engine/raw/ROADMAP.md stage 2): what a photo not
  // opened before starts with, and how the full-size view behaves. Each is read when it is used.
  { key: 'photos.new_profile', group: 'photos', section: 'Editor', label: 'New photos open in', kind: 'choice', scope: 'phone', mind: false,
    default: 'shot', options: o('shot:The camera\'s film simulation', 'adobe-color:Adobe Color'),
    detail: 'The look a photo has the first time it opens. Any photo can be changed on its Profile face.' },
  { key: 'photos.new_noise', group: 'photos', section: 'Editor', label: 'Noise reduction by ISO', kind: 'switch', scope: 'phone', mind: false, default: true,
    detail: 'A photo not opened before starts with the noise reduction its ISO calls for. Off: it starts at none.' },
  { key: 'photos.new_auto', group: 'photos', section: 'Editor', label: 'Auto tone on new photos', kind: 'switch', scope: 'phone', mind: false, default: false,
    detail: 'A photo not opened before starts with Auto on its Light controls. Auto on the plate undoes it.' },
  { key: 'photos.double_tap', group: 'photos', section: 'Editor', label: 'Double-tap zooms to', kind: 'choice', scope: 'phone', mind: false,
    default: '100', options: o('100:100 %', '200:200 %'),
    detail: 'How far in a double-tap on the photo goes. 100 % is one sensor pixel to one screen pixel.' },
  { key: 'photos.offline', group: 'photos', section: 'Editor', label: 'Keep the editor for offline use', kind: 'switch', scope: 'phone', mind: false, default: true,
    detail: 'Once the editor has been opened with a signal it works without one. About 13 MB the first time, then only what a release changed.' },
  { key: 'photos.demosaic', group: 'photos', section: 'Editor', label: 'Full-size detail', kind: 'choice', scope: 'phone', mind: false,
    default: 'best', options: o('best:Best', 'faster:Faster'),
    detail: 'Best looks twice at fine detail when you zoom to 100 % or export. Faster looks once: about half the wait, a little less true. It applies from the next photo you open.' },
  { key: 'photos.neural', group: 'photos', section: 'Editor', label: 'Neural detail', kind: 'switch', scope: 'phone', mind: false, default: true,
    detail: 'Exports, and the photo from 200 % in, are made by a neural network: truer fine detail and far less noise at high ISO. An export takes longer. Off: the usual way.' },
  // Export (PHOTOS.md, Export): what the Export sheet starts with; each export can change it.
  { key: 'photos.export_size', group: 'photos', section: 'Export', label: 'Export size', kind: 'choice', ...IN_WORKER,
    default: '2048', options: o('full:Full size', '2048:2,048 px', '1080:1,080 px'),
    detail: 'The long side of an exported photo. Full size takes longest and makes the biggest file.' },
  { key: 'photos.export_format', group: 'photos', section: 'Export', label: 'Export format', kind: 'choice', ...IN_WORKER,
    default: 'jpeg', options: o('jpeg:JPEG', 'heic:HEIC where the phone writes it'),
    detail: 'JPEG carries your edit inside it, so other apps can read it. HEIC is smaller, up to 2,048 px.' },
  // Retention (conversation/retention.ts): once a day, conversations past it are purged as a deleted one is.
  { key: 'privacy.retention', group: 'privacy', section: 'Conversations', label: 'Keep conversations', kind: 'choice', ...IN_WORKER,
    default: 'forever', options: o('forever:Forever', '1y:1 year', '90d:90 days'),
    detail: 'Older ones are deleted for good, once a day. Ones you filed under a topic are kept; delete those yourself.' },
] as const satisfies readonly SettingSpec[];

export type SettingKey = (typeof SETTINGS)[number]['key'];
/** The keys PATCH /v1/settings takes from the catalogue. */
export type WorkerSettingKey = Extract<(typeof SETTINGS)[number], { scope: 'worker' }>['key'];

/** The entry for `key`, or undefined for a key the catalogue doesn't have. */
export function settingSpec(key: string): SettingSpec | undefined {
  return (SETTINGS as readonly SettingSpec[]).find((s) => s.key === key);
}
