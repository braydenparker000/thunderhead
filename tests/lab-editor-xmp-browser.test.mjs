// A Lightroom preset brought into the new editor at /lab/editor/ (frontend/lab/editor/app/xmp.js; engine/raw/ROADMAP.md
// stage 4): the Looks board's IMPORT reads an `.xmp` and keeps it as a look of the owner's own, in Mine, its settings
// laid on this editor's controls by name. What it has no control for is counted and said; a file that is not a
// preset is refused in words. A pack of looks as one `.zip` (app/pack.js) is opened and every look inside it brought
// in with one pick; picked again it adds nothing. The pack is one card on the strip: opened, its looks are walked by the
// groups they name (a preset's own, else its folder), and DELETE PACK takes them away together. The presets here are invented.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../scripts/serve.mjs';
import { PACK_MAX_FILES, unpack } from '../frontend/lab/editor/app/pack.js';
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

test('IMPORT takes a pack as one .zip: every look inside it comes in, none twice; the pack is a card, walked by its groups and deleted whole', opts, async () => {
  const { context, page, errors } = await open();
  const jpeg = await page.evaluate(async () => { const c = new OffscreenCanvas(240, 160), g = c.getContext('2d'); g.fillStyle = '#345'; g.fillRect(0, 0, 240, 160); return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())]; });
  await page.evaluate(async (raf) => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([new Uint8Array(raf)], 'DSCF0007.RAF', { lastModified: 1_700_000_000_000 })], () => {});
    photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Looks' }));
  }, [...makeRaf(Uint8Array.from(jpeg))]);
  const cube = ['TITLE "Warm"', 'LUT_3D_SIZE 2', ...[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${r} ${g * 0.9} ${b * 0.8}`)))].join('\n');
  const zip = makeZip([['Evening pack/soft.xmp', XMP.replace('crs:Name=', 'crs:Group="Dusk" crs:Name=')], ['Evening pack/Film/', '', 0], ['Evening pack/Film/hard.xmp', XMP.replace('Soft evening', 'Hard noon').replace('Contrast2012="+12"', 'Contrast2012="+40"'), 0],
    ['Evening pack/Film/warm.cube', cube], ['Evening pack/read me.txt', 'thanks'], ['__MACOSX/Evening pack/._soft.xmp', 'junk'], ['Evening pack/broken.cube', 'LUT_1D_SIZE 4']]);
  const says = (re) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('#stage')?.textContent ?? ''), re.source).catch(async () => assert.fail(`waited for ${re}; the board says: ${(await page.textContent('#stage')).slice(-400)}`));
  const pick = page.locator('#stage [aria-label="Import looks"]');
  await pick.waitFor();
  const bring = async () => { const [chooser] = await Promise.all([page.waitForEvent('filechooser'), pick.click()]); await chooser.setFiles([{ name: 'Evening pack.zip', mimeType: 'application/zip', buffer: zip }]); };
  await bring();
  await says(/2 presets added to Mine/);
  let said = await page.textContent('#stage');
  assert.match(said, /1 added to Presets · 2 presets added to Mine · 2 hold settings with no control here · broken\.cube: it is a 1D table, not a look · 1 other file in the pack left/);
  const kept = () => page.evaluate(async () => { const k = await import('/lab/editor/app/looks.js'); return [...k.list('cube'), ...k.list('mine')].map((l) => [l.kind, l.name, l.pack, l.group, l.kind === 'cube' ? l.cube.n : l.st.values.Contrast]); });
  // each remembers its pack, and its group there: the one the preset names, else its folder
  assert.deepEqual(await kept(), [['cube', 'warm', 'Evening pack', 'Film', 2], ['mine', 'Soft evening', 'Evening pack', 'Dusk', 12], ['mine', 'Hard noon', 'Evening pack', 'Film', 40]]);
  // The pack's card is open on Mine: its first group in the strip, the other a tap away.
  const tiles = () => page.locator('#stage [role=listbox].hscroll button[role=option]').evaluateAll((l) => l.map((b) => b.getAttribute('aria-label')));
  assert.deepEqual(await tiles(), ['Soft evening']);
  await page.locator('#stage [aria-label="Film: 1 look"]').click();
  await page.locator('#stage [aria-label="Evening pack · Film"]').waitFor();
  assert.deepEqual(await tiles(), ['Hard noon']);
  // Shut, the strip holds the pack as one card beside the owner's own looks, not its looks.
  await page.evaluate(async () => { const k = await import('/lab/editor/app/looks.js'); await k.addMine('My own', { values: { Contrast: 5 }, wb: 'As shot', curve: null }); });
  await page.locator('#stage [aria-label="Back to Mine"]').click();
  await page.locator('#stage [aria-label="My looks"]').waitFor();
  assert.deepEqual(await tiles(), ['Evening pack', 'My own']);
  // The same pack again (IMPORT is on the Presets face): nothing is kept twice, and its card opens there.
  await page.locator('#stage [role=listbox][aria-label="Sections: Mine"]').press('ArrowUp');
  await bring();
  await says(/3 here already/);
  assert.equal((await kept()).length, 4);
  assert.deepEqual(await tiles(), ['warm']);
  // DELETE PACK, twice, takes all three away; the owner's own stays.
  const all = page.locator('#stage [aria-label="Delete every look of Evening pack"]');
  await all.click();
  await says(/Tap again: all 3/);
  await all.click();
  await says(/3 looks of Evening pack deleted from this phone/);
  assert.deepEqual(await kept(), [['mine', 'My own', undefined, undefined, 5]]);
  assert.deepEqual(errors, []);
  await context.close();
});

// The pack's reader on its own (it has no need of a page): the files inside a zip are named and opened; folders and a
// Mac's hidden files are left out; what is not a zip, is cut short, or opens to more than it says is refused in
// words. One archive is written by Python's own zipfile when it is at hand, so the reader is held against a zip this
// repository did not make.
// A zip made here, so no archive is kept in the repository: each file deflated, or stored as it is.
/** @param {[name: string, data: string | Uint8Array, how?: 0 | 8][]} files @returns {Buffer} */
function makeZip(files) {
  const parts = [], dir = [];
  let at = 0;
  for (const [name, data, how = 8] of files) {
    const nm = Buffer.from(name), raw = Buffer.from(data), body = how === 8 ? zlib.deflateRawSync(raw) : raw, crc = zlib.crc32(raw);
    const h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(how, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(how, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(at, 42);
    parts.push(h, nm, body); dir.push(c, nm); at += 30 + nm.length + body.length;
  }
  const d = Buffer.concat(dir), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(d.length, 12); e.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, d, e]);
}

const LONG = 'a look, '.repeat(20_000);

test('the files of a zip, deflated or stored, in folders or not; folders and hidden files left out', async () => {
  const z = makeZip([['soft.xmp', 'hello'], ['Film/', '', 0], ['Film/warm.cube', LONG], ['__MACOSX/._soft.xmp', 'junk'], ['Film/.DS_Store', 'junk', 0], ['read me.txt', 'stored', 0]]);
  const l = await unpack(new Blob([z]));
  assert.deepEqual(l.map((f) => [f.name, f.path, f.size]), [['soft.xmp', 'soft.xmp', 5], ['warm.cube', 'Film/warm.cube', LONG.length], ['read me.txt', 'read me.txt', 6]]);
  assert.deepEqual([await l[0].text(), await l[1].text(), await l[2].text()], ['hello', LONG, 'stored']);
});

test('what is not a zip, is cut short, or lies about its size is refused in words', async () => {
  await assert.rejects(unpack(new Blob(['only words, no archive here'])), /not a zip file/);
  const z = makeZip([['a.xmp', LONG]]);
  await assert.rejects(unpack(new Blob([z.subarray(100)])), /cut short/);
  const lie = Buffer.from(z);
  lie.writeUInt32LE(10, lie.length - 22 - 46 - 5 + 24);   // the directory says ten bytes; the file opens to more
  await assert.rejects(async () => (await unpack(new Blob([lie])))[0].bytes(), /larger than the pack says/);
  const short = Buffer.from(z);
  short.writeUInt32LE(LONG.length + 10, short.length - 22 - 46 - 5 + 24);
  await assert.rejects(async () => (await unpack(new Blob([short])))[0].bytes(), /cut short/);
  const locked = Buffer.from(z);
  locked.writeUInt16LE(1, locked.length - 22 - 46 - 5 + 8);
  await assert.rejects(async () => (await unpack(new Blob([locked])))[0].bytes(), /password/);
  const many = Buffer.from(z);
  many.writeUInt16LE(PACK_MAX_FILES + 1, many.length - 22 + 10);
  await assert.rejects(unpack(new Blob([many])), /more than/);
});

test('an archive written by another tool reads the same', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'th-pack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'p.zip');
  try {
    execFileSync('python3', ['-I', '-c', 'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED)\nz.writestr("Pack/one.xmp", "hello preset")\nz.writestr("Pack/Film/two.cube", "a look, " * 20000)\nz.writestr(zipfile.ZipInfo("Pack/three.txt"), "stored")\nz.close()', file]);
  } catch { t.skip('no python3 here'); return; }
  const l = await unpack(new Blob([readFileSync(file)]));
  assert.deepEqual(l.map((f) => f.path), ['Pack/one.xmp', 'Pack/Film/two.cube', 'Pack/three.txt']);
  assert.deepEqual([await l[0].text(), await l[1].text(), await l[2].text()], ['hello preset', LONG, 'stored']);
});
