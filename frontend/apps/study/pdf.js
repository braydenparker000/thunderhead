// @ts-check
// pdf.js for Study (STUDY.md §2.2): vendored 6.4.299 (Apache-2.0), its legacy build (the modern one
// needs built-ins only the newest Chrome has, unpolyfilled), its worker served from this site, no
// WebAssembly (the shell's CSP has no 'wasm-unsafe-eval'), ranges of 256 KB asked for only
// when needed. It also reads a file the owner picks, from the phone itself, for its title, author
// and a cover drawn from its first page, before anything is uploaded.

const ROOT = '/vendor/pdfjs-6.4.299/';
/** @type {Promise<any> | null} */
let loading = null;

export function pdfjs() {
  loading ??= import(`${ROOT}pdf.min.mjs`).then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${ROOT}pdf.worker.min.mjs`;
    return m;
  });
  return loading;
}

/** The document options every Study load uses. */
export const OPTIONS = { rangeChunkSize: 262_144, disableAutoFetch: true, disableStream: true, useWasm: false };

/**
 * Title, author, page count and a cover (a data URL, 160 px wide) from a picked file, read in
 * ranges from the phone's own copy. Nulls when the file can't be read (it is then refused).
 * @param {Blob} file
 * @returns {Promise<{ title: string | null, author: string | null, pages: number, cover: string | null } | null>}
 */
export async function readLocal(file) {
  const lib = await pdfjs();
  class FromFile extends lib.PDFDataRangeTransport {
    /** @param {number} length */
    constructor(length) {
      super(length, null);
    }

    /** @param {number} begin @param {number} end */
    requestDataRange(begin, end) {
      file
        .slice(begin, end)
        .arrayBuffer()
        .then((b) => this.onDataRange(begin, new Uint8Array(b)));
    }
  }
  const task = lib.getDocument({ ...OPTIONS, range: new FromFile(file.size) });
  try {
    const doc = await task.promise;
    const meta = /** @type {{ info?: { Title?: string, Author?: string } }} */ (await doc.getMetadata().catch(() => ({})));
    const cover = await drawCover(doc).catch(() => null);
    return { title: meta.info?.Title ?? null, author: meta.info?.Author ?? null, pages: doc.numPages, cover };
  } catch {
    return null;
  } finally {
    task.destroy();
  }
}

/** The first page at 160 px wide, as a small JPEG data URL. @param {any} doc */
export async function drawCover(doc) {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 160 / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.8);
}
