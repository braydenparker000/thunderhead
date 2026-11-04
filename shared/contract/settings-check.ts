// The catalogue's checks (settings.ts): whether a value is one a setting allows, and why a calendar
// link can't be kept. The Worker's PATCH and the phone's reads both hold to them.
import type { SettingSpec, SettingValue } from './settings.ts';

/** Why a calendar link can't be kept, in the owner's words, or null when it can (BRIEFING.md "Today",
 * SECURITY.md: the Worker fetches only public https addresses). The Worker's PATCH refuses with this
 * reason; the phone's Settings row (catalog.js linkProblem) says the same before it sends. */
export function linkProblem(url: string, max = 512): string | null {
  if (url.length > max) return `That link is over ${max} characters.`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'That is not a link.';
  }
  if (u.protocol !== 'https:') return 'Only https links (a webcal link works with https in its place).';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.username || u.password || u.port) return 'A link with a user, password or port is not supported.';
  if (
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    host.includes('[') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion|arpa)$/.test(host) ||
    /(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host)
  )
    return 'Only a public address, not a local or numeric one.';
  return null;
}

/** Whether `value` is one `spec` allows: the Worker's PATCH and the phone's reads both hold to it. */
export function validSetting(spec: SettingSpec, value: unknown): value is SettingValue {
  const allowed = (spec.options ?? []).map((o) => o.value);
  switch (spec.kind) {
    case 'switch':
      return typeof value === 'boolean';
    case 'choice':
      return typeof value === 'string' && allowed.includes(value);
    case 'range':
      return typeof value === 'number' && allowed.includes(value);
    case 'order':
      return (
        Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((v) => typeof v === 'string' && allowed.includes(v))
      );
    case 'text':
      return (
        typeof value === 'string' &&
        value.length <= (spec.max ?? 200) &&
        (spec.pattern === undefined || new RegExp(spec.pattern).test(value))
      );
    case 'links':
      return (
        Array.isArray(value) &&
        value.length <= (spec.items ?? 3) &&
        new Set(value.map((l) => l?.url)).size === value.length &&
        value.every(
          (l) =>
            l !== null &&
            typeof l === 'object' &&
            Object.keys(l).sort().join() === 'mine,url' &&
            typeof l.mine === 'boolean' &&
            typeof l.url === 'string' &&
            linkProblem(l.url, spec.max) === null,
        )
      );
  }
}
