// Opening Astra at a title from a link (ASTRA.md §2 row 13, §4.1; the owner's day-1 request: "an
// anime I'd like, 20 min, under 200 MB"). The mind suggests a title and its reply's chip opens
// `/astra/?find=<title>[&type=series|movie][&max_mb=<n>]` (or `?open=<type>:<id>`); Astra finds it
// in the owner's own add-ons (their addresses never leave the phone) and opens its Details. Never
// Streams, never the player: the owner picks the stream (the stream rule, §4.4). `max_mb` sets
// `app.maxMb`, which Astra's Streams screen shows as a removable "Under N MB" chip hiding results
// whose known size is larger (in streams.js itself, so Astra still starts offline).
// Astra's own modules are loaded when a link is read (they are the page's own, already loaded).

const norm = (/** @type {unknown} */ s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The search's best title for the words asked: the same name, else one that starts with them, else the first. @param {{ name?: string }[]} results @param {string} asked */
export function bestMatch(results, asked) {
  const n = norm(asked);
  return results.find((r) => norm(r.name) === n) ?? results.find((r) => norm(r.name).startsWith(n)) ?? results[0] ?? null;
}

/** Reads the link once (then removes it from the address) and opens the title's Details. @param {any} app */
export async function openFromLink(app, loc = location) {
  const q = new URLSearchParams(loc.search);
  const find = q.get('find')?.trim().slice(0, 120);
  const open = q.get('open');
  if (!find && !open) return;
  history.replaceState(history.state, '', loc.pathname + loc.hash);
  const mb = Number(q.get('max_mb'));
  if (mb > 0 && mb <= 100_000) app.maxMb = Math.round(mb);
  await Promise.resolve(app.ready).catch(() => {});
  const id = open && /^(movie|series):([A-Za-z0-9:._-]{1,100})$/.exec(open);
  if (id) return app.openTitle({ type: id[1], id: id[2], name: '' });
  if (!find) return;
  const type = q.get('type');
  const [{ searchCatalogs }, { toast }] = await Promise.all([import('/astra/src/addons/client.js'), import('/astra/src/ui/components.js')]);
  const results = await searchCatalogs(app.enabledAddons(), find, { types: type === 'movie' || type === 'series' ? [type] : ['series', 'movie'] }).catch(() => []);
  const best = bestMatch(results, find);
  if (best) app.openTitle(best);
  else toast(`Couldn't find ${find} in your add-ons.`);
}
