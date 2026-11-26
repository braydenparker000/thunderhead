// MilkWidget: the player background. The reference renders it natively (GL):
// the visualisation and the blurred album-art backdrop (aa_blur: level 5,
// downscale 2^5, saturation 150%, intensity 100%). Before the blur, MilkLoader
// paints the bottom gradient (aa_bg_gradient, level 4 to #FF000000) into the
// art bitmap itself, so it is part of the image here too. The backdrop is the
// art blurred and saturated once into a small canvas (as the reference blurs a
// downscaled bitmap), which the page then only scales: a live CSS blur over the
// whole screen was filtered again on every frame a list scrolled over it. The
// native blur kernel is not reproducible, so the radius is an approximation.
// Where a canvas cannot filter, the art stays behind the same CSS filters.
import {View} from '../view/view.js';
import {register} from '../view/inflater.js';
import {colorToCss, parseColor} from '../res/values.js';
import {MilkRenderer} from './vis.js';
import {STATE_PLAYING} from '../player/player.js';
import {whenStill} from '../view/motion.js';

export class MilkWidget extends View {
  constructor(ctx, a) {
    super(ctx, a);
    const bg = a.color('bgColor');
    this.bgColor = bg?.color ?? 0xff000000;
    // aaBgColor (?colorAABgColor, white in the light skins): MilkLoader's
    // solid backdrop when a track has no art (its palette default, A).
    this.aaBgColor = (a.color('aaBgColor')?.color ?? 0xffffffff) | 0xff000000;
    this.blurSaturationMul = a.float('aaBlurSaturation', 1);
    this.blurIntensityMul = a.float('aaBlurIntensity', 1);
    this.layer = document.createElement('div');
    this.layer.className = 'milk-art';
    // The blurred art, drawn once a change (null: the CSS filters draw it).
    this.canvas = CANVAS_FILTER ? document.createElement('canvas') : null;
    if (this.canvas) { this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%'; this.layer.appendChild(this.canvas); }
    // The visualization draws over the backdrop while a vis mode is on and music plays.
    this.visCanvas = document.createElement('canvas');
    this.visCanvas.className = 'milk-vis';
    this.el.append(this.layer, this.visCanvas);
    this.renderer = new MilkRenderer(ctx, this.visCanvas);
    ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_gui_vis_mode_changed') this.syncVis(); });
    this.el.style.background = colorToCss(this.bgColor);
    this.art = null;
    ctx.bus.subscribe('bus_player', msg => {
      // The blurred art (a decode and a filter) changes once no transition moves (view/motion.js).
      if (msg === 'msg_player_track_changed') whenStill(ctx, () => this.setArt(ctx.player?.track?.art ?? null), this);
      else if (msg === 'msg_player_playing_state_changed') this.syncVis();
    });
    // The backdrop behind the library lists and the lyrics (i22: list_aa_blur_enabled /
    // lyrics_aa_blur_enabled; MilkWidget: aa_bg_gradient_for_list).
    this.place = 'main';
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg !== 'msg_nav_changed') return;
      const place = d.nav === 'nav_lyrics' ? 'lyrics' : d.nav === 'nav_lib' || d.nav === 'nav_search' ? 'list' : d.nav === 'nav_eq' ? 'eq' : 'main';
      if (place !== this.place) { this.place = place; this.invalidate(); this.syncVis(); }
    });
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg !== 'msg_app_setting_changed') return;
      if (/^(aa_blur|aa_bg|list_aa|lyrics_aa)/.test(d?.key)) this.invalidate();
      if (d?.key === 'vis_in_lib') this.syncVis();
    });
  }

  settings() {
    const s = this.ctx.settings, pref = k => !!this.ctx.pref(k);
    const where = this.place === 'list' ? pref('list_aa_blur_enabled') : this.place === 'lyrics' ? pref('lyrics_aa_blur_enabled') : true;
    return {
      enabled: (s.aa_blur_enabled ?? true) && where,
      listGradient: this.place !== 'list' || pref('aa_bg_gradient_for_list'),
      level: s.aa_blur ?? 5,
      scale: s.aa_blur_scale ?? 5,
      saturation: ((s.aa_blur_saturation ?? 150) / 100) * this.blurSaturationMul,
      intensity: ((s.aa_blur_intensity ?? 100) / 100) * this.blurIntensityMul,
      gradient: Math.max(0, Math.min(10, s.aa_bg_gradient ?? 4)),
      gradientColor: parseColor(String(s.aa_bg_gradient_color ?? '#FF000000').split('|')[0]) ?? 0xff000000,
    };
  }

  syncVis() {
    const ctx = this.ctx;
    // vis_in_lib (i22): the visualization goes on behind the library, search and lyrics.
    const here = this.place === 'main' || ((this.place === 'list' || this.place === 'lyrics') && !!ctx.pref('vis_in_lib'));
    const on = ctx.settings?.enable_vis !== false && (ctx.gui?.visMode ?? 0) !== 0 && ctx.player?.state === STATE_PLAYING && !!ctx.dsp?.nodes && here;
    this.visCanvas.style.display = on ? '' : 'none';
    if (on) this.renderer.start(); else this.renderer.stop();
  }

  setArt(art) {
    this.art = art;
    this.invalidate();
  }

  draw() {
    const st = this.settings();
    const url = st.enabled ? this.art?.url ?? null : null;
    const ls = this.layer.style;
    const gradient = url && st.gradient > 0 && st.listGradient ? artGradient(st.gradient, st.gradientColor) : null;
    // Downscale factor 2^scale approximated as a blur radius of a fraction of it.
    const radius = (1 << Math.min(st.scale, 9)) * 0.5 * (st.level / 5);
    if (this.canvas) this.paint(url, url && st.gradient > 0 && st.listGradient ? artGradientStops(st.gradient, st.gradientColor) : null, radius, st.saturation);
    else {
      const image = url ? (gradient ? `${gradient}, url("${url}")` : `url("${url}")`) : '';
      if (this._image !== image) {
        this._image = image;
        ls.backgroundImage = image;
        ls.backgroundSize = gradient ? '100% 100%, cover' : '';
      }
      ls.filter = url ? `blur(${radius.toFixed(1)}px) saturate(${st.saturation})` : '';
    }
    // Without art the backdrop is the skin's art background colour.
    ls.backgroundColor = url || !st.enabled ? '' : colorToCss(this.aaBgColor);
    ls.opacity = url ? String(Math.min(1, st.intensity)) : st.enabled ? '1' : '0';
  }
}

/** Whether a canvas can blur and saturate as it draws (Chrome, Firefox). */
const CANVAS_FILTER = typeof CanvasRenderingContext2D === 'function' && 'filter' in CanvasRenderingContext2D.prototype;

/**
 * The art, cover-fitted to the layer (the milk's size and 12% more each side, CSS px), the gradient over it,
 * blurred by `radius` CSS px and saturated, into the canvas at a quarter of the blur's scale or less: once for
 * each change of art, gradient, filter or size. Without art the canvas is empty.
 */
MilkWidget.prototype.paint = function (url, stops, radius, saturation) {
  const px = this.ctx.px, lw = px(this.width) * 1.24, lh = px(this.height) * 1.24;
  const key = url ? [url, JSON.stringify(stops), radius, saturation, Math.round(lw), Math.round(lh)].join('|') : '';
  if (key === this._paintKey) return;
  this._paintKey = key;
  const c = this.canvas;
  if (!url || !lw || !lh) { c.width = c.height = 0; return; }
  const img = new Image();
  img.src = url;
  img.decode().then(() => {
    if (this._paintKey !== key) return;
    const k = Math.min(0.5, 4 / Math.max(1, radius)), w = Math.max(1, Math.round(lw * k)), h = Math.max(1, Math.round(lh * k));
    const flat = document.createElement('canvas');
    flat.width = w; flat.height = h;
    const f = flat.getContext('2d'), s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    f.drawImage(img, (w - img.naturalWidth * s) / 2, (h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    if (stops) {
      const gr = f.createLinearGradient(0, 0, 0, h);
      for (const [color, at] of stops) gr.addColorStop(at, color);
      f.fillStyle = gr;
      f.fillRect(0, 0, w, h);
    }
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.filter = `blur(${(radius * k).toFixed(2)}px) saturate(${saturation})`;
    g.drawImage(flat, 0, 0);
  }, () => {});
};

/**
 * The gradient MilkLoader draws over the art (top to bottom of the image):
 * clear down to 0.75 → 0.1 of the height and the colour reached at 1 → 0.85
 * as the level goes 0 → 10. Black is opaque; another colour (its alpha
 * dropped) takes alpha 170 → 255 with the level. The platform interpolates
 * unpremultiplied from transparent black, so in-between stops darken too.
 */
export function artGradient(level, color) {
  return `linear-gradient(to bottom, ${artGradientStops(level, color).map(([c, at]) => `${c} ${(at * 100).toFixed(2)}%`).join(', ')})`;
}

/** The gradient's stops, top to bottom: [css colour, place 0..1]. */
export function artGradientStops(level, color) {
  const t = Math.max(0, Math.min(10, level)) / 10;
  const lerp = (a, b) => a + (b - a) * t;
  const start = lerp(0.75, 0.1), end = lerp(1, 0.85);
  const rgb = color & 0xffffff;
  const alpha = rgb ? Math.round(lerp(170, 255)) / 255 : 1;
  const r = (rgb >>> 16) & 255, g = (rgb >>> 8) & 255, b = rgb & 255;
  const stops = [['rgba(0,0,0,0)', start]];
  for (let k = 1; k <= 8; k++) {
    const u = k / 8;
    stops.push([`rgba(${Math.round(r * u)},${Math.round(g * u)},${Math.round(b * u)},${(alpha * u).toFixed(3)})`, start + (end - start) * u]);
  }
  return stops;
}

register(['MilkWidget'], MilkWidget);
