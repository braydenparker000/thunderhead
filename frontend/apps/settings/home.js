// Settings' own page (MENU-AND-SETTINGS.md §4; owner, 2026-10-31: the menu holds only the
// conversations, Settings opens from its bar): the search field, then the pages under headings (owner,
// 2026-11-21): Look (theme, text size, a still background, then More appearance), Home and gestures,
// Apps, The mind, Account and data, About. Each page opens over this one and its back button returns
// here (settings.js keeps the stack). Quiet hours is a section of Notifications (quietPart below): when
// the day's quiet starts and ends (never before 06:30), and "go quiet" for a while (BEHAVIOR.md §8).
// Agents (keys for the mind and other tools) is listed under Account and data again (2026-11-25), a plain
// row like its neighbours; it is also reachable by its address (/settings/agents/).
import { api, signedIn } from '/th/client.js';
import { quietLine, quietUntil, setQuiet } from '/th/chat/quiet.js';
import { lineFor, mindName } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el, toast } from '/th/ui.js';
import { updateLine } from '/th/update-rules.js';
import { checkForUpdate, waiting } from '/th/update.js';
import { CONFIG } from '/config.js';
import { FULL } from './catalog.js';
import { choice, group, icon, row, sheet, switchRow } from './components.js';
import { PAGES, SECTIONS } from './pages.js';

const root = document.documentElement;
const stored = (/** @type {string} */ key, /** @type {string} */ def) => {
  try {
    return localStorage.getItem(key) || def;
  } catch {
    return def;
  }
};

/** Brings a row into view and marks it for 2 s (a search result, a deep link). @param {Element | null | undefined} target */
export function mark(target) {
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'center' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 2000);
  });
}

export { PAGES, SECTIONS };

/** Appearance: the theme (Auto follows the clock), the text size of the conversation, and a still
 * background. Kept on this phone; ui/theme.js applies them before the first paint (HOME.md §8). */
export function appearance(/** @type {HTMLElement[]} */ more = []) {
  const theme = choice('Theme', [['auto', 'Auto'], ['light', 'Day'], ['dark', 'Night']], stored('th-theme', 'auto'), (v) => {
    document.dispatchEvent(new CustomEvent('th:theme', { detail: v })); // ui/theme.js keeps it
    if (stored('th-theme', 'auto') !== v) toast(FULL);
  });
  theme.id = 'set-theme';
  const size = choice('Text size', [['s', 'Smaller'], ['m', 'Default'], ['l', 'Larger']], stored('th-text', 'm'), (v) => {
    if (v === 'm') delete root.dataset.text;
    else root.dataset.text = v;
    try {
      v === 'm' ? localStorage.removeItem('th-text') : localStorage.setItem('th-text', v);
    } catch {
      toast(FULL);
    }
  });
  size.id = 'set-text';
  const still = switchRow('Still background', 'moon-stars', root.dataset.still !== undefined, (on) => {
    if (on) root.dataset.still = '';
    else delete root.dataset.still;
    try { on ? localStorage.setItem('th-still', '1') : localStorage.removeItem('th-still'); } catch { toast(FULL); }
  });
  still.id = 'set-still';
  const preview = el('div', { class: 'appearance-preview', 'aria-label': 'Appearance preview' }, [
    el('p', { class: 'preview-reply', text: 'A little room to think.' }),
    el('div', { class: 'row' }, [icon('chat-circle'), el('span', { class: 'row-copy' }, [
      el('span', { class: 'row-title', text: 'A quiet moment' }),
      el('span', { class: 'row-detail', text: 'Your theme and text size, as they read.' }),
    ])]),
  ]);
  return el('div', { class: 'group slist sappear' }, [preview, theme, size, still, ...more]);
}

/** Settings' own page. @param {HTMLElement} body @param {(name: string) => void} open @param {string} [focus] a control to bring into view */
export function settingsHome(body, open, focus) {
  const update = row({ title: 'Check for update', icon: 'info', value: CONFIG.commit !== 'dev' ? CONFIG.commit.slice(0, 7) : '' });
  update.classList.add('slink'); update.id = 'set-update';
  update.addEventListener('click', async () => {
    if (!navigator.serviceWorker) return toast(updateLine('unsupported'));
    toast(updateLine('checking'));
    toast(updateLine((await checkForUpdate()) || waiting() ? 'waiting' : 'current'));
  });
  // Search (search.js, loaded on the first focus): settings, pages, controls and actions (finder.js).
  const find = el('input', { class: 'field', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', autocomplete: 'off', enterkeyhint: 'search' });
  find.addEventListener('focus', () => void import('./search.js').then((m) => m.attach(find, body)), { once: true });
  body.append(el('div', { class: 'field-box ssearch' }, [icon('magnifying-glass'), find]));
  for (const [heading, pages] of SECTIONS) {
    const rows = pages.map(([page, name, symbol, line]) => {
      const button = row({ title: page === 'mind' ? mindName(true) : name, detail: line, icon: symbol, open: true, onClick: () => open(page) });
      button.classList.add('slink');
      button.dataset.page = page;
      return button;
    });
    if (heading === 'Look') body.append(el('h2', { class: 'group-title', text: heading }), appearance(rows));
    else body.append(group(heading, heading === 'About' ? [...rows, update] : rows));
  }
  if (focus) mark(body.querySelector(`#set-${focus}, [data-page="${focus}"]`));
}

const hhmm = (/** @type {unknown} */ v, /** @type {string} */ def) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : def);

/** Quiet hours, a section of Notifications (MENU-AND-SETTINGS.md §4.2): from when to when nothing needs
 * the owner (no pushes, decisions held), the end never before 06:30 (owner ruling); and "go quiet" now,
 * for a while. Resolves with what to do as the page closes.
 * @param {HTMLElement} body */
export async function quietPart(body) {
  const line = el('p', { class: 'line', role: 'status', id: 'quiet-line' });
  const start = el('input', { type: 'time', class: 'field', id: 'quiet-start', value: '22:00', step: '300' });
  const end = el('input', { type: 'time', class: 'field', id: 'quiet-end', value: '06:30', min: '06:30', step: '300' });
  const save = el('button', { type: 'button', class: 'btn', text: 'Save', disabled: '' });
  const timeRow = (label, input, detail) => {
    const button = row({ title: label, detail, icon: 'clock', value: input.value, open: true });
    button.dataset.action = 'quiet';
    button.addEventListener('click', () => {
      const previous = input.value;
      const wasDisabled = save.disabled;
      let accepted = false;
      const done = el('button', { type: 'button', class: 'btn', text: 'Done' });
      const modal = sheet({ title: label, children: [el('label', { class: 'fld', for: input.id }, [el('span', { class: 'lbl', text: label }), input]), done], onClose: () => {
        if (!accepted) { input.value = previous; save.disabled = wasDisabled; }
        button.querySelector('.row-value').textContent = input.value;
      } });
      done.addEventListener('click', () => { accepted = true; modal.close(); });
    });
    input.addEventListener('input', () => { button.querySelector('.row-value').textContent = input.value; });
    return button;
  };
  const startRow = timeRow('Starts', start);
  const endRow = timeRow('Ends', end, '06:30 at the earliest');
  const window_ = el('div', { class: 'group' }, [startRow, endRow]);
  const now = el('p', { class: 'snow' });
  const goes = el('div', { class: 'group sactions' });
  const showNow = () => {
    const until = quietUntil();
    now.textContent = until ? quietLine(until) : 'Not quiet now.';
    goes.replaceChildren(
      ...(until
        ? [btn('End now', () => setQuiet(0))]
        : [btn('1 hour', () => setQuiet(Date.now() + 3_600_000)), btn('Until tomorrow', () => setQuiet(morning())), btn('Until I turn it off', () => setQuiet(Date.now() + 30 * 86_400_000))]),
    );
  };
  const btn = (/** @type {string} */ text, /** @type {() => unknown} */ run) => {
    const b = row({ title: text, icon: text === 'End now' ? 'bell' : 'moon-stars' });
    b.dataset.action = 'quiet';
    b.addEventListener('click', async () => {
      const going = run();
      showNow();
      // false: the phone's storage is full and the Worker couldn't be reached, so it isn't kept anywhere.
      if ((await going) === false) { showNow(); now.textContent = "Not changed: this phone's storage is full and the Thunderhead can't be reached. See Settings › On this phone."; }
      else showNow();
    });
    return b;
  };
  /** The next 06:30 or the owner's later end, as the morning "go quiet" runs to. */
  const morning = () => {
    const [h, m] = end.value.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  body.append(
    el('h2', { class: 'group-title', id: 'set-quiet', text: 'Quiet hours' }),
    el('p', { class: 'slead', text: 'Every day inside these hours I send nothing and hold anything that needs you until they end.' }),
    window_, save, line,
    el('h2', { class: 'group-title', text: 'Go quiet now' }), now, goes,
  );
  showNow();
  document.addEventListener('th:quiet', showNow);
  const changed = () => {
    save.disabled = false;
    line.textContent = '';
  };
  start.addEventListener('input', changed);
  end.addEventListener('input', changed);
  save.addEventListener('click', async () => {
    if (end.value < '06:30') {
      line.textContent = 'Quiet hours end at 06:30 at the earliest.';
      end.value = '06:30';
      endRow.querySelector('.row-value').textContent = end.value;
      return;
    }
    save.disabled = true;
    try {
      await signedIn((t) => api.call('/v1/settings', { method: 'PATCH', token: t, body: { 'quiet.start': start.value, 'quiet.end': end.value } }));
      toast(`Quiet from ${start.value} to ${end.value}.`);
    } catch (e) {
      save.disabled = false;
      line.textContent = lineFor(failure(e));
    }
  });
  try {
    const s = /** @type {Record<string, unknown>} */ (await signedIn((t) => api.settings(t)));
    start.value = hhmm(s['quiet.start'], '22:00');
    end.value = hhmm(s['quiet.end'], '06:30');
    startRow.querySelector('.row-value').textContent = start.value;
    endRow.querySelector('.row-value').textContent = end.value;
  } catch (e) {
    line.textContent = lineFor(failure(e));
  }
  return () => document.removeEventListener('th:quiet', showNow);
}
