// Repair (MENU-AND-SETTINGS.md §6.8, OPERATIONS.md §3.3), for Settings › About and for the boot guard's panel
// (boot-guard.js) when the app cannot start. A classic script with no imports, so it runs whatever state the
// rest of the site is in. It unregisters this site's three service workers (the shell's at /, Music's,
// Podcasts'), deletes the caches that hold code (the shell's releases th-<n>, the editor's th-lab-<n>,
// th-vendor, Music's claude-player-v<n> and claude-player-release, Podcasts' jarvis-podcast-shell-v<n>) and nothing else: offline
// songs and their heads, downloads, covers, art, the catalogue, Astra's and Photos' caches, IndexedDB and
// localStorage (sign-in among them) all stay. Then it leaves a line for home (boot-guard.js `thStarted`
// hands it to home's toast) and goes home, which now loads from the network. sw.js never answers /repair/.
(function (g) {
  var CODE = /^(th-\d+|th-lab-\d+|th-vendor|claude-player-v\d+|claude-player-release|jarvis-podcast-shell-v\d+)$/;
  var SCOPES = ['/', '/music/', '/podcasts/'];

  /** What was cleared. @param {{ serviceWorker?: ServiceWorkerContainer }} nav @param {CacheStorage | undefined} store */
  async function repair(nav, store) {
    var workers = 0, cleared = 0;
    var regs = nav && nav.serviceWorker ? await nav.serviceWorker.getRegistrations() : [];
    for (var r of regs) if (SCOPES.indexOf(new URL(r.scope).pathname) >= 0 && (await r.unregister())) workers++;
    var names = store ? await store.keys() : [];
    for (var n of names) if (CODE.test(n) && (await store.delete(n))) cleared++;
    return { workers: workers, caches: cleared };
  }

  /** The line home shows after it. @param {{ workers: number, caches: number }} r */
  function line(r) {
    var many = function (n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); };
    return 'Repaired: ' + many(r.caches, 'code cache') + ' and ' + many(r.workers, 'worker') + ' cleared. Sign-in and your data stayed.';
  }

  g.thRepair = { repair: repair, line: line };
  if (!g.document || g.location.pathname !== '/repair/') return;
  // A framed copy does nothing (frame guard, SECURITY.md §4.3).
  try { if (g.top !== g.self) return; } catch (e) { return; }
  repair(g.navigator, g.caches).then(function (r) {
    try {
      g.localStorage.setItem('th.repaired', line(r));
      g.localStorage.removeItem('th.boot');
    } catch (e) {}
    g.location.replace('/');
  }, function () {
    g.document.getElementById('say').textContent = 'Repair didn’t finish. Nothing of yours was touched.';
    g.document.getElementById('again').hidden = false;
  });
})(globalThis);
