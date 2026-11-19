// Settings pages that are more than rows: Add-ons, Your data (with this phone and the owner's others),
// About, and the blocks under some areas' rows (Home's catalog rows, Playback's languages).

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {confirm, image, toast, emptyCard} from '../ui/components.js';
import {normaliseManifestUrl, fetchManifest} from '../addons/client.js';
import {homeCatalogs} from '../app/content.js';
import {loadPrefs, savePrefs} from '../player/prefs.js';
import {languageName} from '../engine/languages.js';
import {BACKUP_KEYS, restoreBackup} from '../app/store.js';
import {group, switchRow} from '../settings/rows.js';
import {feelReport, press} from '../ui/motion.js';

const languageLabel = code => code ? languageName(code) || code : '';

/** Home's catalog rows, each switched on or off (settings.hiddenRows, as before). */
export function homeRows(app, page) {
  const entries = homeCatalogs(app.enabledAddons(), app.manifests);
  const hidden = new Set(app.settings.hiddenRows || []);
  const save = () => { app.saveSettings({hiddenRows: [...hidden]}); page.render(); app.screens.home?.load(); };
  return group('Rows', ...(entries.length ? entries.map(e => switchRow(e.title, e.addonName, !hidden.has(e.key), on => { on ? hidden.delete(e.key) : hidden.add(e.key); save(); }))
    : [h('p', {class: 'set-note'}, 'No catalogs yet. Add an add-on first.')]));
}

/** Playback's languages: what Astra remembers from the player's menus, and forgetting it. */
export function languages(app, page) {
  const p = loadPrefs();
  const forget = () => { Object.assign(p, {audioLanguage: '', subtitleLanguage: ''}); savePrefs(p); if (app.player) Object.assign(app.player.prefs, {audioLanguage: '', subtitleLanguage: ''}); page.render(); };
  return [group('Languages',
    h('p', {class: 'set-note'}, `Audio: ${languageLabel(p.audioLanguage) || 'your phone’s language'} · Subtitles: ${languageLabel(p.subtitleLanguage) || 'off'}. Astra remembers what you pick in the player and shows subtitles in that language by itself.`),
    press(h('button', {class: 'set-row', type: 'button', onclick: forget}, h('span', {class: 'set-text'}, h('b', {}, 'Forget my language choices'))))),
  h('p', {class: 'set-note'}, 'Subtitle size, colour, background and position are set from the subtitles menu while watching.')];
}

/** About: the version, the feel report (numbers and fixed names only) and the playback lab. */
export function aboutPage(app) {
  const version = h('small', {}, 'Checking…');
  fetch('/release.json', {cache: 'no-store'}).then(r => (r.ok ? r.json() : {})).then(r => { version.textContent = r.components?.astra?.tree ? `Release ${r.components.astra.tree.slice(0, 8)}` + (r.staged_at ? ` · ${r.staged_at.slice(0, 10)}` : '') : 'A local copy'; },
    () => { version.textContent = 'Not known offline'; });
  const copy = async () => {
    try { await navigator.clipboard.writeText(feelReport()); toast('Feel report copied'); } catch { toast('Copying is not allowed here'); }
  };
  const row = (title, detail, run) => press(h('button', {class: 'set-row', type: 'button', onclick: run}, h('span', {class: 'set-text'}, h('b', {}, title), detail), icon('chevronRight', {size: 20})));
  return [
    group('Astra', h('div', {class: 'set-row'}, h('span', {class: 'set-text'}, h('b', {}, 'Version'), version)),
      row('Copy feel report', h('small', {}, 'How the last transitions ran on this phone: numbers and names only. Paste it to the Thunderhead.'), copy),
      row('Playback lab', h('small', {}, 'See how a file plays on this phone'), () => { location.href = 'lab/'; })),
    h('p', {class: 'about'}, 'Astra · built on the Stremio add-on protocol. Signed in, your own server keeps a sealed copy so your phones match (Your data); otherwise everything stays on this device.'),
  ];
}

export function addonsPage(app, page) {
  const list = app.addons.list;
  // The list is redrawn in place, never the whole page, so the address field keeps what is typed.
  const heading = h('h2', {class: 'section-label'});
  const listSlot = h('div');
  const renderList = () => {
    heading.textContent = `Installed (${list.length})`;
    listSlot.replaceChildren(list.length ? h('div', {class: 'addon-list'}, ...list.map(card)) : emptyCard('No add-ons', 'Install one above. Cinemeta gives catalogs and details; stream add-ons give sources.'));
  };
  // Cards say Loading… until the add-ons are reloaded, then Active or why not; late answers redraw too.
  const changed = () => { app.addons.save(); const ready = app.reloadAddons(); renderList(); ready.then(renderList); app.screens.home?.load(); };
  page.off?.();
  page.off = app.onAddons(renderList);

  const input = h('input', {class: 'field', type: 'url', placeholder: 'Add-on URL', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Add-on URL'});
  const button = h('button', {class: 'btn primary', type: 'submit'}, 'Install');
  const status = h('p', {class: 'set-note', role: 'status'});
  const sameAddress = (stored, url) => { try { return normaliseManifestUrl(stored) === url; } catch { return stored === url; } };
  const already = url => list.find(a => sameAddress(a.url, url));
  let installing = false;
  const install = async () => {
    if (installing) return; // a second tap or Enter while checking
    let url;
    try { url = normaliseManifestUrl(input.value); } catch (e) { status.textContent = e.message; return; }
    if (already(url)) { status.textContent = `${already(url).name || 'That add-on'} is already installed.`; return; }
    installing = true;
    button.disabled = true;
    status.textContent = 'Checking…';
    let manifest;
    try {
      manifest = await fetchManifest(url);
      if (!manifest.id || !manifest.name || !manifest.resources.length) throw Error("That page isn't an add-on manifest.");
    } catch (e) { status.textContent = e.message || "Couldn't reach that add-on."; return; } finally { installing = false; button.disabled = false; }
    // Checked again after the wait: it may have been installed meanwhile.
    if (already(url)) { status.textContent = `${already(url).name || 'That add-on'} is already installed.`; return; }
    const done = text => { input.value = ''; status.textContent = ''; toast(text); changed(); };
    // The same add-on from another address (usually another configuration): Stremio keeps one per id, so offer to replace it.
    const twin = list.find(a => app.manifests.get(a.url)?.id === manifest.id);
    if (twin) {
      status.textContent = `${manifest.name} is already installed from another address.`;
      confirm(`Replace ${twin.name || manifest.name}?`, {message: 'It is installed from another address, perhaps with other settings. Replacing keeps its place in the list.', action: 'Replace',
        run: () => { if (!list.includes(twin) || already(url)) return; Object.assign(twin, {url, name: manifest.name, enabled: true}); done(`${manifest.name} replaced`); }});
      return;
    }
    list.push({url, enabled: true, name: manifest.name});
    done(`${manifest.name} installed`);
  };
  // A form, so Enter on the keyboard installs too; the browser's URL check is off (it would refuse "host/path").
  const form = h('form', {class: 'install-row', novalidate: true, onsubmit: e => { e.preventDefault(); install(); }}, input, button);

  const card = (a, i) => {
    const manifest = app.manifests.get(a.url);
    const error = a.enabled !== false && !manifest ? app.unreachable.get(a.url) : null;
    const state = a.enabled === false ? 'Disabled' : manifest ? 'Active' : error ? "Couldn't load" : 'Loading…';
    const configurable = manifest?.behaviorHints?.configurable || manifest?.behaviorHints?.configurationRequired;
    const resources = (manifest?.resources || []).map(r => typeof r === 'string' ? r : r.name);
    const name = manifest?.name || a.name || 'Add-on';
    // A logo that is missing or fails to load becomes the add-on's initial on the tile.
    const action = (iconName, label, cls, run, disabled = false) => h('button', {class: 'icon-btn ' + cls, type: 'button', 'aria-label': label, disabled, onclick: run}, icon(iconName, {size: 22}));
    return h('div', {class: 'addon-card'},
      h('div', {class: 'addon-top'}, image(manifest?.logo, '', 'addon-logo', {label: name.trim()[0]?.toUpperCase() || '?'}),
        h('div', {class: 'addon-name'}, h('b', {}, name), h('small', {class: error ? 'addon-state failed' : 'addon-state'}, [manifest?.version && 'v' + manifest.version, state].filter(Boolean).join(' · '))),
        h('label', {class: 'switch'}, h('input', {type: 'checkbox', role: 'switch', checked: a.enabled !== false, 'aria-label': 'Enable ' + a.name, onchange: e => { a.enabled = e.target.checked; changed(); }}), h('i'))),
      error ? h('p', {class: 'addon-error'}, error.message || "Couldn't reach it.") : null,
      manifest?.description ? h('p', {class: 'addon-desc'}, manifest.description) : null,
      resources.length ? h('p', {class: 'addon-res'}, resources.join(' · ') + (manifest?.catalogs?.length ? ` · ${manifest.catalogs.length} catalogs` : '')) : null,
      // Nuvio's row of icon actions, right-aligned; each says what it does to a screen reader.
      h('div', {class: 'addon-actions'},
        action('arrowUp', 'Move up', 'move', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; changed(); }, i === 0),
        action('arrowDown', 'Move down', 'move', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; changed(); }, i === list.length - 1),
        error ? action('refresh', 'Retry ' + a.name, 'retry', () => { const ready = app.reloadAddons(); renderList(); ready.then(renderList); }) : null,
        configurable ? action('settings', 'Configure ' + a.name, 'configure', () => open(a.url.replace(/manifest\.json$/, 'configure'), '_blank', 'noopener')) : null,
        action('delete', 'Remove ' + a.name, 'danger', () => confirm(`Remove ${a.name}?`, {message: 'Its catalogs, streams and subtitles leave Astra. You can install it again from its address.', action: 'Remove', destructive: true,
          run: () => { list.splice(list.indexOf(a), 1); changed(); toast(`${a.name} removed`); }}))));
  };
  renderList();
  return [group('Install', h('div', {class: 'set-row column'}, form, status)), heading, listSlot];
}

function phones(app, page) {
  const sync = app.sync, s = sync?.state();
  if (!s || s.signedIn === null) { app.syncReady?.then(() => sync?.ready).then(() => page.render()); return group('This phone and your others', h('p', {class: 'set-note'}, 'Checking your sign-in…')); }
  if (!s.signedIn) return group('This phone and your others', h('p', {class: 'set-note'}, 'Sign in on the Thunderhead to keep your phones in step.'));
  page.off?.();
  page.off = sync.onChange(() => page.render());
  const ago = t => { if (!t) return 'not yet'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(); };
  const said = {unreached: 'Your server could not be reached last time; Astra tries again by itself.', newer: 'A newer Astra saved the copy on your server: update Astra on this phone.',
    'too-big': 'What this phone holds is larger than your server keeps (1 MB), so your other phones do not get its changes.', full: 'This phone’s storage is full, so nothing was brought in.'}[s.problem];
  const remove = () => confirm('Remove the copy on your server?', {message: 'Your server forgets Astra’s add-ons, library, progress and settings, and its daily copies. This phone stops keeping one; turn it off on your other phones too, or they save theirs again. Nothing on this phone changes.',
    action: 'Remove', destructive: true, run: async () => { const r = await sync.removeCopy(); toast(r.ok ? 'The copy on your server is removed' : r.message); page.render(); }});
  return group('This phone and your others',
    switchRow('Keep Astra the same on every phone I sign in on', s.on ? `Saved ${ago(s.savedAt)} · fetched ${ago(s.fetchedAt)}` : 'Turned on, what this phone has and the copy on your server are put together: nothing is lost.', s.on, v => sync.setOn(v)),
    said && s.on ? h('p', {class: 'set-note'}, said) : null,
    s.on ? h('button', {class: 'set-row', type: 'button', disabled: s.working, onclick: () => sync.syncNow()}, h('span', {class: 'set-text'}, h('b', {}, s.working ? 'Syncing…' : 'Sync now'))) : null,
    h('button', {class: 'set-row danger', type: 'button', onclick: remove}, h('span', {class: 'set-text'}, h('b', {}, 'Remove the copy on my server'))));
}

export function dataPage(app, page) {
  const exportData = () => {
    const blob = new Blob([JSON.stringify({astra: 'backup/1', at: new Date().toISOString(), data: Object.fromEntries(BACKUP_KEYS.map(k => [k, app.store.get(k, null)]))}, null, 1)], {type: 'application/json'});
    const a = h('a', {href: URL.createObjectURL(blob), download: `astra-backup-${new Date().toISOString().slice(0, 10)}.json`});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // Restore and copy-again freeze storage before reloading, so nothing this window still holds is saved over them.
  const file = h('input', {type: 'file', accept: 'application/json,.json', hidden: true, onchange: async e => {
    const chosen = e.target.files[0];
    e.target.value = ''; // the same file can be chosen again
    if (!chosen) return;
    const text = await chosen.text().catch(() => null);
    if (text == null) { toast('That file could not be read.'); return; }
    const result = restoreBackup(app.store, text);
    if (!result.ok) { toast(result.message); return; }
    toast(`${result.message} Reloading…`);
    setTimeout(() => location.reload(), 1200);
  }});
  const copyAgain = () => { for (const k of ['imported', 'addons', 'library', 'progress']) app.store.remove(k); app.store.freeze(); location.reload(); };
  return [
    phones(app, page),
    group('Backup',
      h('button', {class: 'set-row', type: 'button', onclick: exportData}, h('span', {class: 'set-text'}, h('b', {}, 'Export a backup'), h('small', {}, 'Add-ons, library, progress and settings as a file'))),
      h('button', {class: 'set-row', type: 'button', onclick: () => file.click()}, h('span', {class: 'set-text'}, h('b', {}, 'Restore from a backup'), h('small', {}, 'Replaces what is on this device'))), file),
    group('Clear',
      h('button', {class: 'set-row danger', type: 'button', onclick: () => confirm('Clear Continue Watching?', {message: 'Every title leaves Continue Watching, and where you stopped is forgotten.', action: 'Clear', destructive: true,
        run: () => { app.progress.clear(); toast('Continue Watching cleared'); }})}, h('span', {class: 'set-text'}, h('b', {}, 'Clear Continue Watching'))),
      h('button', {class: 'set-row', type: 'button', onclick: () => confirm('Copy again from classic Astra?', {message: 'Replaces the add-ons, library and progress this Astra has with what classic Astra has now.', action: 'Copy again', destructive: true, run: copyAgain})},
        h('span', {class: 'set-text'}, h('b', {}, 'Copy again from classic Astra')))),
  ];
}