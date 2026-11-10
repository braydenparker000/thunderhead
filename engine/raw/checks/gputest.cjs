const { chromium } = require('playwright');
(async () => {
  for (const args of [['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'], ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']]) {
    const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
    const p = await b.newPage(); await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/');
    console.log(args.join(' '), await p.evaluate(async () => {
      try { const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice(); const buf = d.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST }); d.queue.writeBuffer(buf, 0, new Uint8Array(16)); await d.queue.onSubmittedWorkDone(); return 'ok ' + (a.info?.description || ''); } catch (e) { return 'ERR ' + e.message; }
    }));
    await b.close();
  }
})();
