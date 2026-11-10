const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const files = process.argv.slice(3), out = process.argv[2];
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:1fr 1fr;gap:4px">${files.map((f) => `<img style="width:100%" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">`).join('')}</body>`;
  await p.setContent(html); await p.waitForTimeout(500);
  await p.screenshot({ path: out, fullPage: true }); await b.close();
})();
