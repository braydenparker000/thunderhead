// A library entry (an album, an artist, a folder, a playlist...) named so it can be found again
// after a restart: its kind and title, an album's artist, a folder's path, a playlist's id.

/** @param {{kind?: string, title?: string, artist?: string, path?: string, pl?: {id: string}} | null | undefined} g */
export function groupKey(g) {
  if (!g) return null;
  if (g.pl) return 'pl:' + g.pl.id;
  if (g.kind === 'folder' && g.path != null) return 'folder:' + g.path;
  return `${g.kind ?? 'group'}:${g.title ?? ''}\u0001${g.artist ?? ''}`;
}
