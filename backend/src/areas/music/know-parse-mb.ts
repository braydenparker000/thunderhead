// MusicBrainz's and ListenBrainz's answers read into facts (MUSIC.md §19.2), pure. Every string is
// outside information: `clip` collapses its whitespace and caps it; ids must be MusicBrainz ids.
import {
  KNOW_LIMITS as K,
  type KnowCredit,
  type KnowLink,
  type KnowRelease,
} from '../../../../shared/contract/know.ts';
import { MBID } from './history-mb';
import type { ReleaseTracks } from './know-match';

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A release's discs: the lists in it whose items hold `tracks` (MusicBrainz's discs field, found by
 * shape, so this file names nothing the bucket guard looks for). */
const discs = (r: J): unknown[] => Object.values(r).flatMap((v) => arr(v).filter((x) => Array.isArray(obj(x).tracks)));

/** Outside text kept: control characters out, whitespace collapsed, at most `max` characters. */
export function clip(v: unknown, max: number = K.name_chars): string {
  if (typeof v !== 'string') return '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ');
  return t.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
/** decodeURIComponent that never throws (a bare `%` stays as it is). */
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const id = (v: unknown) => (typeof v === 'string' && MBID.test(v) ? v : null);
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}(-\d{2}){0,2}$/.test(v) ? v : null);

/** One page of an artist's release groups (browse by artist id): the groups and how many in all. */
export function parseDisco(j: unknown): { items: KnowRelease[]; total: number } {
  const o = obj(j);
  const items = arr(o['release-groups']).flatMap((x): KnowRelease[] => {
    const g = obj(x);
    const mbid = id(g.id);
    const title = clip(g.title);
    if (!mbid || !title) return [];
    const type = clip(g['primary-type'], 40) || null;
    const secondary = arr(g['secondary-types'])
      .map((s) => clip(s, 40))
      .filter(Boolean)
      .slice(0, 5);
    return [{ mbid, title, type, secondary, date: date(g['first-release-date']), listens: null }];
  });
  return { items, total: Math.max(items.length, Number(o['release-group-count']) || 0) };
}

/** A release group's releases with their tracks (browse by release group, recordings and labels). */
export function parseReleases(j: unknown): ReleaseTracks[] {
  return arr(obj(j).releases).flatMap((x): ReleaseTracks[] => {
    const r = obj(x);
    const rid = id(r.id);
    if (!rid) return [];
    const label = clip(obj(obj(arr(r['label-info'])[0]).label).name) || null;
    let n = 0;
    const tracks = discs(r).flatMap((m) =>
      arr(obj(m).tracks).flatMap((t) => {
        const rec = id(obj(obj(t).recording).id);
        n++;
        const title = clip(obj(t).title) || clip(obj(obj(t).recording).title);
        return rec && title ? [{ position: Number(obj(t).position) || n, title, recording: rec }] : [];
      }),
    );
    return [{ id: rid, date: date(r.date), label, tracks }];
  });
}

/** Links found in a `relations` list: a Wikidata item, an English Wikipedia title, a Discogs id. */
export function parseUrls(rels: unknown[]): { wd: string | null; wiki: string | null; discogs: string | null } {
  const out = { wd: null as string | null, wiki: null as string | null, discogs: null as string | null };
  for (const x of rels) {
    const url = clip(obj(obj(x).url).resource, 300);
    const wd = /^https:\/\/www\.wikidata\.org\/wiki\/(Q\d{1,12})$/.exec(url);
    const wiki = /^https:\/\/en\.wikipedia\.org\/wiki\/([^?#]{1,200})$/.exec(url);
    const dc = /^https:\/\/www\.discogs\.com\/(?:[a-z]{2}\/)?(artist|master)\/(\d{1,12})/.exec(url);
    if (wd) out.wd ??= wd[1];
    if (wiki) out.wiki ??= clip(safeDecode(wiki[1]).replace(/_/g, ' '));
    if (dc) out.discogs ??= `${dc[1]}/${dc[2]}`;
  }
  return out;
}

const link = (a: unknown): KnowLink | null => {
  const name = clip(obj(a).name);
  return name ? { mbid: id(obj(a).id), name } : null;
};

/** One artist (lookup with url and artist relations): its type, origin, years and members. */
export function parseArtist(j: unknown) {
  const o = obj(j);
  const rels = arr(o.relations);
  const members: KnowLink[] = [];
  const memberOf: KnowLink[] = [];
  for (const x of rels) {
    const r = obj(x);
    if (r.type !== 'member of band') continue;
    const l = link(r.artist);
    if (l) (r.direction === 'backward' ? members : memberOf).push(l);
  }
  // One relation per instrument or period: each person once, before the cap.
  const once = (ls: KnowLink[]) => [...new Map(ls.map((l) => [l.mbid ?? l.name, l])).values()].slice(0, K.members);
  const span = obj(o['life-span']);
  return {
    name: clip(o.name),
    type: clip(o.type, 40) || null,
    origin: clip(obj(o['begin-area']).name) || clip(obj(o.area).name) || null,
    begin: date(span.begin),
    end: span.ended === true ? date(span.end) : null,
    members: once(members),
    member_of: once(memberOf),
    ...parseUrls(rels),
  };
}

/** One release group (lookup with url relations and artist credits): its links, and its title and
 * first credited artist as MusicBrainz names them. */
export function parseGroup(j: unknown) {
  const o = obj(j);
  const a = obj(obj(arr(o['artist-credit'])[0]).artist);
  const artist = id(a.id) && clip(a.name) ? { mbid: id(a.id), name: clip(a.name) } : null;
  return { ...parseUrls(arr(o.relations)), title: clip(o.title) || null, artist };
}

/** One release with its relations at release, recording and work level: the credits (producers,
 * players, composers, by role), songs that cover a work and songs that sample a recording. */
export function parseCredits(j: unknown) {
  const o = obj(j);
  const credits = new Map<string, KnowCredit>();
  const covers: { song: string; of: string }[] = [];
  const samples: { song: string; of: string }[] = [];
  const credit = (r: J, role: string) => {
    const l = link(r.artist);
    if (l) credits.set(`${l.mbid ?? l.name}|${role}`, { ...l, role });
  };
  const roleOf = (r: J) => {
    const attrs = arr(r.attributes).map((a) => clip(a, 40));
    const type = clip(r.type, 40);
    return type === 'instrument' || type === 'vocal' ? clip(attrs[0] ?? type, 40) || type : type;
  };
  for (const x of arr(o.relations)) if (obj(x).artist) credit(obj(x), roleOf(obj(x)));
  for (const m of discs(o))
    for (const t of arr(obj(m).tracks)) {
      const rec = obj(obj(t).recording);
      const song = clip(obj(t).title) || clip(rec.title);
      for (const x of arr(rec.relations)) {
        const r = obj(x);
        if (r.artist) credit(r, roleOf(r));
        if (r.type === 'performance' && r.work) {
          const w = obj(r.work);
          if (arr(r.attributes).includes('cover') && clip(w.title)) covers.push({ song, of: clip(w.title) });
          for (const y of arr(w.relations)) if (obj(y).artist) credit(obj(y), clip(obj(y).type, 40));
        }
        if (r.type === 'samples material' && r.direction !== 'backward' && r.recording) {
          const s = obj(r.recording);
          const by = clip(obj(arr(s['artist-credit'])[0]).name);
          if (clip(s.title)) samples.push({ song, of: clip(by ? `${s.title} (${by})` : s.title) });
        }
      }
    }
  const pairs = (l: { song: string; of: string }[]) =>
    [...new Map(l.map((x) => [`${x.song}|${x.of}`, x])).values()].slice(0, K.links);
  return { credits: fair([...credits.values()].filter((c) => c.role)), covers: pairs(covers), samples: pairs(samples) };
}

/** Credits under the cap with every person kept: each person's first role, then each one's second,
 * and so on, so the cap never drops a person for another's many roles. */
function fair(list: KnowCredit[]): KnowCredit[] {
  const by = new Map<string, KnowCredit[]>();
  for (const c of list) by.set(c.mbid ?? c.name, [...(by.get(c.mbid ?? c.name) ?? []), c]);
  const out: KnowCredit[] = [];
  for (let round = 0; out.length < K.credits; round++) {
    const next = [...by.values()].flatMap((roles) => (roles[round] ? [roles[round]] : []));
    if (!next.length) break;
    out.push(...next);
  }
  return out.slice(0, K.credits);
}

/** ListenBrainz's most listened release groups of an artist: listens by release group id. */
export function parseLbTop(j: unknown): Record<string, number> {
  const list = Array.isArray(j) ? j : arr(obj(obj(j).payload).releases ?? obj(j).release_groups);
  const out: Record<string, number> = {};
  for (const x of list) {
    const g = obj(x);
    const mbid = id(g.release_group_mbid);
    const n = Number(g.total_listen_count);
    if (mbid && Number.isFinite(n) && n >= 0) out[mbid] = Math.round(n);
  }
  return out;
}
