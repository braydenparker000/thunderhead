// @ts-check
// The conversation on home, drawn (HOME.md §4): owner bubbles on the right, the mind's replies in
// in the shell's face with no bubble, system lines small and centred, one action chip and up to two
// follow-ups under a reply, the time over a turn after an hour's gap, older long replies folded,
// a tap on a reply for its actions, the reply slot while a reply is on its way, and the "New
// reply ↓" pill. Messages are keyed by
// id, so a re-render only adds, changes or removes what changed, and the slot is one element that
// changes only when what it says does (a screen reader hears each change once; focus stays on
// Stop). Text is always set with textContent, never parsed as markup.
import { appFor } from '../registry/apps.js';
import { citeHref, meta, revealMs } from './model.js';
import { rich } from './rich.js';
import { from } from '../../ui/launch.js';

/** A message's photos, files and voice memos, drawn by th/attach/show.js once it loads.
 * @param {(import('../../../shared/contract/api.ts').Attachment | import('../attach/state.js').LocalFile)[]} list */
function attachments(list) {
  const host = document.createElement('div');
  host.className = 'atts';
  import('../attach/show.js').then(
    (s) => {
      // Filled after the turn was drawn: a conversation at its newest turn stays there.
      const convo = host.closest('.convo');
      const atEnd = convo && convo.scrollHeight - convo.scrollTop - convo.clientHeight < 80;
      s.fill(host, list);
      if (convo && atEnd) convo.scrollTop = convo.scrollHeight;
    },
    () => host.remove(),
  );
  return host;
}

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

const HOUR = 3_600_000;
const clock = (/** @type {number} */ at) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * @param {{ talk: HTMLElement, convo: HTMLElement, onRetry: (id: string) => void, onChip: (chip: { app: string, path: string, label: string }) => void, onStop: () => void, onFollow: (text: string, replyTo: string) => void, onTap: (m: Shown, node: HTMLElement) => void }} o
 */
export function createView({ talk, convo, onRetry, onChip, onStop, onFollow, onTap }) {
  /** @type {Map<string, { node: HTMLElement, sig: string, m: Shown }>} */
  const nodes = new Map();
  /** Older long replies the owner unfolded. */
  const unfolded = new Set();
  talk.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const node = /** @type {HTMLElement | null} */ (t.closest('.reply')?.closest('[data-id]') ?? null);
    if (!node || t.closest('a,button,.blocks,.study,.atts') || String(getSelection() ?? '')) return;
    const m = nodes.get(node.dataset.id ?? '')?.m;
    if (m && m.author === 'mind' && !m.local) onTap(m, node);
  });
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
    // A reminder the owner set, at its time (HOME.md §6.2).
    if (m.author === 'system' && !m.local && /** @type {any} */ (m.meta)?.reminder) {
      const line = el('div', 'sys reminder');
      line.innerHTML = '<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#alarm"/></svg>';
      line.append(el('span', '', m.body));
      line.setAttribute('aria-label', `Reminder: ${m.body}`);
      return line;
    }
    // A home line the mind placed: a card in the chat, the night's marked as such (HOME.md §2.1).
    if (m.kind === /** @type {any} */ ('card')) {
      const card = el('div', 'note');
      const mt = /** @type {any} */ (m.meta) ?? {};
      if (mt.night) {
        const head = el('div', 'nh');
        head.innerHTML = '<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#moon-stars"/></svg>';
        head.append('Overnight');
        card.append(head);
      }
      for (const l of Array.isArray(mt.lines) ? mt.lines : [{ text: m.body, lang: null }]) {
        const text = el('div', 'nt', String(l.text));
        if (typeof l.lang === 'string') text.lang = l.lang;
        card.append(text);
      }
      return card;
    }
    if (m.author === 'system' || (m.author === 'mind' && m.kind === 'error')) return el('div', 'sys', m.body);
    if (m.author === 'owner') {
      const wrap = el('div', 'mine');
      const files = m.local ? m.files ?? [] : m.attachments ?? [];
      if (files.length) wrap.append(attachments(files));
      if (m.body) wrap.append(el('div', 'you', m.body));
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
    if (!m.local && m.attachments?.length) wrap.append(attachments(m.attachments));
    if (s.fresh.has(m.id)) {
      wrap.classList.add('reveal');
      wrap.style.setProperty('--reveal-ms', `${revealMs(m.body)}ms`);
      words(wrap, revealMs(m.body));
    }
    // Up to four blocks under the words (HOME.md §4.3), drawn by th/chat/blocks.js.
    const blocks = !m.local && m.meta && typeof m.meta === 'object' ? /** @type {any} */ (m.meta).blocks : null;
    if (Array.isArray(blocks) && blocks.length) {
      const host = el('div', 'blocks');
      wrap.append(host);
      import('./blocks.js').then((b) => host.append(...blocks.slice(0, 4).map((x) => b.block(x, []))), () => host.remove());
    }
    const cites = !m.local && m.meta && typeof m.meta === 'object' ? /** @type {any} */ (m.meta).cite?.citations : null;
    if (Array.isArray(cites) && cites.length) wrap.append(whereToStudy(cites));
    const chip = !m.local && m.meta && typeof m.meta === 'object' ? /** @type {any} */ (m.meta).chip : null;
    const app = chip ? appFor(chip.app) : null;
    /** @type {HTMLElement[]} */
    const under = [];
    if (chip && app) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.style.setProperty('--c', app.color);
      b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/ui/icons.svg#${app.icon}"/></svg>`;
      b.append(String(chip.label));
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect();
        from(r.left + r.width / 2, r.top + r.height / 2);
        onChip(chip);
      });
      under.push(b);
    }
    // Up to two follow-ups the mind suggests (`meta.followups`); a tap sends one, answering this reply.
    const follow = !m.local && m.meta && typeof m.meta === 'object' ? /** @type {any} */ (m.meta).followups : null;
    const asks = Array.isArray(follow) ? follow.filter((f) => typeof f === 'string' && f.trim()).slice(0, 2) : [];
    if (asks.length) {
      const row = el('div', 'follows');
      for (const f of asks) {
        const b = el('button', 'follow', f.trim().slice(0, 60));
        b.type = 'button';
        b.addEventListener('click', () => onFollow(f.trim().slice(0, 200), m.id));
        row.append(b);
      }
      under.push(row);
    }
    if (!under.length) return wrap;
    const box = el('div', 'replybox');
    box.append(wrap, ...under);
    // What sits under a reply fades in once the reply has revealed (HOME.md §4.5).
    setTimeout(() => under.forEach((u) => u.classList.add('in')), s.fresh.has(m.id) ? revealMs(m.body) + 50 : 0);
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
    let lastAt = 0;
    /** @type {HTMLElement[]} */
    const drawnNow = [];
    /** The owner's messages just sent from this phone: each lifts out of the ask bar into its place. @type {HTMLElement[]} */
    const lifts = [];
    for (const g of groups) {
      let t = turns.get(g[0].id);
      if (!t) {
        t = el('div', g[0].author === 'system' ? 'turn sysline' : 'turn');
        turns.set(g[0].id, t);
      }
      // The time over a turn that starts the day or follows an hour's quiet.
      const at = g[0].created_at;
      if (!lastAt || at - lastAt >= HOUR) t.dataset.time = clock(at);
      else delete t.dataset.time;
      // Every turn's time, for the chip that floats at the top while the conversation scrolls (home/pinned.js).
      t.dataset.at = clock(at);
      lastAt = g.at(-1)?.created_at ?? at;
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
          else if (m.author === 'owner') {
            newOwner = true;
            if (m.local && m.state !== 'failed') lifts.push(node);
          }
          else if (m.author === 'mind') newReply = true; // live, or loaded on the way back from an app
          else newLine = true;
          rec = { node, sig, m };
          nodes.set(m.id, rec);
          drawnNow.push(node);
        } else rec.m = m;
        const node = rec.node;
        if (prev ? prev.nextElementSibling !== node : t.firstElementChild !== node) prev ? prev.after(node) : t.prepend(node);
        prev = node;
      }
    }
    for (const node of lifts) requestAnimationFrame(() => lift(node));
    // An older reply taller than 14 lines folds to 10 with "Show all"; the newest never does.
    const replies = talk.querySelectorAll('.reply:not(.progress)');
    const newest = replies[replies.length - 1];
    for (const node of drawnNow) {
      const r = node.matches('.reply') ? node : node.querySelector('.reply');
      const id = node.dataset.id ?? '';
      if (r && r !== newest && !r.matches('.progress') && !unfolded.has(id)) requestAnimationFrame(() => fold(/** @type {HTMLElement} */ (r), id));
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

  /** @param {HTMLElement} r @param {string} id */
  function fold(r, id) {
    const line = parseFloat(getComputedStyle(r).lineHeight) || 26;
    if (r.scrollHeight <= line * 14 || r.classList.contains('folded')) return;
    r.classList.add('folded');
    const more = el('button', 'more', 'Show all');
    more.type = 'button';
    more.addEventListener('click', () => {
      r.classList.remove('folded');
      more.remove();
      unfolded.add(id);
    });
    r.after(more);
  }

  return { render };
}

/** A reply's words fade up one after another over `ms` (HOME.md §4.4: at most 1.2 s), the text
 * itself unchanged (a screen reader reads it whole). Only text in the words is wrapped, never in the
 * blocks under them. @param {HTMLElement} wrap @param {number} ms */
function words(wrap, ms) {
  /** @type {Text[]} */
  const texts = [];
  const walk = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('pre, code, table, .blocks') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push(/** @type {Text} */ (n));
  let i = 0;
  const total = texts.reduce((k, t) => k + (t.data.match(/\S+/g)?.length ?? 0), 0);
  const step = Math.max(8, Math.min(60, ms / Math.max(1, total)));
  wrap.style.setProperty('--wstep', `${step.toFixed(1)}ms`);
  for (const t of texts) {
    const parts = t.data.split(/(\s+)/);
    if (parts.length < 2 && !t.data.trim()) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) frag.append(part);
      else {
        const w = el('span', 'w', part);
        w.style.setProperty('--w', String(Math.min(i++, 160)));
        frag.append(w);
      }
    }
    t.replaceWith(frag);
  }
}

/** The bubble just sent rises out of the ask bar into its place (owner, 2026-10-31: "more
 * fluid"); transform only. @param {HTMLElement} node */
function lift(node) {
  const bubble = /** @type {HTMLElement | null} */ (node.querySelector('.you')) ?? node;
  const bar = document.querySelector('#ask')?.getBoundingClientRect();
  if (!bar || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = bubble.getBoundingClientRect();
  const dy = bar.top + bar.height / 2 - (r.top + r.height / 2);
  if (dy < 8) return;
  bubble.animate(
    [{ transform: `translate(${Math.round(bar.left + 56 - r.left)}px, ${Math.round(dy)}px) scale(.94)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }],
    { duration: 420, easing: getComputedStyle(document.documentElement).getPropertyValue('--settle').trim() || 'ease-out' },
  );
}
