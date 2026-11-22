// The mocked Worker's voice page (shared/contract/voice.ts) for Settings › The mind's "How I talk":
// versions kept newest last, the page the newest (else a stand-in default), PUT from the owner,
// restore as a new version, and the page limit with the Worker's words. Invented text only.
export const VOICE_START = 'Warm and plain.\nQuick by default.';

/** @param {{ versions?: object[], fail?: boolean }} [o] */
export function voiceState(o = {}) {
  return { versions: o.versions ?? [], fail: o.fail ?? false, puts: [] };
}

const info = (v) => ({ id: v.id, at: v.at, by: v.by, why: v.why, chars: v.text.length });
const page = (s) => {
  const last = s.versions.at(-1) ?? null;
  return { text: last?.text ?? VOICE_START, last: last && info(last), versions: s.versions.slice(-20).reverse().map(info) };
};
const add = (s, text, why) => {
  const n = s.versions.length + 1;
  s.versions.push({ id: `0192f0c4-0000-7000-8000-${String(n).padStart(12, '0')}`, at: Date.parse('2026-11-20T09:00:00Z') + n * 3_600_000, by: 'owner', why, text });
};
const err = (status, code, details) => [status, { error: { code, message: code, request_id: 't', ...(details ? { details } : {}) } }];

/** @returns {[number, unknown] | null} */
export function voiceAnswer(s, method, p, body) {
  if (!p.startsWith('/v1/mind/voice')) return null;
  if (s.fail) return err(503, 'unavailable');
  if (method === 'GET' && p === '/v1/mind/voice') return [200, page(s)];
  const one = /^\/v1\/mind\/voice\/([0-9a-f-]{36})$/.exec(p)?.[1];
  if (method === 'GET' && one) {
    const v = s.versions.find((x) => x.id === one);
    return v ? [200, { ...info(v), text: v.text }] : err(404, 'not_found');
  }
  if (method === 'PUT' && p === '/v1/mind/voice') {
    s.puts.push(body);
    const text = String(body?.text ?? '').replace(/\s+$/, '');
    if (text.length > 4000) return err(422, 'validation', [{ path: 'text', issue: `the page has ${text.length} characters (at most 4,000)` }]);
    add(s, text, null);
    return [200, page(s)];
  }
  if (method === 'POST' && p === '/v1/mind/voice/restore') {
    const v = s.versions.find((x) => x.id === body?.id);
    if (!v) return err(404, 'not_found');
    add(s, v.text, 'an earlier version again');
    return [200, page(s)];
  }
  return null;
}
