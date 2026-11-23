// Wikidata's, Wikipedia's, Last.fm's and Discogs's answers read into facts (MUSIC.md §19.2), pure.
// Wikipedia's text, Last.fm's tags and Discogs's styles are free text from elsewhere: collapsed and
// capped (`clip`), kept under `outside`, never mixed with the owner's data.
import { KNOW_LIMITS as K } from '../../../../shared/contract/know.ts';
import { MBID } from './history-mb';
import { clip } from './know-parse-mb';

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const QID = /^Q\d{1,12}$/;

/** The values of one Wikidata property: item ids, or a time's year. */
const items = (claims: J, p: string) =>
  arr(claims[p]).flatMap((c) => {
    const v = obj(obj(obj(obj(c).mainsnak).datavalue).value);
    return typeof v.id === 'string' && QID.test(v.id) ? [v.id] : [];
  });
const year = (claims: J, p: string) => {
  const t = obj(obj(obj(obj(arr(claims[p])[0]).mainsnak).datavalue).value).time;
  const m = typeof t === 'string' ? /^[+]?(\d{4})-/.exec(t) : null;
  return m ? m[1] : null;
};

/** An artist's Wikidata item: influenced by (P737), awards (P166), origin (P740, else country P495),
 * years active (P2031/P571 to P2032/P576), and its English Wikipedia title. */
export function parseWdItem(j: unknown, q: string) {
  const e = obj(obj(obj(j).entities)[q]);
  const c = obj(e.claims);
  const wiki = clip(obj(obj(e.sitelinks).enwiki).title) || null;
  return {
    influenced_by: items(c, 'P737').slice(0, K.influences),
    awards: [...new Set(items(c, 'P166'))].slice(0, K.awards),
    origin: items(c, 'P740')[0] ?? items(c, 'P495')[0] ?? null,
    begin: year(c, 'P2031') ?? year(c, 'P571'),
    end: year(c, 'P2032') ?? year(c, 'P576'),
    wiki,
  };
}

/** Items whose "influenced by" names this one (a search by statement: ids only). */
export function parseWdSearch(j: unknown): string[] {
  return arr(obj(obj(j).query).search)
    .map((s) => clip(obj(s).title, 20))
    .filter((t) => QID.test(t))
    .slice(0, K.influences);
}

/** Labels (English) of some items, and each one's MusicBrainz artist id (P434) when it has one. */
export function parseWdLabels(j: unknown): Record<string, { name: string; mbid: string | null }> {
  const out: Record<string, { name: string; mbid: string | null }> = {};
  for (const [q, v] of Object.entries(obj(obj(j).entities))) {
    if (!QID.test(q)) continue;
    const name = clip(obj(obj(obj(v).labels).en).value);
    const mb = obj(obj(obj(arr(obj(obj(v).claims).P434)[0]).mainsnak).datavalue).value;
    if (name) out[q] = { name, mbid: typeof mb === 'string' && MBID.test(mb) ? mb : null };
  }
  return out;
}

/** An English Wikipedia article (plain text, wiki-style headings): its lead, and its reception
 * section where it has one, each collapsed and capped. */
export function parseWiki(j: unknown): { title: string; lead: string; reception: string | null } | null {
  const pages = Object.values(obj(obj(obj(j).query).pages));
  const p = obj(pages[0]);
  const text = typeof p.extract === 'string' ? p.extract : '';
  if (!text || 'missing' in p) return null;
  const parts = text.split(/\n(?==+ [^=\n]+ =+\s*\n)/);
  const lead = clip(parts[0], K.wiki_lead);
  const rec = parts.find((s) => /^==+ (critical reception|reception|critical response)\b/i.test(s));
  const body = rec ? rec.replace(/^==+ [^=\n]+ =+\s*\n/, '').split(/\n(?===+ )/)[0] : '';
  return lead ? { title: clip(p.title), lead, reception: clip(body, K.wiki_reception) || null } : null;
}

const tags = (list: unknown[]) =>
  list
    .flatMap((t) => {
      const name = clip(obj(t).name, K.tag_chars).toLowerCase();
      const n = Number(obj(t).count);
      return name ? [{ name, weight: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0 }] : [];
    })
    .slice(0, K.tags);

/** Last.fm's top tags of an artist, weights 0–100. */
export const parseFmTags = (j: unknown) => tags(arr(obj(obj(j).toptags).tag));

/** Last.fm's album: listeners, playcount and its tags. */
export function parseFmAlbum(j: unknown) {
  const a = obj(obj(j).album);
  const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.round(Number(v)) : null);
  return { listeners: num(a.listeners), playcount: num(a.playcount), tags: tags(arr(obj(a.tags).tag)) };
}

/** Last.fm's top albums of an artist: playcount by the album's name (folded later to a group). */
export function parseFmTopAlbums(j: unknown): { name: string; playcount: number }[] {
  return arr(obj(obj(j).topalbums).album).flatMap((x) => {
    const name = clip(obj(x).name);
    const n = Number(obj(x).playcount);
    return name && Number.isFinite(n) ? [{ name, playcount: Math.round(n) }] : [];
  });
}

/** A Discogs master: its styles (and genres), and its main release's id. */
export function parseDcMaster(j: unknown) {
  const o = obj(j);
  const styles = [...arr(o.styles), ...arr(o.genres)].map((s) => clip(s, K.tag_chars)).filter(Boolean);
  const main = Number(o.main_release);
  return { styles: [...new Set(styles)].slice(0, K.tags), main: Number.isInteger(main) && main > 0 ? main : null };
}

/** A Discogs release's credits (its extra artists), as names and roles; no ids. */
export function parseDcRelease(j: unknown) {
  return arr(obj(j).extraartists)
    .flatMap((x) => {
      const name = clip(obj(x).name);
      const role = clip(obj(x).role, 40);
      return name && role ? [{ mbid: null, name, role }] : [];
    })
    .slice(0, K.credits);
}
