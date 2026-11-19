// Astra's relay (ASTRA.md §4.4, §5; API.md §11.21; SECURITY.md §8.2): the owner's Worker finds a
// film's direct address for the phone, because a web page cannot read TorBox's API or every hop of
// an add-on's forward (CORS). It asks TorBox with the owner's key, held as the Worker secret
// TORBOX_KEY, and hands back the file's address, which may carry the account's token as TorBox's
// own links do. It does not open add-on links (an add-on may tie one to the connection that asked
// for it): following a forward is kept only behind the Worker variable ASTRA_FOLLOW "on". Addresses
// pass through in transit only, for the owner's device: never stored, never logged. Notes and
// reasons are fixed sentences and numbers, never an address, a hash, a key or a file name. Plain
// data with erasable types only.

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
  /** TorBox calls when nothing is retried: a tap 3 after a press found it ready (createtorrent, then
   * requestdl beside the files), 4 without one (checkcached beside createtorrent), a press 3
   * (checkcached beside the list, requestdl), a film remembered from the last half hour 1
   * (requestdl). With retries and exchanges, a request never makes more than `torbox_calls_max`. */
  torbox_calls: 4,
  torbox_calls_max: 8,
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
  /** GET /v1/astra/torbox/servers: asks one isolate takes a minute (its own count), then 429; and
   * the server groups it hands back at most. */
  servers_per_minute: 6,
  servers_max: 30,
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
  /** The film's direct address; null when TorBox could not give one (then the page plays the
   * add-on's own link itself, as before the relay) or a press could not without adding. */
  url: string | null;
  /** 'follow' only with the Worker variable ASTRA_FOLLOW "on". */
  via: 'torbox' | 'follow' | null;
  /** Of the file, when learnt. */
  size: number | null;
  type: string | null;
  /** Whether the final answer let a web page read it (follow path; null when not checked). */
  readable: boolean | null;
  /** A press only: TorBox has the film ready and its file was told apart, but the account does not
   * hold it yet, so there is no address before a tap; the Worker keeps what it learnt for half an
   * hour, and the tap needs only createtorrent and requestdl. Not a miss. */
  ready: boolean;
  /** Each thing tried with its own time; calls made together overlap, so their times need not add
   * up to `total_ms`, the Worker's whole time for this request. */
  steps: AstraStep[];
  total_ms: number;
}

/** GET /v1/astra/torbox/servers: TorBox's public speed-test files, one a server group, for the lab
 * to time from the phone (a web page may not read TorBox's list itself). The group's label, its
 * region's name when TorBox gives one, and the test file's address; an address carrying a token, or
 * not public https, is left out. These are TorBox's own test files, never the owner's films. */
export interface AstraServer {
  group: string;
  region: string | null;
  url: string;
}
export interface AstraServersResponse {
  servers: AstraServer[];
  note?: string;
}

/** GET /v1/astra/torbox: whether the key is set, whether TorBox takes it (null when not set or not
 * reached), and the plan number TorBox gives; nothing else of the account. */
export interface AstraTorboxResponse {
  configured: boolean;
  ok: boolean | null;
  plan: number | null;
  note?: string;
}
