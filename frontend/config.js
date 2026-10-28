// @ts-check
// Site settings that are public but not committed: scripts/stage.mjs rewrites this file at
// deploy with the API address (repository variable WORKER_URL), the build number, the commit and
// the repository's address. These defaults are for local runs, where sign-in stays off.
export const CONFIG = {
  /** The Worker's address, no trailing slash. Empty: no API yet, the site stays as in P0. */
  api: '',
  /** `git rev-list --count HEAD` on main (ARCHITECTURE.md §6). */
  build: 0,
  commit: 'dev',
  /** The repository's web address, for the setup page's links. */
  repo_url: '',
};
