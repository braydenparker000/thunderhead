// The editor's reports: what a report may hold, one list for the phone that records it (journal.js), the background
// worker that sends it (send.js) and the reader (scripts/reports.mjs). The owner, 2026-11-17: "design a better
// reporting design": a field not named here is dropped where it is recorded, and counted there, so a new one cannot be
// lost on the way unseen (it was: the reset logs of 2026-11-16 never left the phone). Numbers and a few fixed words
// only, never a photo, its name or its settings. A plain script (no import or export), so the background worker can
// load it too (importScripts): it sets `thReportFields`.
(() => {
  /** What an event is. Timings of the editor and the engine pages, as before (open, full, detail, fine, save, tune,
   * check, move, turn, lost, oom), and how a swipe of the panel and a turn of the tool dial went (`swipe`, `tools`); and the flight recorder's own: `begin`/`end` of a heavy job (an unended one is what
   * was running when the page or the chip died), `died` (a visit that never closed, found by the next), `phone` and
   * `gpu` (what this phone is), `mark` (the compare page's verdicts), `dropped` (a field not in this list, by name). */
  const KINDS = ['open', 'full', 'detail', 'fine', 'save', 'tune', 'check', 'move', 'turn', 'swipe', 'tools', 'lost', 'oom', 'begin', 'end', 'died', 'phone', 'gpu', 'mark', 'dropped'];
  const NUMBERS = new Set(['at', 'ms', 'heard', 'decode', 'threads', 'code', 'wasm', 'pool', 'waited', 'age', 'px', 'files', 'bytes', 'gpu', 'read', 'write', 'demosaic', 'noise', 'sharpen', 'warp', 'colour', 'net', 'fell', 'made', 'wait', 'off', 'first', 'kept', 'again', 'held',
      ...['op', 'alt', 'wid', 'one', 'blk', 'nar'].flatMap((k) => Array.from({ length: 16 }, (_, i) => `${k}${i}`)),   // the network's passes timed apart: as the phone runs them (an export: net-tune.js `timed`), and on the engine test page each other way too (-1 none, -2 it did not compile)
      'laid', 'whole', 'chosen', 'floats', 'after', 'ways', 'apart', 'apartc', 'cpu1', 'cpun', 'fuse1', 'fusen', 'gpu1', 'tog', 'togn', 'togl',
      'shots', 'same', 'diff', 'offdb', 'offgrid', 'netdb', 'netndb',
      'frames', 'worst', 'slow', 'busy', 'parts', 'part', 'left', 'pct', 'steps', 'back', 'refit', 'rebuilt',
      'mb', 'peakMb', 'budgetMb', 'since', 'level', 'tile', 'calm'].concat(['t', 'cores', 'memory', 'dpr', 'w', 'h', 'hidden', 'fails', 'tta', 'wino']));
  /** Fractions, kept to four places (where on a photo the compare page was looked at, how far in). */
  const FRACTIONS = new Set(['x', 'y', 'zoom']);
  const MARKS = '(frame|part|tile|map|board|copy|long)', WAY = /^(classic|faster|network|camera|file)$/;
  const WORDS = /** @type {Record<string, RegExp>} */ ({
    file: /^(raf|jpeg|stack)$/, kinds: /^(JPEG|PNG|TIFF)( (JPEG|PNG|TIFF)){0,7}$/,
    job: /^(none|open|full|copy|copy-maker|copy-compile|copy-tile|copy-read|prep|starfish|detail|export)$/,   // a heavy job (and what a reset or a death blamed); the copy's own steps: its demosaic made, its passes compiled, its first tile, its reading back
    outcome: /^(done|left|failed|landed|returned|chose|shut)$/,   // a job's; a swipe's (on to another section, or back); a turn of the tool dial's (a tool chosen, or let go of)
    ran: new RegExp(`^(none|${MARKS}( ${MARKS}){0,6})$`),   // what ran in a gesture's worst gap (lab/editor/app/moved.js)
    model: /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/, android: /^[0-9.]{1,12}$/,   // the phone's model number (SM-A155F) and Android version, as Chrome gives them
    vendor: /^[a-z0-9][a-z0-9 ._-]{0,31}$/, arch: /^[a-z0-9][a-z0-9 ._-]{0,31}$/,   // the graphics chip's maker and kind (arm, valhall)
    a: WAY, b: WAY, picked: WAY, name: /^[a-zA-Z0-9]{1,24}$/,   // a mark's two ways and the one picked; `dropped`: the field's name
  });
  /** One event made safe: its known fields only, and the names of any others (`dropped`). @param {any} e
   * @returns {{ ok: Record<string, number | string | boolean> | null, dropped: string[] }} */
  function clean(e) {
    if (!e || typeof e !== 'object' || !KINDS.includes(e.kind)) return { ok: null, dropped: [] };
    const ok = /** @type {Record<string, number | string | boolean>} */ ({ kind: e.kind }), dropped = [];
    for (const [k, v] of Object.entries(e)) {
      if (k === 'kind') continue;
      if (NUMBERS.has(k) && Number.isFinite(v)) ok[k] = Math.round(v);
      else if (FRACTIONS.has(k) && Number.isFinite(v)) ok[k] = Math.round(v * 1e4) / 1e4;
      else if (WORDS[k] && typeof v === 'string' && WORDS[k].test(v)) ok[k] = v;
      else if (k === 'quick' && typeof v === 'boolean') ok[k] = v;
      else if (v !== undefined) dropped.push(k);
    }
    return { ok, dropped };
  }
  /** Whether `name` is a field an event may hold. @param {string} name */
  const known = (name) => NUMBERS.has(name) || FRACTIONS.has(name) || name in WORDS || name === 'quick' || name === 'kind';
  /** @type {any} */ (globalThis).thReportFields = { KINDS, clean, known };
})();
