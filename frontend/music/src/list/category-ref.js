// The category list a playing list came from (the albums, the playlists...), found again after a
// restart from the name player/session.js saved: the player knows its category again (the swipe to
// the next album, Advance List at an album's end), and the list behind the cover is that album's.
// Only a top-level library list is found again; an artist's own albums list is not (the list then
// plays on without a category, as every list did after a restart before).
import {HomeSource, categorySource, playlistsSource, playlistSource, groupTracksSource} from './sources.js';
import {groupKey} from '../library/group-key.js';

const sameSongs = (a, b) => a.length === b.length && a.every((t, i) => t.id === b[i].id);

/** Where a category list stands in the library, for ListWidget.categoriesOf: null below the top level. */
export function homeOf(list) {
  if (!list || list.secondLevel || list.parentGroup) return null;
  if (list.isPlaylists) return {id: 9, title: 'playlists', icon: '?playlists', kind: 'playlists'};
  return list.homeCat ?? null;
}

export function installCategoryRestore(ctx) {
  /** @param {{home: {id: number, title: string, icon: string, kind: string}, key: string} | null} ref */
  ctx.restoreCategory = ref => {
    const lw = ctx.listWidget, player = ctx.player;
    if (!lw || !player?.track || !ref?.home?.title || !ref.key) return false;
    const parent = ref.home.kind === 'playlists' ? playlistsSource(ctx, lw.libList, lw.nav) : categorySource(ctx, lw.libList, lw.nav, ref.home);
    const index = parent?.groups?.findIndex(g => groupKey(g) === ref.key) ?? -1;
    if (index < 0) return false;
    const category = lw.categoriesOf(parent, index);
    if (sameSongs(category.source.tracksAt(index), player.queue)) player.category = category;
    else {
      // Shuffle All: the list is every category's songs (Player.widenForShuffleAll).
      const parts = [];
      for (let i = 0; i < category.source.count; i++) parts.push(category.source.tracksAt(i) ?? []);
      if (player.shuffle !== 1 || !sameSongs(parts.flat(), player.queue)) return false;
      player.category = {...category, spans: parts.map(p => p.length)};
    }
    const g = parent.groups[index];
    const top = g.pl ? playlistSource(ctx, lw.libList, lw.nav, g.pl) : groupTracksSource(ctx, lw.libList, lw.nav, g, parent.icon);
    if (top) lw.queueStack = [new HomeSource(ctx, lw.libList, lw.nav), parent, top];
    player.post('msg_player_category_changed');
    return true;
  };
}
