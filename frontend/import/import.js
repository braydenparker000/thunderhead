// /import/ (MIGRATION.md §5.3): the phone's app data from the old site's /export/ file, written back
// on this site under the same names so the apps ported as they are find it. Signed in only. The raw
// copy for the later data moves (POST /v1/import/phone) waits for the private bucket (SETUP.md J2).
import { configured, toSignin } from '/th/client.js';
import { store } from '/th/session.js';
import { el } from '/th/ui.js';
import { check, collect, countLines, countsOf, restore } from '/import/phone-data.js';

const $ = (s) => document.querySelector(s);
const line = $('#line'), sr = $('#sr'), go = $('#go'), list = $('#counts');
const say = (text, ok = false) => { line.textContent = text; line.classList.toggle('ok', ok); sr.textContent = text; };
const show = (lines) => { list.replaceChildren(...lines.map(t => el('li', { text: t }))); list.hidden = !lines.length; };

let data = null;

if (configured && !(await store.read())) toSignin();

$('#file').addEventListener('change', async (e) => {
  data = null; go.disabled = true; show([]); say('');
  const file = e.target.files?.[0];
  if (!file) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { say("That file isn't a phone export."); return; }
  const problem = check(parsed);
  if (problem) { say(problem); return; }
  data = parsed;
  show(countLines(countsOf(data)));
  go.disabled = false;
  say(`From ${data.device_label || 'your phone'}, exported ${new Date(data.exported_at).toLocaleString()}.`, true);
});

go.addEventListener('click', async () => {
  if (!data) return;
  go.disabled = true;
  try {
    const result = await restore(data, { replace: $('#replace').checked });
    const after = countLines((await collect()).counts);
    show(after);
    if (result.kept.length) {
      $('#replace-row').hidden = false;
      say(`Imported from the old site. Kept what was already here: ${result.kept.join(', ')}. Tick "Replace" and import again to overwrite it.`, true);
    } else say('Imported from the old site. The counts above are read back from this site; they should match the old site’s /export/ page.', true);
  } catch (err) {
    say(`The import stopped: ${err?.message || err}. Nothing that was already here was removed.`);
  } finally { go.disabled = false; }
});
