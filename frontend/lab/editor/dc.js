// @ts-nocheck
// A small runtime for the editor's design boards (docs/design/EDITOR.md, docs/design/editor/boards/):
// the boards' markup lives in <template data-dc="Name"> on the page and their logic in boards/Name.js,
// so the lab plays them exactly as designed under the site's CSP (no inline scripts, no eval). It knows
// the canvas's small template language: {{path}} in text and attributes, on<Event>="{{fn}}", <sc-for
// list as>, <sc-if value>, <dc-import name ...props>. Each render builds a light tree and patches the
// DOM in place, so elements keep their identity (pointer capture survives a drag). An element marked
// data-keep is filled by the app, not the board (the editor's photo).

export class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; this._host = null; }
  setState(patch) {
    this.state = { ...this.state, ...patch };
    if (this._host && !this._queued) { this._queued = true; queueMicrotask(() => { this._queued = false; this._host.render(); }); }
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
    if (n.nodeType === 3) { if (n.data.trim() || /\{\{/.test(n.data)) out.push({ text: String(value(n.data, scope) ?? '') }); else if (n.data.length) out.push({ text: ' ' }); continue; }
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
      out.push({ comp: n.getAttribute('name'), props });
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
    out.push({ tag, ns: n.namespaceURI === SVG ? SVG : null, attrs, on, kids: build(n.childNodes, scope) });
  }
  return out;
}

function make(v) {
  if ('text' in v) return document.createTextNode(v.text);
  if (v.comp) { const h = document.createElement('dc-host'); h.style.display = 'contents'; return h; }
  return v.ns ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
}
const fits = (d, v) => ('text' in v ? d.nodeType === 3 : v.comp ? d.localName === 'dc-host' && d._comp === v.comp : d.nodeType === 1 && d.localName === v.tag && (d.namespaceURI === SVG) === !!v.ns);

function patch(parent, list) {
  list.forEach((v, i) => {
    let d = parent.childNodes[i];
    if (!d || !fits(d, v)) { const fresh = make(v); d ? parent.replaceChild(fresh, d) : parent.appendChild(fresh); d = fresh; }
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
  while (parent.childNodes.length > list.length) parent.removeChild(parent.lastChild);
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
