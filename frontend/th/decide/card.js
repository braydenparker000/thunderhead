// The decision card on home (HOME.md §3): one card at a time, 18 px under the voice line, the
// waiting decision that expires soonest first. Yes approves with this device's session; the second
// button turns the card down or puts it off until the morning, as the card says. The Worker checks
// and runs everything; the card only asks. A tap within 500 ms of the page appearing is ignored
// (SECURITY.md §4.3, a framed overlay can't time a tap onto it) and nothing is sent offline. The
// bottom edge is gold while a card shows; while it is scrolled out of view the date line says
// "· 1 waiting", and a tap there brings it back. The card follows the change feed (`th:changed`).
import { api, signedIn } from '../client.js';
import { failure } from '../flow.js';
import { el, toast, tooSoon } from '../ui.js';
import * as m from './model.js';
import { setDecisions } from './state.js';

/** @typedef {import('../../../shared/contract/api').Proposal} Proposal */

const DECIDE_TIMEOUT_MS = 15_000;
const FOLD_MS = 650;
const RISE_GAP_MS = 300;
const buzz = (/** @type {number[]} */ p) => {
  try {
    navigator.vibrate?.(p);
  } catch {}
};

/** Lights the gold edge while any card that needs the owner is on home (a decision or a notice). */
export function glow() {
  const lit = document.querySelector('#convo .card.notice:not(.gone), #decision .card:not(.gone)') !== null;
  document.querySelector('#edge')?.classList.toggle('gold', lit);
}

export function startDecisions() {
  const say = document.querySelector('#say');
  const convo = document.querySelector('#convo');
  if (!say || !convo) return;
  const slot = el('div', { id: 'decision' });
  say.after(slot);
  const waitingBtn = el('button', { type: 'button', class: 'waiting', id: 'waiting', hidden: '' });
  document.querySelector('#date')?.after(waitingBtn);

  /** @type {Proposal[]} */
  let items = [];
  /** @type {{ el: HTMLElement, id: string, of: HTMLElement } | null} */
  let shown = null;
  let busy = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  async function load() {
    try {
      items = (await signedIn((t) => api.proposals(t))).items;
    } catch {
      return; // the cards on screen stay as they were; the next change or visit tries again
    }
    render();
  }

  function render() {
    const now = Date.now();
    const show = m.showing(items, now);
    setDecisions({ waiting: show.length });
    clearTimeout(timer);
    const next = m.nextChange(items, now);
    if (next !== null && next - now < 86_400_000) timer = setTimeout(render, next - now + 50);
    if (busy) return;
    const first = show[0] ?? null;
    if (shown && first?.id === shown.id) {
      shown.of.textContent = m.ofLine(0, show.length);
      return glow();
    }
    if (shown) {
      const gone = items.find((p) => p.id === shown?.id);
      if (gone && gone.expires_at <= now) toast(m.LINES.expired);
      fold(shown.el);
      shown = null;
      if (first) setTimeout(() => place(first, show.length), FOLD_MS + RISE_GAP_MS);
    } else if (first) place(first, show.length);
    glow();
  }

  /** @param {Proposal} p @param {number} n */
  function place(p, n) {
    if (shown || busy) return;
    const b = m.buttons(p);
    const qid = `q-${p.id}`;
    const yes = el('button', { type: 'button', class: 'yes', text: b.yes });
    const safe = el('button', { type: 'button', text: b.safe });
    const of = el('span', { class: 'of', text: m.ofLine(0, n) });
    const err = el('div', { class: 'err', role: 'alert', hidden: '' });
    const card = el('div', { class: 'card decision', role: 'group', 'aria-labelledby': qid, 'data-id': p.id }, [
      el('div', { class: 'why' }, [el('span', { class: 'd' }), m.whyLine(p), of]),
      el('div', { class: 'q', id: qid, text: p.question }),
      ...m.details(p).map((t) => el('div', { class: 'dx', text: t })),
      el('div', { class: 'decide' }, [yes, safe]),
      err,
    ]);
    yes.addEventListener('click', () => decide(p, 'approve', yes, [yes, safe], err));
    safe.addEventListener('click', () => decide(p, b.safeDecision, safe, [yes, safe], err));
    slot.append(card);
    shown = { el: card, id: p.id, of };
    watch(card);
    glow();
  }

  /** @param {Proposal} p @param {'approve' | 'reject' | 'snooze'} decision @param {HTMLElement} pressed
   * @param {HTMLButtonElement[]} both @param {HTMLElement} err */
  async function decide(p, decision, pressed, both, err) {
    if (busy || tooSoon()) return;
    if (!navigator.onLine) return toast(m.LINES.offline);
    busy = true;
    err.hidden = true;
    pressed.classList.add('busy');
    for (const b of both) b.disabled = true;
    try {
      const r = await Promise.race([
        signedIn((t) => api.decide(t, p.id, { decision, spec_hash: p.spec_hash })),
        new Promise((_, reject) => setTimeout(() => reject(new DOMException('slow', 'TimeoutError')), DECIDE_TIMEOUT_MS)),
      ]);
      if (decision === 'approve') buzz([12, 40, 12]);
      toast(m.toastFor(decision, r));
      setDecisions({ answered: m.answered(decision, r) });
      settle(p.id);
    } catch (e) {
      const f = failure(e);
      if (m.settled(f.code ?? undefined)) {
        if (f.code === 'expired') toast(m.LINES.expired);
        settle(p.id);
      } else {
        err.textContent = m.LINES.error;
        err.hidden = false;
        for (const b of both) b.disabled = false;
        buzz([30, 60, 30]);
      }
    } finally {
      pressed.classList.remove('busy');
      busy = false;
    }
    void load();
  }

  /** The card is done with: it folds, and the next one rises after it. @param {string} id */
  function settle(id) {
    items = items.filter((x) => x.id !== id);
    if (shown?.id === id) {
      fold(shown.el);
      shown = null;
    }
    const first = m.showing(items, Date.now())[0];
    setDecisions({ waiting: m.showing(items, Date.now()).length });
    if (first) setTimeout(() => place(first, m.showing(items, Date.now()).length), FOLD_MS + RISE_GAP_MS);
    glow();
  }

  /** @param {HTMLElement} card */
  function fold(card) {
    card.classList.add('gone');
    seen.unobserve(card);
    waitingBtn.hidden = true;
    setTimeout(() => {
      card.remove();
      glow();
    }, FOLD_MS);
  }

  // The date line's "· 1 waiting" while the card is out of view (HOME.md §3.5).
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = m.showing(items, Date.now()).length;
        waitingBtn.textContent = `· ${m.waitingSuffix(Math.max(1, n))}`;
        waitingBtn.hidden = e.isIntersecting;
      }
    },
    { root: convo },
  );
  /** @param {HTMLElement} card */
  const watch = (card) => seen.observe(card);
  waitingBtn.addEventListener('click', () => {
    const card = shown?.el;
    if (!card) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    card.classList.remove('pulse');
    requestAnimationFrame(() => card.classList.add('pulse'));
  });

  document.addEventListener('th:changed', (e) => {
    const kinds = /** @type {CustomEvent<string[]>} */ (e).detail ?? [];
    if (kinds.includes('proposal') || kinds.includes('*')) void load();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
  void load();
}
