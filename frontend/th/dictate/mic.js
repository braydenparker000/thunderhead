// @ts-check
// The ask bar's mic (HOME.md §6.4): a tap records a voice memo, a hold dictates into the bar. Wired
// when the chat starts; the recorder itself (dictate.js) loads on the first press, so it is ready by
// the time a press becomes a hold (280 ms). Its listeners run in the capture phase, so home.js's
// signed-out toast never runs once the chat is here.
import { ApiError, TIMEOUT_MS } from '../api.js';
import { api, signedIn } from '../client.js';
import { toast } from '../ui.js';

/** A piece of what the owner is saying, for its words (`POST /v1/dictate`); kept nowhere.
 * @param {string} token @param {Blob} audio @returns {Promise<string>} */
async function hear(token, audio) {
  const res = await fetch(`${api.base}/v1/dictate`, {
    method: 'POST',
    headers: { 'TH-Client': api.client, Authorization: `Bearer ${token}`, 'Content-Type': audio.type || 'audio/webm' },
    body: audio,
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  /** @type {any} */
  const data = await res.json().catch(() => null);
  if (res.ok && typeof data?.text === 'string') return data.text;
  throw new ApiError(res.status, data?.error ?? { code: 'unavailable', message: `HTTP ${res.status}`, request_id: '' });
}

/** @param {{ mic: HTMLElement, ask: HTMLElement, q: HTMLTextAreaElement, memo: () => void }} bar */
export function wireMic({ mic, ask, q, memo }) {
  /** @type {Promise<typeof import('./dictate.js')> | null} */
  let ears = null;
  /** @type {{ stop: () => Promise<void> } | null} */
  let dictation = null;
  let held = false;
  /** The click a hold ends with is that hold's, not a tap. */
  let swallow = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let holding;
  const hearing = (/** @type {string} */ s) => {
    ask.classList.toggle('listening', s === 'listening');
    ask.classList.toggle('finishing', s === 'finishing');
    mic.setAttribute('aria-pressed', String(s === 'listening'));
    // The edge brightens while the microphone is open (PRIVACY.md §7.3), as for a memo.
    document.querySelector('#edge')?.classList.toggle('listen', s === 'listening');
    q.placeholder = s === 'listening' ? 'Listening…' : s === 'finishing' ? '…' : 'Ask anything';
  };
  mic.addEventListener('pointerdown', (e) => {
    if (e.button || dictation) return;
    const loading = (ears ??= import('./dictate.js'));
    held = false;
    swallow = false;
    try {
      mic.setPointerCapture(e.pointerId);
    } catch {}
    holding = setTimeout(async () => {
      held = true;
      const d = await loading;
      const before = q.value;
      dictation = d.listen({
        hear: (audio) => signedIn((tok) => hear(tok, audio)),
        onWords: (pieces) => {
          q.value = d.barText(before, pieces);
          q.dispatchEvent(new Event('input'));
        },
        onState: hearing,
        onEnd: (why) => {
          dictation = null;
          if (why === 'short') toast('Too short. Nothing was kept.');
          else if (why === 'denied') toast('Allow the microphone to dictate.');
          else if (why === 'deaf') toast("Couldn't hear that. Try again, or tap the mic for a voice memo.");
          else q.focus();
        },
      });
      if (!held) void dictation.stop();
    }, 280);
  });
  const lift = () => {
    clearTimeout(holding);
    if (!held) return;
    held = false;
    swallow = true;
    void dictation?.stop();
  };
  mic.addEventListener('pointerup', lift);
  mic.addEventListener('pointercancel', lift);
  mic.addEventListener('contextmenu', (e) => e.preventDefault());
  mic.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    if (swallow || dictation) {
      swallow = false;
      return;
    }
    memo();
  }, true);
}
