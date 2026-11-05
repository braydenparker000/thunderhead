// Looks on the phone (PHOTOS.md, Looks): the .xmp preset reader and the camera recipe reader on small
// synthetic texts written here (never a real preset or recipe), and a look applied with its Amount and
// its relative white balance; the phone's copies match the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDIT_PANELS, LOOK_LIMITS, LOOK_WB_REFERENCE } from '../shared/contract/photos.ts';
import { PANELS } from '../frontend/apps/photos/edit/fields.js';
import { lookOf, lookOnto, WB_REF } from '../frontend/apps/photos/edit/looks-apply.js';
import { readFileSync } from 'node:fs';
import { recipeOfText } from '../frontend/apps/photos/edit/recipe-text.js';
import { presetOfXmp } from '../frontend/apps/photos/edit/xmp-import.js';

const CRS = 'xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"';
const packet = (attrs, inner = '') => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" ${CRS} xmlns:dc="http://purl.org/dc/elements/1.1/" ${attrs}>${inner}</rdf:Description></rdf:RDF></x:xmpmeta>`;
const alt = (k, v) => `<crs:${k}><rdf:Alt><rdf:li xml:lang="x-default">${v}</rdf:li></rdf:Alt></crs:${k}>`;

test('the phone and the contract agree on the panels, the white balance reference and the batch', () => {
  assert.deepEqual(PANELS.map((p) => p.id), [...EDIT_PANELS]);
  assert.equal(WB_REF, LOOK_WB_REFERENCE);
  assert.match(readFileSync(new URL('../frontend/apps/photos/edit/looks-store.js', import.meta.url), 'utf8'), new RegExp(`PER_PUT = ${LOOK_LIMITS.per_request};`));
});

test('a preset: the values our recipe has, held in range, its name and group; nothing else kept', () => {
  const xml = packet(
    'crs:PresetType="Normal" crs:Version="15.0" crs:Exposure2012="+0.45" crs:Contrast2012="-12" crs:Highlights2012="-180" crs:Clarity2012="0" crs:Texture="8" crs:Dehaze="5" crs:Vibrance="10" crs:Saturation="-5" crs:HueAdjustmentOrange="-6" crs:SaturationAdjustmentBlue="-20" crs:LuminanceAdjustmentGreen="12" crs:SplitToningShadowHue="210" crs:SplitToningShadowSaturation="14" crs:ColorGradeMidtoneHue="40" crs:ColorGradeBlending="70" crs:Sharpness="30" crs:SharpenRadius="+1.2" crs:SharpenDetail="20" crs:SharpenEdgeMasking="35" crs:LuminanceSmoothing="15" crs:ColorNoiseReduction="25" crs:PostCropVignetteAmount="-14" crs:GrainAmount="22" crs:GrainSize="30" crs:GrainFrequency="60" crs:ConvertToGrayscale="False" crs:CropTop="0.1" crs:LocalAdjustmentsMade="True" crs:Copyright="Someone"',
    `${alt('Name', 'Invented &amp; quiet')}${alt('Group', 'Invented pack')}<dc:creator><rdf:Seq><rdf:li>An invented author</rdf:li></rdf:Seq></dc:creator>
<crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 12</rdf:li><rdf:li>64, 60</rdf:li><rdf:li>192, 200</rdf:li><rdf:li>255, 248</rdf:li></rdf:Seq></crs:ToneCurvePV2012>`,
  );
  const p = presetOfXmp(xml, 'quiet.xmp');
  assert.equal(p.name, 'Invented & quiet');
  assert.equal(p.tag, 'Invented pack');
  assert.deepEqual(p.panels, ['light', 'color', 'effects', 'detail']);
  assert.equal(p.recipe.Highlights2012, -100, 'held inside its range');
  assert.equal(p.recipe.SharpenRadius, 1.2);
  assert.deepEqual(p.recipe.ToneCurvePV2012, [[0, 12], [64, 60], [192, 200], [255, 248]]);
  assert.equal('ConvertToGrayscale' in p.recipe, false);
  assert.equal('CropTop' in p.recipe, false, 'a crop belongs to its photo');
  assert.equal(p.skipped, 2, 'CropTop and LocalAdjustmentsMade; the preset’s own fields are not settings');
  assert.doesNotMatch(JSON.stringify(p), /author|Someone|Version|PresetType/i);
});

test('white balance only as Custom, as offsets; elements, the Look block and the file name', () => {
  const kelvin = presetOfXmp(packet('crs:WhiteBalance="Custom" crs:Temperature="6200" crs:Tint="+8"'), 'a.xmp');
  assert.deepEqual(kelvin.recipe, { WhiteBalance: 'Custom', Temperature: 6200, Tint: 8 });
  assert.equal(kelvin.name, 'a');
  const jpeg = presetOfXmp(packet('crs:WhiteBalance="Custom" crs:Temperature="+20" crs:Tint="-5"'));
  assert.equal(jpeg.recipe.Temperature, Math.round(1e6 / (1e6 / 5500 - 10)), '+20 is 10 mired warmer than 5,500 K');
  const shot = presetOfXmp(packet('crs:WhiteBalance="As Shot" crs:Temperature="5000" crs:Tint="3" crs:Vibrance="4"'));
  assert.deepEqual(shot.recipe, { Vibrance: 4 });
  assert.equal(shot.skipped, 2);
  const els = presetOfXmp(packet('', '<crs:Exposure2012>-0.5</crs:Exposure2012><crs:ConvertToGrayscale>True</crs:ConvertToGrayscale>'), 'b.xmp');
  assert.deepEqual(els.recipe, { Exposure2012: -0.5, ConvertToGrayscale: true });
  const look = presetOfXmp(packet('crs:Contrast2012="10"', `${alt('Name', 'Invented look pack')}<crs:Look><rdf:Description crs:Name="An invented profile" crs:Amount="0.5"><crs:Parameters><rdf:Description crs:Contrast2012="60" crs:Saturation="40" crs:Unknown="1"/></crs:Parameters></rdf:Description></crs:Look>`));
  assert.equal(look.name, 'Invented look pack', "the preset's name, not its profile's");
  assert.deepEqual(look.recipe, { Contrast2012: 10, Saturation: 20 });
  assert.equal(look.skipped, 1);
  assert.equal(presetOfXmp('<x:xmpmeta><rdf:RDF><rdf:Description dc:title="x"/></rdf:RDF></x:xmpmeta>'), null);
  assert.equal(presetOfXmp(packet('crs:Version="15.0"')), null, 'no setting the recipe has');
  assert.equal(presetOfXmp(packet('crs:Exposure2012="1"', alt('Name', 'n'.repeat(90)))).name.length, 60);
});

test('a recipe: read in any case and order, with the short names, on the documented scale', () => {
  const r = recipeOfText(`Film Simulation: Classic Chrome
Dynamic Range: DR400
Highlight: -1
Shadow: +1
Color: +2
Noise Reduction: -4
Sharpening: -2
Clarity: -3
Grain Effect: Weak, Small
Color Chrome Effect: Strong
Color Chrome FX Blue: Weak
White Balance: Daylight, +2 Red & -4 Blue
ISO: Auto, up to ISO 6400
Exposure Compensation: +1/3 to +2/3`);
  assert.equal(r.film, 'Classic Chrome');
  assert.deepEqual(r.panels, ['light', 'color', 'effects', 'detail']);
  assert.equal(r.skipped, 2, 'ISO and exposure compensation are how to shoot, not an edit');
  const x = r.recipe;
  assert.deepEqual([x.Highlights2012, x.Shadows2012, x.Saturation, x.LuminanceSmoothing, x.Sharpness, x.Clarity2012, x.GrainAmount, x.GrainSize], [-35, -15, 20, 0, 20, -30, 25, 25]);
  assert.deepEqual([x.LuminanceAdjustmentRed, x.SaturationAdjustmentRed, x.LuminanceAdjustmentBlue, x.LuminanceAdjustmentAqua], [-10, -6, -6, -3]);
  assert.deepEqual([x.WhiteBalance, x.Temperature, x.Tint], ['Custom', Math.round(1e6 / (1e6 / 5500 - 15)), -6]);
  const short = recipeOfText('wb: 6300K, R+1 B-3\nCCFXB: strong\nGRAIN: STRONG/LARGE\nh: +2\nS: −2\nfilm simulation: Acros\nsomething else: 4');
  assert.deepEqual([short.recipe.Highlights2012, short.recipe.Shadows2012, short.recipe.GrainAmount, short.recipe.GrainSize, short.recipe.ConvertToGrayscale], [30, 30, 50, 50, true]);
  assert.equal(short.recipe.Temperature, Math.round(1e6 / (1e6 / 6300 - 10)));
  assert.equal(short.recipe.Tint, -6);
  assert.equal(short.recipe.LuminanceAdjustmentBlue, -12);
  assert.equal(short.skipped, 1);
  assert.equal(recipeOfText('Just a sentence about a walk.'), null);
});

test('a look applied: its panels replace the photo’s, Amount scales the change, white balance shifts', () => {
  const shot = { temperature: 4000, tint: 5 };
  const look = { panels: ['light', 'color'], recipe: { Exposure2012: -0.5, Contrast2012: 20, WhiteBalance: 'Custom', Temperature: 6000, Tint: 4, ToneCurvePV2012: [[0, 20], [255, 255]] } };
  const base = { Exposure2012: 0.8, Shadows2012: 10, Texture: 12, CropAngle: 3 };
  const full = lookOnto(base, look, shot);
  assert.deepEqual({ ...full, Temperature: undefined }, { Exposure2012: -0.5, Contrast2012: 20, Texture: 12, CropAngle: 3, WhiteBalance: 'Custom', Temperature: undefined, Tint: 9, ToneCurvePV2012: [[0, 20], [255, 255]] });
  assert.equal(full.Temperature, Math.round(1e6 / (1e6 / 4000 - (1e6 / 5500 - 1e6 / 6000))), 'as shot moved by the look’s mired');
  assert.deepEqual(lookOnto(base, look, shot, 0), base);
  const half = lookOnto(base, look, shot, 0.5);
  assert.deepEqual([half.Exposure2012, half.Contrast2012, half.Shadows2012, half.ToneCurvePV2012], [0.15, 10, 5, [[0, 10], [255, 255]]]);
  const twice = lookOnto(base, look, shot, 2);
  assert.deepEqual([twice.Exposure2012, twice.Contrast2012, twice.Tint], [-1.8, 40, 13]);
  assert.equal(lookOnto(base, { panels: ['effects'], recipe: { GrainAmount: 80 } }, shot, 2).GrainAmount, 100, 'held inside its range');
  const noWb = lookOnto({ WhiteBalance: 'Custom', Temperature: 5100, Tint: 2 }, { panels: ['color'], recipe: { Vibrance: 10 } }, shot);
  assert.deepEqual(noWb, { WhiteBalance: 'Custom', Temperature: 5100, Tint: 2, Vibrance: 10 }, 'a look with no white balance leaves the photo’s');
  // Saved from an edit, white balance relative: applied to the same photo as shot it gives the edit back.
  const mine = lookOf({ WhiteBalance: 'Custom', Temperature: 4500, Tint: 10, Exposure2012: 0.5, CropAngle: 2 }, ['light', 'color'], shot);
  assert.equal(mine.CropAngle, undefined);
  assert.deepEqual(lookOnto({}, { panels: ['light', 'color'], recipe: mine }, shot), { Exposure2012: 0.5, WhiteBalance: 'Custom', Temperature: 4500, Tint: 10 });
});
