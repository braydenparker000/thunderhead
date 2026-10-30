// What GET /v1/briefing answers (BRIEFING.md): the page's title line, the weather (P8), its tiles
// in order ("Waiting on you", then the night shift's tiles, P8), the Board tile last,
// and one line about Muse when there is something to say. Counts and titles only; the Board itself
// is read from GET /v1/board/editions/:day.

export interface WaitingTile {
  kind: 'waiting';
  label: 'Waiting on you';
  /** The first decision's question, ≤ 32 characters. */
  value: string;
  detail: string;
  count: number;
}

/** A tile the night shift placed (a `tile` surface in app `briefing`, BRIEFING.md §2). */
export interface NightTile {
  kind: 'night';
  /** `practice`, `study`, `built`, `note.1`–`note.3`. */
  slot: string;
  label: string;
  value: string;
  detail: string | null;
  big: string | null;
  wide: boolean;
  /** Where a tap opens it, inside that app, or null. */
  app: string | null;
  path: string | null;
  why: string;
}

export interface BoardTile {
  day: string;
  title: string;
  detail: string;
  stories: number;
  minutes: number;
  /** Yesterday's edition, shown because today's hasn't come. */
  stale: boolean;
}

/** BRIEFING.md §2, §6: the weather tile, always first; with no place, the one that asks for it. */
export interface WeatherTile {
  /** The place's name, or null when none is set. */
  place: string | null;
  /** "24°", or null when there is nothing current to show. */
  temp: string | null;
  /** One sentence for the next hours, "as of 14:10", "Weather is out of date" or "Set a place for the weather". */
  detail: string;
  as_of: number | null;
  /** The next 12 hours: start (ms), °C, rain chance %. */
  hours: { at: number; temp: number; rain: number }[];
  tomorrow: { high: number; low: number } | null;
}

export interface PutPlaceRequest {
  /** A town's name, looked up with Open-Meteo's geocoder. */
  name: string;
}

export interface BriefingResponse {
  day: string;
  title: string;
  weather: WeatherTile;
  /** At most 8, in order: "Waiting on you", then the night's tiles by slot. */
  tiles: (WaitingTile | NightTile)[];
  board: BoardTile | null;
  /** "Muse is connected to the new Worker." / "Muse hasn't checked in since yesterday." / null */
  muse: string | null;
}

/** BRIEFING.md §3: the title line by local hour. */
export function titleLine(hour: number, empty: boolean): string {
  if (empty) return 'A quiet day.';
  if (hour >= 4 && hour < 15) return "Here's your day.";
  if (hour >= 15 && hour < 19) return "Here's the rest of today.";
  return "Here's tonight.";
}
