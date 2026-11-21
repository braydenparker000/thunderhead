// @ts-check
// The screen kept on while Study moves a book (STUDY.md §2.3, §3.1): an upload, and a book's first
// download. The browser lets go of the lock when the page hides; it is taken again when it shows.

/** Keeps the screen on until the returned function is called. @returns {() => void} */
export function holdAwake() {
  /** @type {any} */
  let lock = null;
  let on = true;
  const take = async () => {
    if (!on || lock || document.visibilityState !== 'visible') return;
    const got = await /** @type {any} */ (navigator).wakeLock?.request('screen').catch(() => null);
    if (!got) return;
    if (!on) return got.release().catch(() => {});
    lock = got;
    got.addEventListener?.('release', () => {
      if (lock === got) lock = null;
    });
  };
  const shown = () => {
    if (document.visibilityState === 'visible') take();
  };
  document.addEventListener('visibilitychange', shown);
  take();
  return () => {
    on = false;
    document.removeEventListener('visibilitychange', shown);
    lock?.release?.().catch(() => {});
    lock = null;
  };
}
