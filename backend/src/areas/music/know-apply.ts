// One source's answer merged into a facts row (MUSIC.md §19.2), pure: the row's structured facts,
// its outside text and what a later source needs (`Work`), plus what goes to other tables (credits,
// similar artists, the songs to match). A source asked again replaces what it gave before.
import {
  KNOW_LIMITS as K,
  type KnowCredit,
  type KnowLink,
  type KnowRelease,
} from '../../../../shared/contract/know.ts';
import type { Similar } from './history-mb';
import type { Source, Work } from './know-fetch';
import { fold, type ReleaseTracks } from './know-match';
import type * as mb from './know-parse-mb';
import type * as web from './know-parse-web';

/** A row's facts as stored: the artist's or the album's fields (ArtistFacts and AlbumFacts in
 * shared/contract/know.ts), any of them missing until a source fills it. */
export type Facts = {
  name?: string;
  type?: string | null;
  origin?: string | null;
  begin?: string | null;
  end?: string | null;
  members?: KnowLink[];
  member_of?: KnowLink[];
  influenced_by?: KnowLink[];
  influenced?: KnowLink[];
  awards?: string[];
  discography?: KnowRelease[];
  /** A discography being read, page by page, until its last page replaces `discography`. */
  disco_next?: KnowRelease[];
  title?: string;
  artist?: KnowLink;
  secondary?: string[];
  first_release?: string | null;
  label?: string | null;
  listeners?: number | null;
  playcount?: number | null;
  credits?: KnowCredit[];
  covers?: { song: string; of: string }[];
  samples?: { song: string; of: string }[];
  /** Wikidata items still to be named: an origin and awards (wdl), influences either way (wdi). */
  origin_q?: string | null;
  award_q?: string[];
  by_q?: string[];
  ed_q?: string[];
};
export type Outside = {
  wikipedia?: { title: string; lead: string; reception: string | null } | null;
  tags?: { name: string; weight: number }[];
  styles?: string[];
};

export interface Applied {
  facts: Facts;
  outside: Outside;
  work: Work;
  /** The discography has another page: the source stays first. */
  again?: boolean;
  credits?: KnowCredit[];
  similar?: Similar[];
  releases?: ReleaseTracks[];
}

export function apply(source: Source, kind: string, f0: Facts, o0: Outside, w0: Work, data: unknown): Applied {
  const f: Facts = { ...f0 };
  const o: Outside = { ...o0 };
  const w: Work = { ...w0 };
  const out: Applied = { facts: f, outside: o, work: w };
  switch (source) {
    case 'mb': {
      const a = data as ReturnType<typeof mb.parseArtist>;
      Object.assign(f, {
        type: a.type,
        origin: a.origin,
        begin: a.begin,
        end: a.end,
        members: a.members,
        member_of: a.member_of,
      });
      if (a.name) f.name = a.name;
      w.wd = a.wd ?? w.wd ?? null;
      w.wiki = a.wiki ?? w.wiki ?? null;
      w.discogs = a.discogs ?? w.discogs ?? null;
      break;
    }
    case 'disco': {
      // Pages go into `disco_next`; the discography is replaced only once its last page is read, so
      // nothing is ever matched or picked against half of one (`disco_done`).
      const d = data as ReturnType<typeof mb.parseDisco>;
      const page = w.page ?? 0;
      const before = new Map((f0.discography ?? []).map((r) => [r.mbid, r.listens]));
      const kept = page ? (f0.disco_next ?? []) : [];
      const seen = new Set(kept.map((r) => r.mbid));
      const fresh = d.items
        .filter((r) => !seen.has(r.mbid))
        .map((r) => ({ ...r, listens: before.get(r.mbid) ?? null }));
      const all = [...kept, ...fresh].slice(0, K.disco_max);
      const next = page + K.disco_page;
      // A lighter row reads one page: enough to choose its album.
      out.again = kind !== 'lite' && d.items.length > 0 && next < d.total && next < K.disco_max;
      w.page = out.again ? next : 0;
      if (out.again) f.disco_next = all;
      else {
        f.discography = all;
        delete f.disco_next;
        w.disco_done = true;
        w.disco_at = Date.now();
      }
      break;
    }
    case 'lbtop': {
      const by = data as Record<string, number>;
      f.discography = (f.discography ?? []).map((r) => ({ ...r, listens: by[r.mbid] ?? r.listens }));
      w.lbtop_at = Date.now();
      break;
    }
    case 'fmtop': {
      // Last.fm's playcounts fill a group ListenBrainz said nothing of, by its folded title.
      const by = new Map((data as ReturnType<typeof web.parseFmTopAlbums>).map((a) => [fold(a.name), a.playcount]));
      f.discography = (f.discography ?? []).map((r) => ({ ...r, listens: r.listens ?? by.get(fold(r.title)) ?? null }));
      break;
    }
    case 'wd': {
      const d = data as ReturnType<typeof web.parseWdItem>;
      f.begin ??= d.begin;
      f.end ??= d.end;
      f.origin_q = f.origin ? null : d.origin;
      f.award_q = d.awards;
      f.by_q = d.influenced_by;
      w.wiki ??= d.wiki;
      w.refs = [...(f.origin_q ? [f.origin_q] : []), ...d.awards];
      w.inf = [...d.influenced_by];
      break;
    }
    case 'wds':
      w.wiki ??= (data as ReturnType<typeof web.parseWdItem>).wiki;
      break;
    case 'wdr':
      f.ed_q = (data as string[]).filter((q) => !(f.by_q ?? []).includes(q));
      w.inf = [...new Set([...(w.inf ?? []), ...f.ed_q])];
      break;
    case 'wdl': {
      const l = data as ReturnType<typeof web.parseWdLabels>;
      f.awards = (f.award_q ?? []).flatMap((q) => (l[q] ? [l[q].name] : []));
      if (f.origin_q && l[f.origin_q]) f.origin = l[f.origin_q].name;
      break;
    }
    case 'wdi': {
      const l = data as ReturnType<typeof web.parseWdLabels>;
      const named = (qs: string[] | undefined) =>
        (qs ?? []).flatMap((q) => (l[q] ? [{ mbid: l[q].mbid, name: l[q].name }] : []));
      f.influenced_by = named(f.by_q);
      f.influenced = named(f.ed_q);
      break;
    }
    case 'wp': {
      const p = data as ReturnType<typeof web.parseWiki>;
      o.wikipedia = p && kind !== 'album' ? { ...p, reception: null } : p;
      break;
    }
    case 'fmtags':
      o.tags = data as Outside['tags'];
      break;
    case 'fmalb': {
      const a = data as ReturnType<typeof web.parseFmAlbum>;
      f.listeners = a.listeners;
      f.playcount = a.playcount;
      o.tags = a.tags;
      break;
    }
    case 'lbsim':
    case 'fmsim':
      out.similar = data as Similar[];
      break;
    case 'rels':
      out.releases = data as ReleaseTracks[];
      break;
    case 'credits': {
      const c = data as ReturnType<typeof mb.parseCredits>;
      Object.assign(f, c);
      w.credited = c.credits.length > 0;
      out.credits = c.credits;
      break;
    }
    case 'rg': {
      const u = data as ReturnType<typeof mb.parseGroup>;
      // MusicBrainz's own title and artist replace the files' spelling: what Last.fm may be asked by.
      if (u.title) f.title = u.title;
      if (u.artist) f.artist = u.artist;
      w.named = !!(u.title && u.artist);
      w.wd = u.wd ?? w.wd ?? null;
      w.wiki = u.wiki ?? w.wiki ?? null;
      w.discogs = u.discogs ?? w.discogs ?? null;
      break;
    }
    case 'dcm': {
      const m = data as ReturnType<typeof web.parseDcMaster>;
      o.styles = m.styles;
      w.main = m.main;
      break;
    }
    case 'dcr':
      if (!w.credited) {
        f.credits = data as KnowCredit[];
        out.credits = f.credits;
      }
      break;
  }
  return out;
}
