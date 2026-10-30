// @ts-check
// The conversation on home, drawn (HOME.md §4): owner bubbles on the right, the mind's replies in
// Fraunces italic with no bubble, system lines small and centred, one action chip under a reply,
// the reply slot while a reply is on its way, and the "New reply ↓" pill. Messages are keyed by
// id, so a re-render only adds, changes or removes what changed, and the slot is one element that
// changes only when what it says does (a screen reader hears each change once; focus stays on
// Stop). Text is always set with textContent, never parsed as markup.
import { appFor } from '../registry/apps.js';
import { citeHref, meta, revealMs } from './model.js';
import { rich } from './rich.js';

/** @typedef {import('./model.js').Shown} Shown */
/** @typedef {{ shown: Shown[], slot: string, words?: string, stop: 'none' | 'button' | 'stopping', cards: { text: string, kind: string }[], fresh: Set<string>, now: number }} ViewState */

const SLOT_TEXT = {
  dots: '…',
  waking: 'Waking up…',
  waking_long: 'Still waking. This can take a minute.',
  unconnected: "Saved. I'll answer once I'm connected.",
};

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** "Where to study": a cited answer's first five pages, each opening Study there (STUDY.md §8.1).
 * @param {{ ref: string, label: string }[]} cites */
function whereToStudy(cites) {
  const box = el('span', 'study');
  box.append(el('span', 'sthead', 'Where to study'));
  for (const c of cites.slice(0, 5)) {
    const href = citeHref(String(c.ref));
    if (!href) continue;
    const a = el('a', '', String(c.label));
    a.href = href;
    box.append(a);
  }
  return box;
}

/**
 * @param {{ talk: HTMLElement, convo: HTMLElement, onRetry: (id: string) => void, onChip: (chip: { app: string, path: string, label: string }) => void, onStop: () => void }} o
 */
export function createView({ talk, convo, onRetry, onChip, onStop }) {
  /** @type {Map<string, { node: HTMLElement, sig: string }>} */
  const nodes = new Map();
  const slot = el('div', 'slot');
  const wait = el('span', 'wait');
  const stop = el('button', 'stop', 'Stop');
  stop.type = 'button';
  stop.addEventListener('click', () => {
    if (stop.getAttribute('aria-disabled') !== 'true') onStop();
  });
  slot.append(wait, stop);
  let drawn = '';
  const pill = el('button', 'newpill', 'New reply ↓');
  pill.type = 'button';
  pill.addEventListener('click', () => {
    convo.scrollTo({ top: convo.scrollHeight, behavior: 'smooth' });
    pill.classList.remove('show');
  });
  convo.parentElement?.append(pill);
  convo.addEventListener('scroll', () => {
    if (nearBottom()) pill.classList.remove('show');
  });
  const cards = el('div', 'fallbacks');
  talk.before(cards);

  const nearBottom = () => convo.scrollHeight - convo.scrollTop - convo.clientHeight < 80;

  /** @param {Shown} m @param {ViewState} s */
  function draw(m, s) {
    if (m.author === 'system' || (m.author === 'mind' && m.kind === 'error')) return el('div', 'sys', m.body);
    if (m.author === 'owner') {
      const wrap = el('div', 'mine');
      wrap.append(el('div', 'you', m.body));
      const line = meta(m, s.now);
      if (line) {
        const mt = el('div', `meta${m.local && m.state === 'failed' ? ' bad' : ''}`, line);
        if (m.local && m.state === 'failed') {
          const retry = el('button', 'retry', 'Retry');
          retry.type = 'button';
          retry.addEventListener('click', () => onRetry(m.id));
          mt.append(' · ', retry);
        }
        wrap.append(mt);
      }
      return wrap;
    }
    const wrap = el('div', `reply${m.kind === 'progress' ? ' progress' : ''}`);
    wrap.append(rich(m.body));
    if (s.fresh.has(m.id)) {
      wrap.classList.add('reveal');
      wrap.style.setProperty('--reveal-ms', `${revealMs(m.body)}ms`);
    }
    // Up to four of the Board's blocks under the words (HOME.md §4.3), drawn by the Board's own code.
    const blocks = !m.local && m.meta && typeof m.meta === 'object' ? /** @type {any} */ (m.meta).blocks : null;
    if (Array.isArray(blocks) && blocks.length) {
      const host = el('div', 'blocks');
      wrap.append(host);
      import('../briefing/board.js').then((b) => host.append(...blocks.slice(0, 4).map((x) => b.block(x, []))), () => host.remove());
    }
    const cites = !m.local && m.meta && typeof m.meta === 'object' ? /** @type {any} */ (m.meta).cite?.citations : null;
    if (Array.isArray(cites) && cites.length) wrap.append(whereToStudy(cites));
    const chip = !m.local && m.meta && typeof m.meta === 'object' ? /** @type {any} */ (m.meta).chip : null;
    const app = chip ? appFor(chip.app) : null;
    if (!chip || !app) return wrap;
    const box = el('div', 'replybox');
    const b = el('button', 'chip');
    b.type = 'button';
    b.style.setProperty('--c', app.color);
    b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/ui/icons.svg#${app.icon}"/></svg>`;
    b.append(String(chip.label));
    b.addEventListener('click', () => onChip(chip));
    box.append(wrap, b);
    // The chip fades in once the reply has revealed (HOME.md §4.5).
    setTimeout(() => b.classList.add('in'), s.fresh.has(m.id) ? revealMs(m.body) + 50 : 0);
    return box;
  }

  /** @param {Shown} m @param {ViewState} s */
  const signature = (m, s) => `${m.body}|${m.local ? `${m.state}|${meta(m, s.now)}` : JSON.stringify(m.meta)}`;

  /** Turn containers, keyed by their first message, so a re-render never replays their rise. */
  /** @type {Map<string, HTMLElement>} */
  const turns = new Map();

  /** @param {ViewState} s */
  function render(s) {
    const wasNear = nearBottom();
    let newOwner = false;
    let newReply = false;
    let newLine = false;
    // An owner message starts a turn and the mind's posts join it; a system line stands alone.
    /** @type {Shown[][]} */
    const groups = [];
    for (const m of s.shown) {
      const last = groups.at(-1);
      if (!last || m.author === 'owner' || m.author === 'system' || last[0].author === 'system') groups.push([m]);
      else last.push(m);
    }
    const ids = new Set(s.shown.map((m) => m.id));
    const firsts = new Set(groups.map((g) => g[0].id));
    for (const [id, n] of nodes)
      if (!ids.has(id)) {
        n.node.remove();
        nodes.delete(id);
      }
    for (const [id, t] of turns)
      if (!firsts.has(id)) {
        t.remove();
        turns.delete(id);
      }
    /** @type {HTMLElement | null} */
    let prevTurn = null;
    for (const g of groups) {
      let t = turns.get(g[0].id);
      if (!t) {
        t = el('div', g[0].author === 'system' ? 'turn sysline' : 'turn');
        turns.set(g[0].id, t);
      }
      if (prevTurn ? prevTurn.nextElementSibling !== t : talk.firstElementChild !== t) prevTurn ? prevTurn.after(t) : talk.prepend(t);
      prevTurn = t;
      /** @type {HTMLElement | null} */
      let prev = null;
      for (const m of g) {
        const sig = signature(m, s);
        let rec = nodes.get(m.id);
        if (!rec || rec.sig !== sig) {
          const node = draw(m, s);
          node.dataset.id = m.id; // a search hit scrolls to it (th/convos)
          if (rec) rec.node.replaceWith(node);
          else if (m.author === 'owner') newOwner = true;
          else if (m.author === 'mind') newReply = true; // live, or loaded on the way back from an app
          else newLine = true;
          rec = { node, sig };
          nodes.set(m.id, rec);
        }
        const node = rec.node;
        if (prev ? prev.nextElementSibling !== node : t.firstElementChild !== node) prev ? prev.after(node) : t.prepend(node);
        prev = node;
      }
    }
    // The reply slot sits under the newest turn while a reply is on its way.
    const key = `${s.slot}|${s.stop}|${s.slot === 'dots' ? s.words : ''}`;
    if (s.slot === 'none' && s.stop === 'none') slot.remove();
    else {
      if (key !== drawn) {
        wait.className = `wait ${s.slot}`;
        wait.textContent = (s.slot === 'dots' && s.words) || (SLOT_TEXT[/** @type {keyof typeof SLOT_TEXT} */ (s.slot)] ?? '');
        wait.hidden = s.slot === 'none';
        stop.hidden = s.stop === 'none';
        stop.textContent = s.stop === 'stopping' ? 'Stopping…' : 'Stop';
        stop.classList.toggle('stopping', s.stop === 'stopping');
        stop.setAttribute('aria-disabled', String(s.stop === 'stopping'));
      }
      const host = prevTurn ?? talk;
      if (host.lastElementChild !== slot) host.append(slot);
    }
    drawn = key;
    cards.replaceChildren(
      ...s.cards.map((c) => {
        const card = el('div', 'card fallback');
        card.append(el('div', 'q', c.text));
        return card;
      }),
    );
    if (newOwner || ((newReply || newLine) && wasNear)) convo.scrollTop = convo.scrollHeight;
    else if (newReply) pill.classList.add('show');
  }

  return { render };
}

/** The voice line (HOME.md §2): two spans that rise when they change. @param {HTMLElement} say */
export function voice(say) {
  let current = '';
  /** @param {[string, string | null]} l @param {boolean} animate */
  return (l, animate = true) => {
    const key = l.join('\n');
    if (key === current) return;
    current = key;
    const spans = l.filter(Boolean).map((t) => el('span', `ln${animate ? '' : ' still'}`, String(t)));
    say.replaceChildren(...spans);
  };
}
