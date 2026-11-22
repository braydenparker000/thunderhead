// @ts-check
// Settings' listed pages under their headings (owner, 2026-11-21), apart from home.js so the one index
// (finder.js) reads them without the page's own modules, in a test too. Agents is not listed (reachable
// by /settings/agents/); Quiet hours is a section of Notifications.

/** The listed pages under their headings, in order: [heading, [page, name, icon][]]. Look's own
 * controls (theme, text size, still background) come first under Look. */
/** @type {readonly (readonly [string, readonly (readonly [string, string, string])[]])[]} */
export const SECTIONS = ([
  ['Look', [['appearance', 'More appearance', 'palette']]],
  ['Home and gestures', [['chat', 'Home and chat', 'chat-circle'], ['gestures', 'Ring and gestures', 'hand-pointing']]],
  ['Apps', [['music', 'Music', 'music-notes-simple'], ['photos', 'Photos', 'aperture'], ['island', 'Island', 'music-notes-simple'], ['briefing', 'Briefing', 'newspaper']]],
  ['The mind', [['mind', 'The mind', 'sparkle'], ['memory', 'What I remember', 'brain'], ['notifications', 'Notifications', 'bell']]],
  ['Account and data', [['account', 'Password', 'key'], ['devices', 'Devices', 'devices'], ['privacy', 'Privacy and data', 'shield-check'], ['data', 'Data use', 'arrow-down'], ['phone', 'On this phone', 'device-mobile'], ['export', 'Export', 'download-simple'], ['deleted', 'Recently deleted', 'trash'], ['workshop', 'Files for the workshop', 'cloud-arrow-up']]],
  ['About', [['about', 'About and diagnostics', 'info']]],
]);

/** Every listed page, in order: [page, name, icon]. @type {readonly (readonly [string, string, string])[]} */
export const PAGES = SECTIONS.flatMap(([, pages]) => pages);
