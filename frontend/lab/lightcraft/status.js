// A quiet line in a corner of the LightCraft test page: "Rendering… 14 s" while a render has run past two
// seconds, then how long it took, and the last render failure or panic LightCraft logged. It lets the
// owner tell a slow render on the phone from a failed one (engine/lightcraft-web/README.md).
const line = document.getElementById('lightcraft_status_line');
let busySince = 0, failure = '', hideAt = 0;

// LightCraft logs a failed render as `render Main, PhotoId(n), file "…": why` and a panic as `panicked at …`.
for (const level of ['warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const text = args.map(String).join(' ');
    const m = text.match(/render (Main|Region)[^:]*: (.*)$/s) ?? text.match(/panicked at [^\n]*\n?([^\n]*)/);
    if (m) failure = (m[2] ?? m[1] ?? '').trim().slice(0, 160);
    original(...args);
  };
}

const show = (text) => { line.textContent = text; line.hidden = !text; };

export function watch(command) {
  setInterval(async () => {
    let s;
    try { s = JSON.parse(await command('web.stats', '{}')); } catch { return; }
    const busy = (s.renderQueue || 0) + (s.rendersInFlight || 0) > 0;
    const now = performance.now();
    if (busy && !busySince) busySince = now;
    if (!busy && busySince) {
      const took = (now - busySince) / 1000;
      if (took > 2) { show(failure ? `Render failed: ${failure}` : `Rendered in ${took.toFixed(0)} s`); hideAt = now + (failure ? 15000 : 4000); }
      busySince = 0;
      failure = '';
    }
    if (busy && now - busySince > 2000) show(`Rendering… ${((now - busySince) / 1000).toFixed(0)} s`);
    else if (!busy && hideAt && now > hideAt) { show(''); hideAt = 0; }
  }, 500);
}
