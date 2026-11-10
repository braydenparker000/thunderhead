// Prints the WGSL compiler's messages for the engine's shaders.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(2500);
  console.log(await p.evaluate(async () => {
    const { WGSL } = await import('/lab/engine/wgsl.js?' + Date.now()), d = await (await navigator.gpu.requestAdapter()).requestDevice(), out = [];
    const info = await d.createShaderModule({ code: WGSL }).getCompilationInfo(), lines = WGSL.split('\n');
    for (const m of info.messages.slice(0, 6)) out.push(`${m.type} line ${m.lineNum}:${m.linePos} ${m.message}\n   ${lines[m.lineNum - 1]?.slice(Math.max(0, m.linePos - 60), m.linePos + 80)}`);
    return out.join('\n') || 'compiles';
  }));
  await b.close();
})();
