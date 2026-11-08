// Starts LightCraft's browser app (built files beside this one, engine/lightcraft-web/README.md) the way
// its own page does, from a file so the page's CSP needs no inline script. The UI lays out at least 980
// points wide (the width Chrome's "Desktop site" uses), zoomed to fit a phone (patches/desktop-layout.diff);
// ?width=N (600–2400) tries another width.
import init, { start, command } from './lightcraft_web.js';
import { watch } from './status.js';

const params = new URLSearchParams(location.search);
// Isolated (our service worker's COOP and COEP), each render worker runs the threads build with its own
// rayon pool (worker.js), so two workers use the cores four did; LightCraft reads ?workers=N itself.
if (globalThis.crossOriginIsolated && !params.has('workers')) {
  params.set('workers', '2');
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
const asked = Number(params.get('width'));
globalThis.lightcraftLayoutWidth = asked >= 600 && asked <= 2400 ? Math.round(asked) : 980;

// Asks Chrome to keep this site's storage (the library and its originals) when space runs low.
navigator.storage?.persist?.().catch(() => {});

(async () => {
  // Compile once; the render workers (worker.js) instantiate the same compiled module.
  const module = await WebAssembly.compileStreaming(fetch('/lab/lightcraft/lightcraft_web_bg.wasm'));
  globalThis.lightcraftModule = module;
  await init({ module_or_path: module });
  globalThis.lightcraft = { command }; // `await lightcraft.command("library.info", "{}")` → JSON text
  start(new Uint8Array()); // no Chinese font file: Chinese-only glyphs show as boxes
  watch(command);
})().catch((e) => {
  console.error(e);
  const el = document.getElementById('lightcraft_loading');
  if (el) el.textContent = `LightCraft failed to load: ${e}`;
});
