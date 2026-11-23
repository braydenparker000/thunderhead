// What the music knowledge's job asks next, and what a refusal costs (MUSIC.md §19.2). A host that
// refuses (429, 5xx, no answer) backs off: after 1, 2 and 4 minutes, or its Retry-After when longer
// (capped), and after the fourth refusal in a row it is left for a day; its sources are skipped
// meanwhile, never blocking another host's work, and a row with nothing else to ask is parked until
// the host may be asked again. A bad answer is the row's alone: each row may fail a source
// `row_tries` times a round, then that source waits for the next round. The restore pass puts back
// the facts rows a restore left out (they are not backed up: they are fetched again).
import { KNOW_LIMITS as K, type KnowSource, type KnowStatus } from '../../../../shared/contract/know.ts';
import type { Db } from '../../objects/base';
import { type Ask, askFor, type Got, type Source, type Work } from './know-fetch';
import type { FactsRow, Hosts } from './know-store';

export type Keys = { lastfm: boolean; discogs: boolean };

/** When the host may be asked again (0: now). */
export const blockedUntil = (hosts: Hosts, host: string, now: number) =>
  (hosts[host]?.until ?? 0) > now ? (hosts[host]?.until as number) : 0;

/** A host's state after a refusal. */
export function refused(h: Hosts[string] | undefined, retry: number | undefined, now: number): Hosts[string] {
  const fails = (h?.fails ?? 0) + 1;
  const back = 60_000 * 2 ** (fails - 1);
  if (fails > K.host_tries)
    return { ...h, fails: 0, until: now + Math.max(retry ?? 0, K.host_left_ms), refused_at: now };
  return { ...h, fails, until: now + Math.max(retry ?? 0, back), refused_at: now };
}

/** A host's state after it answered; null when nothing worth a write changed (`ok_at` hourly). */
export function answered(h: Hosts[string] | undefined, now: number): Hosts[string] | null {
  if (h && !h.fails && h.until <= now && now - (h.ok_at ?? 0) < 3_600_000) return null;
  return { fails: 0, until: 0, ok_at: now, refused_at: h?.refused_at };
}

/** A row's next request: the first source of its list whose host may be asked. Sources with nothing
 * to ask go (`drop`), unless an earlier one was skipped for its host (it may yet give what they
 * need). With none to ask now, `park`: when a skipped host may be asked again (0 when none waits). */
export function nextAsk(
  row: FactsRow,
  named: { artist?: string; title?: string },
  hosts: Hosts,
  keys: Keys,
  now: number,
): { source: Source; ask: Ask; drop: Source[] } | { park: number; drop: Source[] } {
  const w = JSON.parse(row.work_json) as Work;
  const drop: Source[] = [];
  let park = 0;
  for (const source of row.todo.split(',').filter(Boolean) as Source[]) {
    const ask = askFor(source, { mbid: row.id.slice(2), name: row.name, ...named }, w, keys);
    const unkeyed = (source.startsWith('fm') && !keys.lastfm) || (source.startsWith('dc') && !keys.discogs);
    if (!ask) {
      if (!park || unkeyed) drop.push(source);
      continue;
    }
    const until = blockedUntil(hosts, ask.host, now);
    if (!until) return { source, ask, drop };
    park = park ? Math.min(park, until) : until;
  }
  return { park, drop };
}

/** A row's work after a failed request: the source's tries this round, and whether it is given up. */
export function rowFailed(w: Work, source: Source): { work: Work; gaveUp: boolean } {
  const n = (w.tries?.[source] ?? 0) + 1;
  const tries = { ...w.tries, [source]: n };
  if (n < K.row_tries) return { work: { ...w, tries }, gaveUp: false };
  delete tries[source];
  const disco = source === 'disco' ? { page: 0, disco_at: Date.now() } : {};
  return { work: { ...w, tries, ...disco }, gaveUp: true };
}

/** Whether a request's failure is the host's (it backs off) or the row's alone. */
export const hostFault = (got: Got): got is { error: 'host'; retry?: number } => 'error' in got && got.error === 'host';

const FAMILIES: Record<string, KnowSource> = {
  'musicbrainz.org': 'musicbrainz',
  'api.listenbrainz.org': 'listenbrainz',
  'labs.api.listenbrainz.org': 'listenbrainz',
  'www.wikidata.org': 'wikidata',
  'en.wikipedia.org': 'wikipedia',
  'ws.audioscrobbler.com': 'lastfm',
  'api.discogs.com': 'discogs',
};
/** Each source's hosts as Settings shows them: last answered, last refused, left alone until. */
export function hostsStatus(hosts: Hosts, now: number): KnowStatus['hosts'] {
  const out = Object.fromEntries(
    Object.values(FAMILIES).map((f) => [f, { ok_at: null, refused_at: null, until: null }]),
  ) as KnowStatus['hosts'];
  for (const [host, h] of Object.entries(hosts)) {
    const f = FAMILIES[host];
    if (!f) continue;
    const o = out[f];
    o.ok_at = Math.max(o.ok_at ?? 0, h.ok_at ?? 0) || null;
    o.refused_at = Math.max(o.refused_at ?? 0, h.refused_at ?? 0) || null;
    o.until = h.until > now ? Math.max(o.until ?? 0, h.until) : o.until;
  }
  return out;
}

/** The facts rows a restore left out (they are not backed up): each matched album's release group
 * and each known artist's row, put back to be fetched again. Whether any were missing. Reads every
 * album once, with a key read for each row it looks for. */
export function restoreMissing(
  db: Db,
  put: (id: string, kind: 'artist' | 'album', name: string, prio: number) => void,
) {
  const missing = db.all<{ id: string; kind: 'artist' | 'album'; name: string; prio: number }>(
    `SELECT 'g:' || a.rg AS id, 'album' AS kind, a.album AS name, max(a.plays) + 0.5 AS prio FROM know_albums a
       LEFT JOIN know_facts f ON f.id = 'g:' || a.rg WHERE a.state = 'matched' AND f.id IS NULL GROUP BY a.rg
     UNION ALL
     SELECT 'a:' || a.artist_mbid, 'artist', min(a.artist), max(a.plays) + 1 FROM know_albums a
       LEFT JOIN know_facts f ON f.id = 'a:' || a.artist_mbid WHERE a.artist_mbid IS NOT NULL AND f.id IS NULL
       GROUP BY a.artist_mbid`,
  );
  for (const m of missing) put(m.id, m.kind, m.name, m.prio);
  return missing.length > 0;
}
