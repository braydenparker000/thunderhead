// Repair (MENU-AND-SETTINGS.md §6.8, OPERATIONS.md §3.3), for Settings › About and for the boot guard's panel
// (boot-guard.js) when the app cannot start. A classic script with no imports, so it runs whatever state the
// rest of the site is in. It unregisters this site's three service workers (the shell's at /, Music's,
// Podcasts'), deletes the caches that hold code (the shell's releases th-<n>, the editor's th-lab-<n>,
// th-vendor, Music's claude-player-v<n> and claude-player-release, Podcasts' jarvis-podcast-shell-v<n>) and nothing else: offline
// songs and their heads, downloads, covers, art, the catalogue, Astra's and Photos' caches, IndexedDB and
// localStorage (sign-in among them) all stay. Then it leaves a line for home (boot-guard.js `thStarted`
// hands it to home's toast) and goes home, which now loads from the network. sw.js never answers /repair/.
// Before it clears anything it proves the site answers: home and release.json, asked with HEAD (which no service
// worker of ours answers, old or new, so a cached copy can't pass for the network) past the HTTP cache. With no or
// too weak a signal it clears nothing and says so, so offline songs and books stay reachable from the cached app.
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

  /** Whether this phone can reach the site now: the page Repair returns to and the release file.
   * @param {((url: string, init: object) => Promise<{ ok: boolean }>) | undefined} get */
  async function reach(get) {
    if (!get) return false;
    try {
      for (var u of ['/', '/release.json']) {
        var init = { method: 'HEAD', cache: 'no-store' };
        if (g.AbortSignal && g.AbortSignal.timeout) init.signal = g.AbortSignal.timeout(15000);
        if (!(await get(u, init)).ok) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /** The line home shows after it. @param {{ workers: number, caches: number }} r */
  function line(r) {
    var many = function (n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); };
    return 'Repaired: ' + many(r.caches, 'code cache') + ' and ' + many(r.workers, 'worker') + ' cleared. Sign-in and your data stayed.';
  }

  g.thRepair = { repair: repair, reach: reach, line: line };
  if (!g.document || g.location.pathname !== '/repair/') return;
  // A framed copy does nothing (frame guard, SECURITY.md §4.3).
  try { if (g.top !== g.self) return; } catch (e) { return; }
  var stop = function (say) {
    g.document.getElementById('say').textContent = say;
    g.document.getElementById('again').hidden = false;
  };
  reach(g.fetch && g.fetch.bind(g)).then(function (ok) {
    if (!ok) return stop('Repair needs a connection, and the site can’t be reached now. Nothing was cleared.');
    return repair(g.navigator, g.caches).then(function (r) {
      try {
        g.localStorage.setItem('th.repaired', line(r));
        g.localStorage.removeItem('th.boot');
      } catch (e) {}
      g.location.replace('/');
    }, function () {
      stop('Repair didn’t finish. Nothing of yours was touched.');
    });
  });
})(globalThis);
