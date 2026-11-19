// @ts-check
// Astra's saved data at a sign-out (th/session.js wipe(), PRIVACY.md §3.1, ASTRA.md §5.3). When this phone keeps
// Astra in step with the owner's server (its sync record says it joined and the switch is on), the server holds the
// copy, so a signed-out phone keeps none of it: `astra.v2.*`, add-on addresses (secrets) among it, and the record go.
// A phone that never joined, or turned the switch off, keeps it as Astra's own local data. Loaded only by a wipe.

const RECORD = 'astra.sync.v1';

export function wipeAstra() {
  /** @type {{ joined?: unknown, off?: unknown } | null} */
  let r = null;
  try {
    r = JSON.parse(localStorage.getItem(RECORD) || 'null');
  } catch {}
  if (r?.joined !== true || r.off === true) return;
  for (const key of Object.keys(localStorage)) if (key.startsWith('astra.v2.') || key === RECORD) localStorage.removeItem(key);
}
