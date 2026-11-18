// Astra's relay (ASTRA.md §4.4, §5; API.md §11.21; SECURITY.md §8.2): the owner's Worker finds a
// film's direct address for the phone, because a web page cannot read TorBox's API or every hop of
// an add-on's forward (CORS). It asks TorBox with the owner's key, held as the Worker secret
// TORBOX_KEY, or follows the add-on's forward by hand, and hands back where it ends. Addresses pass
// through in transit only, for the owner's device: never stored, never logged. Notes and reasons
// are fixed sentences and numbers, never an address, a hash, a key or a file name. Plain data with
// erasable types only.

export const ASTRA_LIMITS = {
  /** The add-on's link, in characters (AIOStreams' carry a base64url JSON and a sealed key). */
  link_chars: 4096,
  /** A file name the page read from the stream, in characters. */
  name_chars: 1024,
  /** One TorBox call, then the whole request, then the add-on's forward, in milliseconds. */
  torbox_ms: 8_000,
  request_ms: 25_000,
  follow_ms: 20_000,
  /** A 429 or 5xx from TorBox is tried once more, after this long. */
  retry_ms: 500,
  /** The direct path's TorBox calls when nothing is retried; with retries and a TorBox link met
   * while following, a request never makes more than `torbox_calls_max`. */
  torbox_calls: 4,
  torbox_calls_max: 6,
  /** Requests a hop chain may take, the first included. */
  hops: 6,
  /** Taps ("play") and GET /v1/astra/torbox one isolate takes a minute, then 429; presses
   * ("ahead") have their own count, so they never starve a tap, and past it answer no address. */
  per_minute: 30,
  ahead_per_minute: 60,
  /** A video under this size on the add-on's own host is its "not ready yet" placeholder. */
  placeholder_bytes: 20 * 1024 * 1024,
  /** Files under this size (and sample files) are set aside when looking for the one video. */
  small_file_bytes: 50 * 1024 * 1024,
  /** How much of TorBox's list is read when looking for an item already in the account: a press
   * ("ahead") reads only the newest items, so a big account costs little CPU; a tap whose second
   * add TorBox refused reads a longer page. */
  list_page_ahead: 100,
  list_page: 1000,
} as const;

export const ASTRA_MODES = ['play', 'ahead'] as const;
export type AstraMode = (typeof ASTRA_MODES)[number];

/** POST /v1/astra/play. `null` in an optional field is the same as leaving it out. */
export interface AstraPlayRequest {
  /** The add-on's https address for the stream, always sent. */
  link: string;
  /** 40 hex, lower case, when the page could read it from the link. */
  hash?: string | null;
  /** What the page knows of the file: the add-on's index, the file's name and size. */
  fileIndex?: number | null;
  fileName?: string | null;
  fileSize?: number | null;
  /** "ahead" (before a tap) never adds anything to TorBox and never follows a link. */
  mode: AstraMode;
}

export const ASTRA_STEPS = ['key', 'cached', 'owned', 'add', 'file', 'link', 'follow'] as const;
export type AstraStepName = (typeof ASTRA_STEPS)[number];

/** One thing the Worker tried, in order, with how long it took. */
export interface AstraStep {
  step: AstraStepName;
  ok: boolean;
  ms: number;
  note?: string;
}

/** POST /v1/astra/play's answer. Errors are the usual envelope with `details.reason` (one plain
 * sentence for the owner) and `details.steps`. `503 unavailable` means the film is not on TorBox
 * (TorBox said for certain it is not cached, or the add-on answered its own "not ready" video): the
 * page must not play the add-on's link instead, since that is how an add-on adds an uncached torrent
 * (owner ruling 2026-11-18: nothing uncached is ever added by Astra). */
export interface AstraPlayResponse {
  /** The film's direct address, or null when mode "ahead" could not get one without adding. */
  url: string | null;
  via: 'torbox' | 'follow' | null;
  /** Of the file, when learnt. */
  size: number | null;
  type: string | null;
  /** Whether the final answer let a web page read it (follow path; null when not checked). */
  readable: boolean | null;
  steps: AstraStep[];
}

/** GET /v1/astra/torbox: whether the key is set, whether TorBox takes it (null when not set or not
 * reached), and the plan number TorBox gives; nothing else of the account. */
export interface AstraTorboxResponse {
  configured: boolean;
  ok: boolean | null;
  plan: number | null;
  note?: string;
}
