// Settings → What I remember (MEMORY.md §12, MENU-AND-SETTINGS.md §4.4): everything the mind
// knows, grouped as the owner thinks of it, with a filter over all of it; the standing rules; loose
// ends; the day notes; facts that are fading and imported ones to review. Every action is a ledger
// row with actor owner. Reloads when the feed says memory changed (the chat's `th:changed`); an
// older Worker without memory says so instead of failing. Forget is memory-forget.js. Returns the
// page's cleanup (it sends whatever Forget still waits).
import { api, signedIn } from '/th/client.js';
import { uuidv7 } from '/th/chat/model.js';
import { ADD_KINDS, fold, GROUPS, odds, shelfOf } from '/th/registry/memory.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { factRow, memoryLine, op, privateText } from './memory-facts.js';
import { forgets } from './memory-forget.js';
import { dayRow, threadAdd, threadRow } from './memory-notes.js';

const MEMORY_KINDS = new Set(['fact', 'open_thread', 'day_note', '*']);
/** Pages of 200 read at most (20,000 facts), so the filter reaches every one. */
const MAX_PAGES = 100;
/** Rows a section draws before "Show all", so a long memory stays quick to draw. */
const SHOWN = 100;

/** @param {HTMLElement} body @returns {Promise<() => void>} the cleanup */
export async function memory(body) {
  const filter = el('input', { type: 'search', class: 'sedit msearch', placeholder: 'Search what I remember', 'aria-label': 'Search what I remember', autocomplete: 'off' });
  const add = el('button', { type: 'button', class: 'btn soft', text: 'Add something I should know' });
  const addHost = el('div', { class: 'srec' });
  const profile = el('div', { class: 'mprofile' });
  const summary = el('details', { class: 'mfold' }, [el('summary', { text: 'What a new session reads first' }), profile]);
  const sections = el('div', { class: 'msections', 'aria-busy': 'true' });
  const line = el('p', { class: 'line', role: 'status' });
  body.replaceChildren(filter, add, addHost, summary, sections, line);

  const data = { facts: [], threads: [], days: [], profile: { text: '', fact_ids: [], private_ids: [] } };
  let ready = false;
  /** Only the newest load is shown, so a slow older one never paints over it. */
  let loads = 0;
  /** The rows of the last render by what they show (key → { shows, row }): a refresh (the feed, a
   * Forget going out, another row's action) keeps every row that didn't change, with whatever
   * detail or form the owner has open in it. */
  let rows = new Map();
  /** Sections the owner opened past the first rows. */
  const all = new Set();

  async function load() {
    const mine = ++loads;
    try {
      const facts = [];
      let cursor = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await signedIn((t) => api.facts(t, cursor));
        facts.push(...(Array.isArray(r?.items) ? r.items : []));
        cursor = r?.next ?? null;
        if (!cursor) break;
      }
      const [threads, days, prof] = await signedIn((t) => Promise.all([api.openThreads(t), api.dayNotes(t), api.profile(t)]));
      if (mine !== loads) return;
      data.facts = facts;
      data.threads = Array.isArray(threads?.items) ? threads.items : [];
      data.days = Array.isArray(days?.items) ? days.items.slice(0, 14) : [];
      const text = typeof prof?.text === 'string' ? prof.text : '';
      if (text !== data.profile.text || !ready) {
        data.profile = { text, fact_ids: prof?.fact_ids ?? [], private_ids: prof?.private_ids ?? [] };
        drawProfile();
      }
      ready = true;
      line.textContent = '';
      render();
    } catch (e) {
      if (mine !== loads) return;
      sections.removeAttribute('aria-busy');
      // A Worker from before memory (P2) answers 404: say what's coming instead of an error.
      if (e?.status === 404 && !ready) {
        sections.replaceChildren(el('p', { class: 'sempty', text: 'Memory arrives with the next update of the Thunderhead.' }));
        add.hidden = true;
        summary.hidden = true;
        return;
      }
      line.textContent = memoryLine(e);
    }
  }

  /** The profile, a line each; a private fact's line is blurred until tapped, like its row. The
   * Worker names the private lines by fact id; an older Worker's are found from the facts. */
  function drawProfile() {
    const { text, fact_ids: ids, private_ids: priv } = data.profile;
    const secret = (id) => Boolean(id) && (priv.includes(id) || data.facts.some((f) => f.id === id && f.sensitivity === 1));
    const lines = (text || 'Nothing yet.').split('\n');
    profile.replaceChildren(...lines.map((t, i) => (secret(ids[i]) ? privateText('pline', t) : el('p', { class: 'pline', text: t }))));
  }

  const ctx = { reload: () => load(), forget: (f) => forget(f) };
  const addThread = threadAdd(ctx);
  // Before the first load there is nothing on the page to hide or show again.
  const forgetting = await forgets({ changed: () => { if (ready) render(); }, done: () => load() });

  function render() {
    const q = fold(filter.value.trim());
    const match = (t) => !q || fold(t).includes(q);
    const shelves = new Map();
    for (const f of data.facts) {
      if (forgetting.has(f.id) || f.superseded_at !== null || !match(`${f.text} ${f.subject ?? ''}`)) continue;
      const s = shelfOf(f);
      shelves.set(s, [...(shelves.get(s) ?? []), f]);
    }
    if (!q && !data.facts.length && !data.threads.length && !data.days.length) {
      const empty = "Nothing yet. When you tell me something worth keeping, it shows here with where you said it.";
      sections.replaceChildren(el('p', { class: 'sempty', text: empty }), addThread);
      sections.removeAttribute('aria-busy');
      rows = new Map();
      return;
    }
    const next = new Map();
    const keep = (key, shows, make) => {
      const had = rows.get(key);
      const row = had?.shows === shows ? had.row : make();
      next.set(key, { shows, row });
      return row;
    };
    // A fact's odds move a little at every read (decay); only a change of phrase redraws its row.
    const fRow = (f, shelf) => keep(`f:${f.id}:${shelf ?? ''}`, JSON.stringify({ ...f, confidence_now: odds(f.confidence_now) }), () => factRow(f, ctx, shelf));
    const out = [];
    /** A section with a count of its items, drawing the first `SHOWN` until the owner asks for all;
     * `extra` (an Add button) follows the rows uncounted. */
    const section = (id, title, help, items, draw, empty = '', extra = []) => {
      if (!items.length && !empty && !extra.length) return;
      const cut = all.has(id) ? items : items.slice(0, SHOWN);
      const more = [];
      if (items.length > cut.length) {
        const b = el('button', { type: 'button', class: 'btn soft mmore', text: `Show all ${items.length}` });
        b.addEventListener('click', () => { all.add(id); render(); });
        more.push(b);
      }
      out.push(el('section', { class: 'msec', 'data-sec': id }, [
        el('h2', { text: items.length ? `${title} (${items.length})` : title, tabindex: '-1' }),
        ...(help ? [el('p', { class: 'st2', text: help })] : []),
        ...(items.length ? cut.map(draw) : empty ? [el('p', { class: 'sempty', text: empty })] : []),
        ...more,
        ...extra,
      ]));
    };
    const byPin = (a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence_now - a.confidence_now;
    for (const g of GROUPS)
      section(g.id, g.label, g.help, (shelves.get(g.id) ?? []).sort(byPin), (f) => fRow(f), g.id === 'rule' && !q ? 'No standing rules yet.' : '');
    const tRow = (t) => keep(`t:${t.id}`, JSON.stringify(t), () => threadRow(t, ctx));
    section('threads', 'Loose ends', 'Things one of us said would happen.', data.threads.filter((t) => match(t.text)), tRow, q ? '' : 'Nothing open.', q ? [] : [addThread]);
    section('days', 'Days', 'My note on each day, newest first.', data.days.filter((d) => match(d.summary)), (d) => keep(`d:${d.day}`, JSON.stringify(d), () => dayRow(d, ctx)));
    section('fading', 'Fading', "I haven't heard these in a while.", shelves.get('fading') ?? [], (f) => fRow(f, 'fading'));
    section('review', 'Imported, to review', 'From your old notebook. Tell me which are right.', shelves.get('review') ?? [], (f) => fRow(f, 'review'));
    if (!out.length) out.push(el('p', { class: 'sempty', text: 'Nothing matches.' }));
    sections.replaceChildren(...out);
    sections.removeAttribute('aria-busy');
    rows = next;
  }

  /** Forget (memory-forget.js); then focus moves to the next fact on the page (or the one before),
   * else to the first heading, never to the page itself. */
  async function forget(f) {
    const ids = [...sections.querySelectorAll('.mrow[data-id] > button.mtext')].map((b) => b.parentElement?.getAttribute('data-id'));
    const at = ids.indexOf(f.id);
    const near = at < 0 ? null : (ids[at + 1] ?? ids[at - 1] ?? null);
    if (!(await forgetting.ask(f))) return;
    const to =
      (near && sections.querySelector(`.mrow[data-id="${CSS.escape(near)}"] > button.mtext`)) ||
      sections.querySelector('.msec h2') ||
      filter;
    to.focus({ preventScroll: true });
  }

  let quiet;
  filter.addEventListener('input', () => { clearTimeout(quiet); quiet = setTimeout(render, 120); });
  add.addEventListener('click', () => { if (!tooSoon()) addForm(addHost, add, ctx); });
  const onChanged = (e) => {
    if (!body.isConnected) return document.removeEventListener('th:changed', onChanged);
    const kinds = Array.isArray(e.detail) ? e.detail : [];
    if (kinds.some((k) => MEMORY_KINDS.has(k))) load();
  };
  document.addEventListener('th:changed', onChanged);
  await load();
  return () => {
    forgetting.cleanup();
    document.removeEventListener('th:changed', onChanged);
  };
}

/** Add: a fact or rule in the owner's own words (source user; its own ledger row is the evidence). */
function addForm(host, button, ctx) {
  const kind = el('select', { id: 'memory-kind', class: 'sedit' }, ADD_KINDS.map(([v, label]) => el('option', { value: v, text: label })));
  const text = el('textarea', { id: 'memory-text', class: 'sedit marea', maxlength: '280', rows: '3' });
  const save = el('button', { type: 'submit', class: 'btn', text: 'Save' });
  const cancel = el('button', { type: 'button', class: 'btn soft', text: 'Cancel' });
  const form = el('form', { class: 'mform' }, [
    el('label', { for: 'memory-kind', class: 'st2', text: 'What kind of thing' }), kind,
    el('label', { for: 'memory-text', class: 'st2', text: 'In one sentence' }), text,
    save, cancel,
  ]);
  button.hidden = true;
  host.replaceChildren(form);
  text.focus({ preventScroll: true });
  const close = () => { host.replaceChildren(); button.hidden = false; };
  cancel.addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const words = text.value.replace(/\s+/g, ' ').trim();
    if (!words) return;
    save.disabled = true;
    try {
      await op({ op: 'add', id: uuidv7(), kind: kind.value, text: words, source: 'user', evidence: [] });
      toast('Saved');
      close();
      ctx.reload();
    } catch (err) {
      save.disabled = false;
      toast(memoryLine(err));
    }
  });
}
