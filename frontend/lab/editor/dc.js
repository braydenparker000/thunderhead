// @ts-nocheck
// A small runtime for the editor's design boards (docs/design/EDITOR.md, docs/design/editor/boards/):
// the boards' markup lives in <template data-dc="Name"> on the page and their logic in boards/Name.js,
// so the lab plays them exactly as designed under the site's CSP (no inline scripts, no eval). It knows
// the canvas's small template language: {{path}} in text and attributes, on<Event>="{{fn}}", <sc-for
// list as>, <sc-if value>, <dc-import name ...props>. Each render builds a light tree and patches the
// DOM in place, so elements keep their identity (pointer capture survives a drag), each matched to the template node it
// was made from, whatever comes and goes beside it. An element marked
// data-keep is filled by the app, not the board (the editor's photo).

const kept = /** @type {Record<string, any>} */ ({});   // what boards asked to have kept, by name, while the page lives
export class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; this._host = null; }
  /** A board finds itself as it was left: called in its constructor once `this.state` is set, this puts back what was
   * kept under `name` and keeps those keys from then on (the section it was on, the control, a brush's size). */
  keep(name, keys) { this._keep = [name, keys]; Object.assign(this.state, kept[name] || {}); }
  setState(patch) {
    this.state = { ...this.state, ...patch };
    if (this._keep) kept[this._keep[0]] = Object.fromEntries(this._keep[1].map((k) => [k, this.state[k]]));
    if (this._host && !this._queued) { this._queued = true; queueMicrotask(() => { this._queued = false; performance.mark('th:board'); this._host.render(); }); }
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const ONE = /^\{\{\s*([^}]+?)\s*\}\}$/;

function look(expr, scope) {
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  let v = scope;
  for (const k of expr.split('.')) { if (v == null) return undefined; v = v[k]; }
  return v;
}
const value = (text, scope) => { const m = ONE.exec(text); return m ? look(m[1], scope) : text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => { const v = look(e, scope); return v == null ? '' : String(v); }); };

/** The template's nodes to a light tree for this scope. */
function build(nodes, scope, out = []) {
  for (const n of nodes) {
    if (n.nodeType === 3) { if (n.data.trim() || /\{\{/.test(n.data)) out.push({ key: n, text: String(value(n.data, scope) ?? '') }); else if (n.data.length) out.push({ key: n, text: ' ' }); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.localName;
    if (tag === 'sc-for') {
      const list = value(n.getAttribute('list'), scope) || [], as = n.getAttribute('as');
      list.forEach((item) => build(n.childNodes, { ...scope, [as]: item }, out));
      continue;
    }
    if (tag === 'sc-if') { if (value(n.getAttribute('value'), scope)) build(n.childNodes, scope, out); continue; }
    if (tag === 'dc-import') {
      const props = {};
      for (const a of n.attributes) if (a.name !== 'name' && !a.name.startsWith('hint-')) props[a.name] = value(a.value, scope);
      out.push({ key: n, comp: n.getAttribute('name'), props });
      continue;
    }
    const attrs = {}, on = {};
    for (const a of n.attributes) {
      if (a.name.startsWith('hint-')) continue;
      if (/^on[a-z]+$/.test(a.name)) { on[a.name.slice(2)] = value(a.value, scope); continue; }
      const v = value(a.value, scope);
      if (v === false || v == null) continue;
      attrs[a.name] = String(v);
    }
    out.push({ key: n, tag, ns: n.namespaceURI === SVG ? SVG : null, attrs, on, kids: build(n.childNodes, scope) });
  }
  return out;
}

function make(v) {
  if ('text' in v) return document.createTextNode(v.text);
  if (v.comp) { const h = document.createElement('dc-host'); h.style.display = 'contents'; return h; }
  return v.ns ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
}
const fits = (d, v) => ('text' in v ? d.nodeType === 3 : v.comp ? d.localName === 'dc-host' && d._comp === v.comp : d.nodeType === 1 && d.localName === v.tag && (d.namespaceURI === SVG) === !!v.ns);

// Each node on the page is matched to the template's node it was made from (its `key`; in a list, the k-th made from it),
// not to its place among its siblings: so a part that comes or goes (an sc-if) leaves the nodes after it as they were. By
// place, everything after it was made again (a board's swipe-taker twice on its panel, a key measured as it was replaced:
// 2026-11-18). What is no longer drawn goes first, so what stays is never moved (a move loses focus and pointer capture).
function patch(parent, list) {
  const kids = parent.childNodes;
  let same = kids.length === list.length;
  for (let i = 0; same && i < list.length; i++) same = kids[i]._key === list[i].key && fits(kids[i], list[i]);   // (nothing came or went: as it stands, as most draws are)
  let found = null;
  if (!same) {
    const pool = new Map();
    for (const d of kids) { const a = pool.get(d._key); if (a) a.push(d); else pool.set(d._key, [d]); }
    found = list.map((v) => { const d = pool.get(v.key)?.shift(); return d && fits(d, v) ? d : null; });
    const keep = new Set(found);
    for (const d of [...kids]) if (!keep.has(d)) parent.removeChild(d);
  }
  list.forEach((v, i) => {
    let d = same ? kids[i] : found[i];
    if (!d) { d = make(v); d._key = v.key; }
    if (parent.childNodes[i] !== d) parent.insertBefore(d, parent.childNodes[i] || null);
    if ('text' in v) { if (d.data !== v.text) d.data = v.text; return; }
    if (v.comp) { mountChild(d, v); return; }
    const had = d._attrs || {};
    for (const k in had) if (!(k in v.attrs)) d.removeAttribute(k);
    for (const k in v.attrs) if (had[k] !== v.attrs[k]) d.setAttribute(k, v.attrs[k]);
    d._attrs = v.attrs;
    d._on = v.on;
    for (const type in v.on) if (!(d._bound || (d._bound = {}))[type]) { d._bound[type] = 1; d.addEventListener(type, (e) => d._on[type]?.(e)); }
    // data-keep: the app fills this element itself (the developed photo); announce it once, never patch inside
    if ('data-keep' in v.attrs) { if (!d._kept) { d._kept = true; document.dispatchEvent(new CustomEvent('dc:keep', { detail: d })); } return; }
    patch(d, v.kids);
  });
}

const classes = {};
async function load(name) { return classes[name] || (classes[name] = (await import(`./boards/${name}.js`)).default); }

function mountChild(host, v) {
  host._comp = v.comp;
  if (!host._inst) { const C = classes[v.comp]; host._inst = new Host(host, C, v.comp, v.props); host._inst.render(); return; }
  host._inst.c.props = v.props;
  host._inst.render();
}

class Host {
  constructor(el, C, name, props) { this.el = el; this.c = new C(props); this.c._host = this; this.tpl = document.querySelector(`template[data-dc="${name}"]`); }
  /** A board the app has replaced (another mounted on its element) or removed: it must not draw again. */
  get stale() { return !this.el.isConnected || (this.el._root !== undefined && this.el._root !== this); }
  render() { if (!this.stale) patch(this.el, build(this.tpl.content.childNodes, this.c.renderVals())); }
}

/** Mount the page's main board (and preload what it imports) into the element. */
export async function mount(el, name) {
  for (const t of document.querySelectorAll('template[data-dc]')) await load(t.dataset.dc);
  el._comp = name;
  const h = new Host(el, classes[name], name, {});
  el._root = h;
  h.render();
}
