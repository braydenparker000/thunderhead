// @ts-nocheck
// A strip of small pictures in the panel, each the open photo drawn another way (a profile, a look): a tap picks
// one, a sideways drag scrolls. It lies in the panel, never over the photo. It only shows what it is given.
// Props: `tiles` [{ name, src, on, tag, filter, glyph, pick }], `label`, `onnear` (told the last tile in sight as
// the strip is scrolled, so a long strip's pictures are made as they come near).
import { DCLogic } from '../dc.js';

export default class Component extends DCLogic {
  renderVals() {
    const tiles = (this.props.tiles || []).map((t) => ({ name: t.name, src: t.src || '/lab/editor/assets/sample.jpg', filter: t.filter || 'none', on: String(!!t.on), tag: t.tag || '', tagShow: t.tag ? 'block' : 'none',
      glyph: t.glyph || '', glyphShow: t.glyph ? 'flex' : 'none', imgShow: t.glyph ? 'none' : 'block', ring: t.on ? '#e8202a' : 'rgba(255,255,255,0.16)', ringW: t.on ? 2 : 1, ink: t.on ? '#f2efe8' : '#a6b0bc', pick: t.pick || (() => {}) }));
    // the one that is on comes to the strip's middle when the strip opens and when another is put on
    const key = `${this.props.label}|${tiles.findIndex((t) => t.on === 'true')}|${!tiles.length}`;
    // (a strip under another name with none on starts from its left again)
    if (key !== this.key) { const named = this.key?.split('|')[0]; this.key = key; requestAnimationFrame(() => { const box = this._host?.el.firstElementChild, t = box?.querySelector('[aria-selected="true"]'); if (t) box.scrollTo({ left: t.offsetLeft - (box.clientWidth - t.offsetWidth) / 2, behavior: 'smooth' }); else if (box && named !== undefined && named !== (this.props.label || '')) box.scrollTo({ left: 0 }); }); }
    if (this.props.onnear) requestAnimationFrame(() => { const box = this._host?.el.firstElementChild; if (!box || box === this.box) return; this.box = box; box.addEventListener('scroll', () => this.props.onnear?.(Math.ceil((box.scrollLeft + box.clientWidth) / 92)), { passive: true }); });
    return { tiles, label: this.props.label || 'Looks', none: !tiles.length, empty: this.props.empty || '' };
  }
}
