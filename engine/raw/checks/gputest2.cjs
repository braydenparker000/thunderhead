const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await b.newPage(); await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/');
  console.log(await p.evaluate(async () => {
    const out = [];
    try {
      const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice();
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; document.body.append(c);
      const ctx = c.getContext('webgpu'); out.push('pref ' + navigator.gpu.getPreferredCanvasFormat());
      for (const fmt of ['rgba8unorm', 'bgra8unorm']) {
        try {
          ctx.configure({ device: d, format: fmt, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
          const t = d.createTexture({ size: [64, 64], format: fmt, usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
          const e = d.createCommandEncoder(); e.copyTextureToTexture({ texture: t }, { texture: ctx.getCurrentTexture() }, [64, 64]); d.queue.submit([e.finish()]);
          await d.queue.onSubmittedWorkDone(); out.push(fmt + ' ok');
        } catch (e) { out.push(fmt + ' ERR ' + e.message); }
      }
    } catch (e) { out.push('ERR ' + e.message); }
    return out.join(' | ');
  }));
  await b.close();
})();
