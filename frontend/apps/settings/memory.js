// Settings → What I remember (MEMORY.md §12, MENU-AND-SETTINGS.md §4.4): everything the mind
// knows, grouped as the owner thinks of it, with a filter; the standing rules; loose ends; the day
// notes; facts that are fading and imported ones to review. Every action is a ledger row with
// actor owner. Reloads when the feed says memory changed (the chat's `th:changed`); an older Worker
// without memory says so instead of failing. Returns the page's cleanup (it sends a pending Forget).
import { api, signedIn } from '/th/client.js';
import { uuidv7 } from '/th/chat/model.js';
import { ADD_KINDS, fold, GROUPS, odds, shelfOf } from '/th/registry/memory.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { confirmForget, factRow, memoryLine, op } from './memory-facts.js';
import { dayRow, threadAdd, threadRow } from './memory-notes.js';

const UNDO_MS = 10_000;
const MEMORY_KINDS = new Set(['fact', 'open_thread', 'day_note', '*']);

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

  const data = { facts: [], threads: [], days: [], profile: '' };
  /** Facts waiting out their 10 s undo: id → send now. */
  const pending = new Map();
  let ready = false;
  /** Only the newest load is shown, so a slow older one never paints over it. */
  let loads = 0;
  /** The rows of the last render by what they show (key → { shows, row }): a refresh (the feed, a
   * Forget going out, another row's action) keeps every row that didn't change, with whatever
   * detail or form the owner has open in it. */
  let rows = new Map();

  async function load() {
    const mine = ++loads;
    try {
      const all = [];
      let cursor = null;
      for (let page = 0; page < 5; page++) {
        const r = await signedIn((t) => api.facts(t, cursor));
        all.push(...(Array.isArray(r?.items) ? r.items : []));
        cursor = r?.next ?? null;
        if (!cursor) break;
      }
      const [threads, days, prof] = await signedIn((t) => Promise.all([api.openThreads(t), api.dayNotes(t), api.profile(t)]));
      if (mine !== loads) return;
      data.facts = all;
      data.threads = Array.isArray(threads?.items) ? threads.items : [];
      data.days = Array.isArray(days?.items) ? days.items.slice(0, 14) : [];
      data.profile = typeof prof?.text === 'string' ? prof.text : '';
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

  const ctx = { reload: () => load(), forget: (f) => forget(f) };
  const addThread = threadAdd(ctx);

  function render() {
    const q = fold(filter.value.trim());
    const match = (t) => !q || fold(t).includes(q);
    profile.textContent = data.profile || 'Nothing yet.';
    const shelves = new Map();
    for (const f of data.facts) {
      if (pending.has(f.id) || f.superseded_at !== null || !match(`${f.text} ${f.subject ?? ''}`)) continue;
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
    /** A section with a count of its rows; `extra` (an Add button) follows the rows uncounted. */
    const section = (title, help, rows, empty = '', extra = []) => {
      if (!rows.length && !empty && !extra.length) return;
      out.push(el('section', { class: 'msec' }, [
        el('h2', { text: rows.length ? `${title} (${rows.length})` : title }),
        ...(help ? [el('p', { class: 'st2', text: help })] : []),
        ...(rows.length ? rows : empty ? [el('p', { class: 'sempty', text: empty })] : []),
        ...extra,
      ]));
    };
    const byPin = (a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence_now - a.confidence_now;
    for (const g of GROUPS) {
      const list = (shelves.get(g.id) ?? []).sort(byPin);
      section(g.label, g.help, list.map((f) => fRow(f)), g.id === 'rule' && !q ? 'No standing rules yet.' : '');
    }
    const threads = data.threads.filter((t) => match(t.text));
    const tRow = (t) => keep(`t:${t.id}`, JSON.stringify(t), () => threadRow(t, ctx));
    section('Loose ends', 'Things one of us said would happen.', threads.map(tRow), q ? '' : 'Nothing open.', q ? [] : [addThread]);
    const days = data.days.filter((d) => match(d.summary));
    section('Days', 'My note on each day, newest first.', days.map((d) => keep(`d:${d.day}`, JSON.stringify(d), () => dayRow(d, ctx))));
    section('Fading', "I haven't heard these in a while.", (shelves.get('fading') ?? []).map((f) => fRow(f, 'fading')));
    section('Imported, to review', 'From your old notebook. Tell me which are right.', (shelves.get('review') ?? []).map((f) => fRow(f, 'review')));
    if (!out.length) out.push(el('p', { class: 'sempty', text: 'Nothing matches.' }));
    sections.replaceChildren(...out);
    sections.removeAttribute('aria-busy');
    rows = next;
  }

  /** Forget: asked once, the fact leaves the page, and the request goes after 10 s unless undone. */
  async function forget(f) {
    if (!(await confirmForget())) return;
    let timer;
    const send = async (keepalive = false) => {
      clearTimeout(timer);
      if (!pending.delete(f.id)) return;
      try { await op({ op: 'forget', id: f.id }, keepalive); } catch (e) { toast(memoryLine(e)); }
      load();
    };
    pending.set(f.id, send);
    timer = setTimeout(send, UNDO_MS);
    undoToast('Forgotten.', () => {
      clearTimeout(timer);
      pending.delete(f.id);
      render();
    });
    render();
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
  const flush = () => { for (const send of [...pending.values()]) send(true); };
  addEventListener('pagehide', flush);
  await load();
  return () => {
    flush();
    // What it could undo is sent now, so its Undo must not outlive the page.
    clearTimeout(undoHide);
    document.querySelector('.utoast')?.remove();
    removeEventListener('pagehide', flush);
    document.removeEventListener('th:changed', onChanged);
  };
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let undoHide;
/** The toast with an Undo button (COPY.md `toast.forgotten`), one at a time, in one live region;
 * a second Forget takes it over for its own full 10 s. */
function undoToast(text, onUndo) {
  let t = document.querySelector('.utoast');
  if (!t) {
    t = el('div', { class: 'toast utoast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  const undo = el('button', { type: 'button', class: 'uundo', text: 'Undo' });
  t.replaceChildren(el('span', { text }), undo);
  t.classList.add('show');
  clearTimeout(undoHide);
  undoHide = setTimeout(() => t.classList.remove('show'), UNDO_MS);
  undo.addEventListener('click', () => {
    clearTimeout(undoHide);
    t.classList.remove('show');
    onUndo();
  }, { once: true });
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
