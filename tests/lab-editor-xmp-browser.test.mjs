// A Lightroom preset brought into the new editor at /lab/editor/ (frontend/lab/editor/app/xmp.js; engine/raw/ROADMAP.md
// stage 4): the Looks board's IMPORT reads an `.xmp` and keeps it as a look of the owner's own, in Mine, its settings
// laid on this editor's controls by name. What it has no control for is counted and said; a file that is not a
// preset is refused in words. The preset here is invented.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { makeRaf } from './fixtures/make-raf.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only', timeout: 120_000 };
const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Name="Soft evening" crs:Exposure2012="+0.30" crs:Contrast2012="+12"
 crs:Highlights2012="-40" crs:Shadows2012="+25" crs:Clarity2012="+8" crs:Vibrance="+15" crs:HueAdjustmentOrange="-6" crs:SaturationAdjustmentBlue="-20"
 crs:SplitToningShadowHue="220" crs:SplitToningShadowSaturation="12" crs:Sharpness="55" crs:GrainAmount="18" crs:ParametricShadows="-10">
<crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 10</rdf:li><rdf:li>128, 132</rdf:li><rdf:li>255, 245</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function open() {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('**/*.wasm', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  return { context, page, errors };
}

test("a preset's settings land on this editor's controls by name; the rest is counted", opts, async () => {
  const { context, page, errors } = await open();
  const look = await page.evaluate(async (xml) => (await import('/lab/editor/app/xmp.js')).lookOfXmp(xml, 'soft.xmp'), XMP);
  assert.equal(look.name, 'Soft evening');
  assert.deepEqual(look.st.values, { Contrast: 12, Highlights: -40, Shadows: 25, Vibrance: 15, Clarity: 8, Grain: 18, Sharpening: 55,
    'Grade Shadows Hue': 220, 'Grade Shadows Sat': 12, 'Mix Orange Hue': -6, 'Mix Blue Sat': -20 });
  assert.deepEqual(look.st.curve.RGB.map((p) => p.map((v) => Math.round(v * 255))), [[0, 10], [128, 132], [255, 245]]);
  assert.deepEqual(look.st.curve.R, [[0, 0], [1, 1]]);
  assert.equal(look.st.profile, undefined, "no profile of its own: wearing it keeps the photo's");
  assert.deepEqual([look.used, look.left], [12, 2], 'Exposure is the photo\'s own and the parametric curve has no control here');
  // Not a preset, or one with nothing this editor knows: nothing.
  const none = await page.evaluate(async () => { const { lookOfXmp } = await import('/lab/editor/app/xmp.js'); return [lookOfXmp('<x:xmpmeta/>', 'a.xmp'), lookOfXmp('hello', 'b.xmp')]; });
  assert.deepEqual(none, [null, null]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('IMPORT on the Looks board keeps a preset in Mine and says what it could not lay on', opts, async () => {
  const { context, page, errors } = await open();
  // Looks are brought in with a photo open (the board shows them on it): a synthetic RAF, whose decoding is not what is tested.
  const jpeg = await page.evaluate(async () => { const c = new OffscreenCanvas(240, 160), g = c.getContext('2d'); g.fillStyle = '#345'; g.fillRect(0, 0, 240, 160); return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())]; });
  await page.evaluate(async (raf) => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([new Uint8Array(raf)], 'DSCF0007.RAF', { lastModified: 1_700_000_000_000 })], () => {});
    photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Looks' }));
  }, [...makeRaf(Uint8Array.from(jpeg))]);
  const pick = page.locator('#stage [aria-label="Import looks"]');
  await pick.waitFor();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), pick.click()]);
  await chooser.setFiles([{ name: 'soft.xmp', mimeType: 'application/xml', buffer: Buffer.from(XMP) }, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
  await page.waitForFunction(() => /1 preset added to Mine/.test(document.querySelector('#stage')?.textContent ?? ''));
  const said = await page.textContent('#stage');
  assert.match(said, /Soft evening: 2 of its settings have no control here/);
  assert.match(said, /notes\.txt: only \.cube and \.xmp looks are read so far/);
  const kept = await page.evaluate(async () => { const k = await import('/lab/editor/app/looks.js'); return k.list('mine').map((l) => ({ name: l.name, kind: l.kind, contrast: l.st.values.Contrast, curve: l.st.curve.RGB.length })); });
  assert.deepEqual(kept, [{ name: 'Soft evening', kind: 'mine', contrast: 12, curve: 3 }]);
  assert.deepEqual(errors, []);
  await context.close();
});
