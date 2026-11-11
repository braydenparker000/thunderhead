// Makes the engine's reference pictures again: node engine/raw/checks/ref.cjs   (the site served on 8080, or BASE)
// Runs the test bench's picture check (frontend/lab/engine/bench.js) on the software GPU and writes what the known
// photo came to into frontend/lab/engine/bench-ref.json. Do this only when a change is meant to change a picture,
// and say in the commit what moved and why: tests/lab-engine-pictures-browser.test.mjs holds every other change to it.
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const ABOUT = 'What the known photo (known.js) comes to on the reference GPU (SwiftShader, the software GPU CI runs): bench.js compares a phone against these. Made again, on purpose, whenever a change to the engine is meant to change the picture: node engine/raw/checks/ref.cjs';
(async () => {
  const b = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();   // no worker: the page then never reloads itself
  p.on('pageerror', (e) => console.log('page error:', e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
  await p.waitForSelector('html[data-bench=ready]');
  await p.click('#bcheck');
  await p.waitForFunction(() => /^(Done|Stopped)/.test(document.getElementById('bnow').textContent), null, { timeout: 300000 });
  const run = await p.evaluate(() => window.__bench);
  console.log(await p.textContent('#bout'));
  await b.close();
  if (!run.shots) throw new Error('the check did not finish');
  const json = JSON.stringify({ about: ABOUT, gpu: run.gpu, shots: run.shots }).replace(/"(demosaic|faster|sharpened|denoised|frame|edited)":/g, '\n"$1":').replace(/\}\}$/, '}\n}');
  fs.writeFileSync(path.join(__dirname, '../../../frontend/lab/engine/bench-ref.json'), json + '\n');
  console.log('wrote bench-ref.json');
})();
