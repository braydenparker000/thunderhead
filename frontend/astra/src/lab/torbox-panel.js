// The TorBox check on the lab page (torbox-check.js): a field for a stream's address, the "TorBox check" button,
// each step's line as it runs, and "Copy report". The address comes pasted, or handed over in the fragment the way
// "Check playback in the lab" hands one (lab.js reads it and takes it out of the address bar at once, then fills
// the field). The Worker is asked through the page's own helper (addons/worker-api.js, with the owner's session,
// for a top-level page of this site only), loaded when the check runs, as are the engine's probe and planner.

import {torboxCheck, checkReport, deviceLine, STEPS} from './torbox-check.js';

const MARK = {run: '…', ok: '✓', bad: '✗', info: '•', skip: '–'};

/** What the check needs from the rest of the page, loaded on the first run. */
export async function checkTools() {
  const [helper, {probe}, {planPlayback}, caps, routes] = await Promise.all([
    import('../addons/worker-api.js').catch(() => null), import('../engine/probe.js'), import('../engine/plan.js'), import('../engine/capabilities.js'), import('../engine/route-memory.js'),
  ]);
  const api = helper?.api || (async () => { throw Object.assign(new Error('The page’s Worker helper did not load.'), {missing: true}); });
  return {api, probe, plan: planPlayback, caps: {mse: caps.mseSupports, native: caps.nativeCanPlay, opusEncode: await caps.canEncodeAudio('opus'), software: typeof WebAssembly === 'object' && typeof MediaStream === 'function', passFailed: c => routes.passFailed(c), failedRoute: c => routes.failedRoute(c)}};
}

/**
 * Wires the panel. `stop()` ends the lab's own playback first, so the connection limit is measured on this check's
 * requests alone; `tools` is checkTools (tests hand their own). Returns {fill(address)} for a handed-over address.
 */
export function torboxPanel({form, field, button, list, copy, hint, stop = () => {}, tools = checkTools}) {
  let steps = null, link = '', running = null;
  const render = all => {
    list.hidden = false;
    list.replaceChildren(...all.map(s => {
      const li = document.createElement('li');
      li.className = 'check-step';
      li.dataset.step = s.id; li.dataset.state = s.state;
      const head = document.createElement('b');
      head.textContent = `${MARK[s.state] || ''} (${s.id}) ${s.title}`;
      li.append(head, ...s.lines.map(line => Object.assign(document.createElement('span'), {textContent: line})));
      return li;
    }));
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (running) { running.abort(); return; }
    link = field.value.trim();
    if (!/^https?:\/\//i.test(link)) { hint.textContent = 'Paste a stream’s address first.'; return; }
    running = new AbortController();
    button.textContent = 'Stop';
    copy.hidden = true; hint.textContent = '';
    try {
      stop();
      render(STEPS.map(([id, title]) => ({id, title, state: 'skip', lines: []})));
      const t = await tools();
      steps = await torboxCheck(link, {...t, signal: running.signal, onStep: (_s, all) => render(all)});
      render(steps);
      copy.hidden = false;
    } catch (error) {
      hint.textContent = `The check stopped: ${error?.message || 'no reason given'}.`;
    } finally {
      running = null;
      button.textContent = 'TorBox check';
    }
  });
  copy.addEventListener('click', async () => {
    if (!steps) return;
    const report = checkReport(steps, {link, device: deviceLine()});
    try { await navigator.clipboard.writeText(report); hint.textContent = 'Report copied. It holds no address, hash, key or file name.'; }
    catch { hint.textContent = 'Copy failed; long-press to select the report below.'; hint.append(Object.assign(document.createElement('pre'), {textContent: report})); }
  });
  return {fill(address) { if (address) field.value = address; }};
}
