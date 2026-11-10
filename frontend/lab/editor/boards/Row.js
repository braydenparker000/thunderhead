// @ts-nocheck
// The row beside a drum: what flew out of it. Each marking is engraved, paint-filled when chosen with a red bar
// under it, and starts at the drum and springs into place. It only shows what it is given.
// Props: `chips` [{ name, value, on, entry, aria, pad, swatch, dropper, pick }] (`entry`: a key that does something,
// boxed; `swatch`: a colour's dot; `dropper`: the picker's glyph), `label`, `seed` (which way they fly), `wide`.
import { DCLogic } from '../dc.js';

const DRUM_X = 50, LEFT = 98;   // the drum's middle and the row's start across the panel: where the markings fly out from

export default class Component extends DCLogic {
  renderVals() {
    let cx = LEFT;
    const chips = (this.props.chips || []).map((o, i) => {
      const pad = o.pad ?? 8, w = o.swatch ? 13 + 2 * pad : o.dropper ? 17 + 2 * pad : 2 * pad + Math.max(o.name.length, String(o.value ?? '').length * 0.8) * 7.6, mid = cx + w / 2; cx += w + 4;
      return { name: o.name.toUpperCase(), value: String(o.value ?? '').toUpperCase(), on: String(!!o.on), aria: o.aria ?? o.name, pad,
        ink: o.on ? '#f2efe8' : o.hot ? '#ff8a90' : o.entry ? '#c9ccd1' : '#80848a', valueInk: o.on ? '#e8202a' : (o.value === '0' ? '#4f5357' : '#6a6e73'), bar: o.on ? '#e8202a' : 'transparent',
        box: o.entry ? 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 2px rgba(0,0,0,0.6)' : 'none',
        isDot: !!o.swatch, dot: o.swatch || 'transparent', dotRing: o.on ? '0 0 0 2px #232525, 0 0 0 3.5px #f2efe8' : 'inset 0 1px 2px rgba(0,0,0,0.6)', isDropper: !!o.dropper,
        dx: (DRUM_X - mid).toFixed(0), delay: i * 26, anim: 'pop' + ((this.props.seed || 0) % 10), pick: o.pick || (() => {}) };
    });
    return { chips, label: this.props.label || 'Adjustments', wide: this.props.wide || 254 };
  }
}
