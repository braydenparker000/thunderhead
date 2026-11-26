// Room for the floating toolbar (power-list.js placeBottomToolbar: the header's buttons, or Home's ⋮
// alone, over the mini player once the header has scrolled away). On the v2 screens no row or tile
// lies under it: while it shows, the list's rows fade out over 24 dp above its buttons, so the last
// rows in view end clear of them, as they do at the list's end; the buttons themselves stay drawn.
// One CSS mask on the list, written only when the toolbar moves or fades (not while it rests).

const FADE_DP = 24, GAP_DP = 6;

/** Whether a list's rows keep clear of the toolbar: the v2 roots and the v2 layout's lists. */
export const keepsRoom = s => !!(s?.isHomeV2 || s?.isLibraryV2 || s?.v2List);

export function installBottomRoom(ctx) {
  const list = ctx.listWidget?.libList;
  if (!list) return;
  let key = '';
  const set = (value, size = '', pos = '') => {
    const st = list.el.style;
    st.maskImage = st.webkitMaskImage = value;
    st.maskSize = st.webkitMaskSize = size;
    st.maskPosition = st.webkitMaskPosition = pos;
    st.maskRepeat = st.webkitMaskRepeat = value ? 'no-repeat' : '';
  };
  list.roomFor = (src, t) => {
    const v = list.toolbarView;
    if (!t || !keepsRoom(src) || !v || !list.height) {
      if (key) { key = ''; set(''); }
      return;
    }
    // The shown buttons' boxes, in the list (the toolbar row scales about its centre as it comes in).
    const s = v.scaleX || 1, W = list.width, cx = W / 2, cy = t.top + t.size / 2, boxes = [];
    for (const b of v.children ?? []) {
      if (b.visibility !== 0 || !b.width || !(b.clickable || b.longClickable) || b.alpha === 0) continue;
      const x = b.left + (b.translationX || 0), y = b.top + (b.translationY || 0);
      boxes.push([cx + (x - cx) * s, cy + (y - t.size / 2) * s, b.width * s, b.height * s].map(Math.round));
    }
    if (!boxes.length) { if (key) { key = ''; set(''); } return; }
    const px = ctx.px, dp = n => Math.round(n * ctx.dpr);
    const edge = Math.min(...boxes.map(b => b[1])) - dp(GAP_DP), a = Math.round((1 - t.alpha) * 100) / 100;
    const next = `${edge}|${a}|${boxes.join(';')}|${list.height}`;
    if (next === key) return;
    key = next;
    // Each button's window is its own shape: a rounded box as round as it is high (circles, pills).
    const pill = b => { const w = px(b[2]), h = px(b[3]); return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3Crect width='${w}' height='${h}' rx='${Math.min(w, h) / 2}'/%3E%3C/svg%3E")`; };
    const layers = [`linear-gradient(to bottom,#000 ${px(edge - dp(FADE_DP))}px,rgba(0,0,0,${a}) ${px(edge)}px)`, ...boxes.map(pill)];
    set(layers.join(','), ['100% 100%', ...boxes.map(b => `${px(b[2])}px ${px(b[3])}px`)].join(','), ['0 0', ...boxes.map(b => `${px(b[0])}px ${px(b[1])}px`)].join(','));
  };
}
