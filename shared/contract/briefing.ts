// What GET /v1/briefing answers (BRIEFING.md): the page's title line, its tiles in order (P4:
// "Waiting on you"; the night shift's tiles and weather come with P8's Briefing data), the Board
// tile last, and one line about Muse when there is something to say. Counts and titles only; the
// Board itself is read from GET /v1/board/editions/:day.

export interface WaitingTile {
  kind: 'waiting';
  label: 'Waiting on you';
  /** The first decision's question, ≤ 32 characters. */
  value: string;
  detail: string;
  count: number;
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

export interface BriefingResponse {
  day: string;
  title: string;
  tiles: WaitingTile[];
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
