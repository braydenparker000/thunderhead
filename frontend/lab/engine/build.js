// @ts-check
// Which release this copy of the editor and its engine is. The site's /config.js is always read fresh from the
// network, and these files may be the phone's kept copy of an older release (sw.js `lab`), so a label made from
// config.js can name a release whose code is not what ran. This file is one of the kept files: what it says is
// what ran. scripts/stage.mjs writes the commit here; from the repository it is 'dev'.
export const BUILD = 'dev';
