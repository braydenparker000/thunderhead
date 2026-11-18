// The editor's board runtime (frontend/lab/editor/dc.js): a node keeps its identity whatever comes and goes beside it.
// Matched by its place among its siblings, everything after a part that came or went (an sc-if) was made again: a
// board's swipe-taker twice on its panel, a key measured as it was replaced (2026-11-18). A board of the test's own, on
// a blank page of the site's origin; no photo, no GPU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only', timeout: 60_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

const PAGE = `<!doctype html><meta charset="utf-8"><div id="stage"></div>
<template data-dc="Probe"><div>
  <sc-if value="{{a}}"><p class="a">A</p><p class="a2">A too</p></sc-if>
  <button class="key" onClick="{{tap}}">{{label}}</button>
  <sc-for list="{{items}}" as="it"><span class="it">{{it}}</span><sc-if value="{{a}}"><i>·</i></sc-if></sc-for>
  <dc-import name="Child" hint-size="1px,1px"></dc-import>
</div></template>
<template data-dc="Child"><b class="child">{{n}}</b></template>
<script type="module">
  import { mount } from '/lab/editor/dc.js';
  await mount(document.getElementById('stage'), 'Probe');
  window.ready = true;
</script>`;
const PROBE = `import { DCLogic } from '../dc.js';
export default class Component extends DCLogic {
  constructor(p) { super(p); this.state = { a: false, label: 'Key', items: ['x', 'y'] }; window.probe = this; }
  renderVals() { return { ...this.state, tap: () => {} }; }
}`;
const CHILD = `import { DCLogic } from '../dc.js';
let made = 0;
export default class Component extends DCLogic {
  constructor(p) { super(p); this.id = ++made; window.children = made; }
  renderVals() { return { n: String(this.id) }; }
}`;

test('a node keeps its identity when a part before it comes or goes, and a list keeps its own', opts, async () => {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${base}/dc-probe.html`, (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.route(`${base}/lab/editor/boards/Probe.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: PROBE }));
  await page.route(`${base}/lab/editor/boards/Child.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: CHILD }));
  await page.goto(`${base}/dc-probe.html`);
  await page.waitForFunction(() => window.ready);
  const seen = await page.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0)), $ = (s) => document.querySelector(`#stage ${s}`);
    const key = $('.key'), spans = [...document.querySelectorAll('#stage .it')], child = $('.child');
    key.focus();
    const out = [];
    for (const a of [true, false, true]) {
      window.probe.setState({ a, label: a ? 'Key on' : 'Key' }); await tick();
      out.push({ a, key: $('.key') === key, focused: document.activeElement === key, label: key.textContent, spans: [...document.querySelectorAll('#stage .it')].every((s, i) => s === spans[i]),
        child: $('.child') === child, children: window.children, shown: [...document.querySelectorAll('#stage p, #stage i')].length });
    }
    window.probe.setState({ items: ['x', 'y', 'z'] }); await tick();
    const grown = [...document.querySelectorAll('#stage .it')];
    window.probe.setState({ items: ['x'] }); await tick();
    return { out, grew: grown.length === 3 && grown[0] === spans[0] && grown[1] === spans[1], shrunk: [...document.querySelectorAll('#stage .it')].map((s) => s.textContent).join(), kept: $('.it') === spans[0], order: [...$('div').children].map((e) => e.className || e.localName).join(' ') };
  });
  for (const o of seen.out) assert.deepEqual({ key: o.key, focused: o.focused, spans: o.spans, child: o.child, children: o.children }, { key: true, focused: true, spans: true, child: true, children: 1 }, `with the part ${o.a ? 'shown' : 'gone'}: the same key, still focused, the same list, the same child board`);
  assert.deepEqual(seen.out.map((o) => [o.label, o.shown]), [['Key on', 4], ['Key', 0], ['Key on', 4]], 'and each drawn as asked');
  assert.equal(seen.grew, true, 'a list grown keeps the items it had'); assert.equal(seen.shrunk, 'x'); assert.equal(seen.kept, true);
  assert.equal(seen.order, 'a a2 key it i dc-host', 'in the template\'s order');
  assert.deepEqual(errors, []);
  await page.close();
});
