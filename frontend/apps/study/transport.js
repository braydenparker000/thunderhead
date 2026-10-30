// @ts-check
// The reader's bytes (STUDY.md §2.2): pdf.js asks for ranges, and each one is a `Range` GET on the
// book's signed link straight from the private bucket. A 206 is handed over; a 200 (the server
// ignored the range) is the whole file, and no more ranges are asked for; a 403 signs once more
// and tries the same range again, and a second 403 can't open the book; a network error or a 5xx
// is tried again after 1 s and 3 s. The link stays in memory: never in a URL, a log or a sense.

export const RETRY_MS = [1_000, 3_000];

/** Why a range failed: `denied` (a second 403, or the book is gone) or `offline` (no answer). */
export class RangeError_ extends Error {
  /** @param {'denied' | 'offline'} kind */
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

/**
 * One range of the file.
 * @param {{
 *   url: () => Promise<string>, resign: () => Promise<string>, begin: number, end: number,
 *   fetcher?: typeof fetch, wait?: (ms: number) => Promise<void>,
 * }} o
 * @returns {Promise<{ bytes: Uint8Array, whole: boolean }>}
 */
export async function fetchRange(o) {
  const fetcher = o.fetcher ?? fetch;
  const wait = o.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let url = await o.url();
  let resigned = false;
  let tries = 0;
  for (;;) {
    /** @type {Response | null} */
    let res = null;
    try {
      res = await fetcher(url, {
        headers: { Range: `bytes=${o.begin}-${o.end - 1}` },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      res = null;
    }
    if (res && (res.status === 206 || res.status === 200))
      return { bytes: new Uint8Array(await res.arrayBuffer()), whole: res.status === 200 };
    if (res?.status === 403 && !resigned) {
      resigned = true;
      url = await o.resign();
      continue;
    }
    if (res && res.status < 500) throw new RangeError_('denied');
    if (tries >= RETRY_MS.length) throw new RangeError_('offline');
    await wait(RETRY_MS[tries++]);
  }
}

/**
 * pdf.js's range transport over `fetchRange`. A failed range is kept; `retry()` asks for it again
 * (the reader's Try again), and `onFail` tells the reader why.
 * @param {any} pdfjs
 * @param {{ length: number, url: () => Promise<string>, resign: () => Promise<string>,
 *   onFail: (e: RangeError_) => void, fetcher?: typeof fetch }} o
 */
export function rangeTransport(pdfjs, o) {
  class Signed extends pdfjs.PDFDataRangeTransport {
    /** @type {[number, number][]} */
    failed = [];
    done = false;

    /** @param {number} length */
    constructor(length) {
      super(length, null);
    }

    /** @param {number} begin @param {number} end */
    requestDataRange(begin, end) {
      if (this.done) return;
      fetchRange({ url: o.url, resign: o.resign, begin, end, fetcher: o.fetcher })
        .then(({ bytes, whole }) => {
          if (whole) {
            this.done = true;
            this.onDataRange(0, bytes);
          } else this.onDataRange(begin, bytes);
        })
        .catch((e) => {
          this.failed.push([begin, end]);
          o.onFail(e instanceof RangeError_ ? e : new RangeError_('offline'));
        });
    }

    retry() {
      const again = this.failed.splice(0);
      for (const [b, e] of again) this.requestDataRange(b, e);
    }
  }
  return new Signed(o.length);
}
