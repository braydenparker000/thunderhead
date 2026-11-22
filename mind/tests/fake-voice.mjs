// The fake Worker's voice page routes (shared/contract/voice.ts), close enough to drive `th voice`:
// the page (a stand-in default until written), a strict body, the page and why limits with the
// Worker's words, and the mind's edit refused after outside text. The real rules are the Worker's
// own tests (backend/tests/integration/voice.test.ts).
import {HttpError} from './fake-worker.mjs';

export const FAKE_DEFAULT = 'Warm and plain. Quick by default.';

/** @param {any} ctl the fake's control object */
export function voiceRoutes(ctl) {
  const s = ctl.state;
  s.voice = [];
  const page = () => {
    const last = s.voice.at(-1) ?? null;
    const info = v => ({id: v.id, at: v.at, by: v.by, why: v.why, chars: v.text.length});
    return {text: last?.text ?? FAKE_DEFAULT, last: last && info(last), versions: s.voice.slice(-20).reverse().map(info)};
  };
  const bad = issue => new HttpError(422, 'validation', 'validation', [{path: 'text', issue}]);
  return [
    ['GET', /^\/v1\/mind\/voice$/, ['chat', 'night', 'reflex'], () => page()],
    ['PUT', /^\/v1\/mind\/voice$/, ['chat'], ({body, session}) => {
      if (Object.keys(body).some(k => !['text', 'why'].includes(k))) throw new HttpError(422, 'validation');
      if (s.tainted.has(session)) throw new HttpError(403, 'session_tainted');
      const text = String(body.text ?? '').replace(/\s+$/, '');
      if (!text.trim()) throw bad('the page is empty (1 to 4,000 characters)');
      if (text.length > 4000) throw bad(`the page has ${text.length} characters (at most 4,000)`);
      const why = String(body.why ?? '').trim();
      if (why.length < 8 || why.length > 200) throw bad(`the why has ${why.length} characters (8 to 200)`);
      s.voice.push({id: `0192f0c4-0000-7000-8000-${String(s.voice.length + 1).padStart(12, '0')}`, at: ctl.now(), by: 'mind', why, text});
      return page();
    }],
  ];
}
