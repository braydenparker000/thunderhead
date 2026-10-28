// @ts-check
// What a sign-in tells the server about this device (SIGN-IN.md §5.2): platform, browser,
// model where Chromium shares it, and whether it runs as the installed app. Used only for the
// device list's default label; nothing here identifies the owner.

/** @typedef {import('../../shared/contract/api.ts').DeviceHints} DeviceHints */

/** @returns {Promise<DeviceHints>} */
export async function deviceHints() {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  /** @type {any} */
  const uad = /** @type {any} */ (navigator).userAgentData;
  if (uad?.getHighEntropyValues) {
    try {
      const v = await uad.getHighEntropyValues(['model', 'platformVersion']);
      const brand = (uad.brands ?? []).map((/** @type {{ brand: string }} */ b) => b.brand).find((/** @type {string} */ b) => !/Not.?A.?Brand|Chromium/i.test(b));
      return clean({ platform: uad.platform || undefined, browser: brand || 'Chrome', model: v.model || undefined, standalone });
    } catch {}
  }
  return clean({ ...fromUserAgent(navigator.userAgent), standalone });
}

/** @param {string} ua @returns {{ platform?: string, browser?: string }} */
export function fromUserAgent(ua) {
  const platform = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : undefined;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : undefined;
  return { platform, browser };
}

/** @param {DeviceHints} d @returns {DeviceHints} */
function clean(d) {
  /** @type {DeviceHints} */
  const out = {};
  if (d.platform) out.platform = d.platform.slice(0, 40);
  if (d.browser) out.browser = d.browser.slice(0, 40);
  if (d.model) out.model = d.model.slice(0, 40);
  if (d.standalone !== undefined) out.standalone = d.standalone;
  return out;
}
