// @ts-nocheck
// The row along the panel's foot, from its left end to the tool dial: a section's adjustments. Each marking is
// engraved, paint-filled when chosen with a red bar under it, and rises into place when its section comes round on the
// panel's barrel (boards/Barrel.js). It only shows what it is given.
// Props: `chips` [{ name, value, on, entry, aria, pad, swatch, dropper, pick }] (`entry`: a key that does something,
// boxed; `swatch`: a colour's dot; `dropper`: the picker's glyph), `label`, `seed` (a new one: they rise again), `wide`.
// Each is at least 44 wide and (by its hit box, editor.css `.hit`) 44 tall. Where the row runs on past an edge the
// markings fade there, so it shows there is more; scrolled to its end, the last one stands clear of the fade.
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  renderVals() {
    const chips = (this.props.chips || []).map((o, i) => {
      const pad = o.pad ?? 8;
      return { name: o.name.toUpperCase(), value: String(o.value ?? '').toUpperCase(), on: String(!!o.on), aria: o.aria ?? o.name, pad,
        ink: o.on ? '#f2efe8' : o.hot ? '#ff8a90' : o.entry ? '#c9ccd1' : '#80848a', valueInk: o.on ? '#e8202a' : (o.value === '0' ? '#4f5357' : '#6a6e73'), bar: o.on ? '#e8202a' : 'transparent',
        box: o.entry ? 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 2px rgba(0,0,0,0.6)' : 'none',
        isDot: !!o.swatch, dot: o.swatch || 'transparent', dotRing: o.on ? '0 0 0 2px #232525, 0 0 0 3.5px #f2efe8' : 'inset 0 1px 2px rgba(0,0,0,0.6)', isDropper: !!o.dropper,
        dx: '0', delay: i * 22, anim: 'pop' + ((this.props.seed || 0) % 10), pick: o.pick || (() => {}) };
    });
    // which edges it runs on past, read from the row once it is laid out (and as it scrolls)
    requestAnimationFrame(() => { const el = this._host?.el.firstElementChild; if (el) this.edge(el); });
    const more = this.state.more || '', fade = (side, px) => (more.includes(side) ? px : 0);
    return { chips, label: this.props.label || 'Adjustments', wide: this.props.wide || 316, more, scrolled: (e) => this.edge(e.currentTarget),
      mask: `linear-gradient(90deg, transparent 0, #000 ${fade('left', 22)}px, #000 calc(100% - ${fade('right', 40)}px), transparent 100%)` };
  }
  /** Notes which ends of the row have more past them ('left', 'right', both or neither). @param {HTMLElement} el */
  edge(el) {
    const more = [el.scrollLeft > 1 ? 'left' : '', el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? 'right' : ''].filter(Boolean).join(' ');
    if (more !== (this.state.more || '')) this.setState({ more });
  }
}
