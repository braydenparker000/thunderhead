// Settings' own page (MENU-AND-SETTINGS.md §4; owner, 2026-10-31: the menu holds only the
// conversations, Settings opens from its bar): Appearance at the top (theme, text size, a still
// background), then a row for each page, then About. Each page opens over this one and its back
// button returns here (settings.js keeps the stack). Quiet hours is its own page here too: when the
// day's quiet starts and ends (never before 06:30), and "go quiet" for a while (BEHAVIOR.md §8).
import { api, signedIn } from '/th/client.js';
import { quietLine, quietUntil, setQuiet } from '/th/chat/quiet.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el, toast } from '/th/ui.js';
import { updateLine } from '/th/update-rules.js';
import { checkForUpdate, waiting } from '/th/update.js';
import { CONFIG } from '/config.js';

const root = document.documentElement;
const svg = (/** @type {string} */ name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `/ui/icons.svg#${name}`);
  s.append(u);
  return s;
};
const stored = (/** @type {string} */ key, /** @type {string} */ def) => {
  try {
    return localStorage.getItem(key) || def;
  } catch {
    return def;
  }
};

/** The pages under Appearance, in order: [page, name, icon]. */
export const PAGES = /** @type {const} */ ([
  ['quiet', 'Quiet hours', 'moon-stars'],
  ['notifications', 'Notifications', 'bell'],
  ['memory', 'What I remember', 'brain'],
  ['devices', 'Sign-in & devices', 'devices'],
  ['agents', 'Agents', 'key'],
  ['account', 'Account', 'user-circle'],
  ['export', 'Export', 'download-simple'],
]);

/** A choice of a few, as a radio group that moves with the arrow keys.
 * @param {string} label @param {[string, string][]} options [value, name] @param {string} value @param {(v: string) => void} pick */
function choice(label, options, value, pick) {
  const group = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const show = (/** @type {string} */ v) => {
    for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (group.querySelectorAll('button'))) {
      const on = b.dataset.v === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  for (const [v, name] of options) group.append(el('button', { type: 'button', role: 'radio', 'data-v': v, text: name }));
  group.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!b) return;
    show(/** @type {string} */ (b.dataset.v));
    pick(/** @type {string} */ (b.dataset.v));
  });
  group.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const bs = /** @type {HTMLButtonElement[]} */ ([...group.querySelectorAll('button')]);
    const next = bs[(bs.indexOf(/** @type {any} */ (document.activeElement)) + d + bs.length) % bs.length];
    next.click();
    next.focus();
  });
  show(value);
  return el('div', { class: 'sfield' }, [el('div', { class: 'slabel', text: label }), group]);
}

/** Appearance: the theme (Auto follows the clock), the text size of the conversation, and a still
 * background. Kept on this phone; ui/theme.js applies them before the first paint (HOME.md §8). */
export function appearance() {
  const theme = choice('Theme', [['auto', 'Auto'], ['light', 'Day'], ['dark', 'Night']], stored('th-theme', 'auto'), (v) =>
    document.dispatchEvent(new CustomEvent('th:theme', { detail: v })),
  );
  theme.id = 'set-theme';
  const size = choice('Text size', [['s', 'Smaller'], ['m', 'Default'], ['l', 'Larger']], stored('th-text', 'm'), (v) => {
    if (v === 'm') delete root.dataset.text;
    else root.dataset.text = v;
    try {
      v === 'm' ? localStorage.removeItem('th-text') : localStorage.setItem('th-text', v);
    } catch {}
  });
  size.id = 'set-text';
  const still = el('button', { type: 'button', class: 'row srow sswitch', id: 'set-still', role: 'switch', 'aria-checked': String(root.dataset.still !== undefined) }, [
    svg('moon-stars'),
    el('span', { class: 't', text: 'Still background' }),
    el('span', { class: 'sw', 'aria-hidden': 'true' }),
  ]);
  still.addEventListener('click', () => {
    const on = root.dataset.still === undefined;
    if (on) root.dataset.still = '';
    else delete root.dataset.still;
    try {
      on ? localStorage.setItem('th-still', '1') : localStorage.removeItem('th-still');
    } catch {}
    still.setAttribute('aria-checked', String(on));
  });
  return el('div', { class: 'slist sappear' }, [theme, size, still]);
}

/** Settings' own page. @param {HTMLElement} body @param {(name: string) => void} open @param {string} [focus] a control to bring into view */
export function settingsHome(body, open, focus) {
  const rows = el('div', { class: 'slist slinks' });
  for (const [page, name, icon] of PAGES) {
    const b = el('button', { type: 'button', class: 'slink', 'data-page': page }, [svg(icon), el('span', { class: 't', text: name }), svg('caret-right')]);
    b.addEventListener('click', () => open(page));
    rows.append(b);
  }
  const version = el('small', { text: CONFIG.commit !== 'dev' ? CONFIG.commit.slice(0, 7) : '' });
  const update = el('button', { type: 'button', class: 'slink', id: 'set-update' }, [svg('info'), el('span', { class: 't', text: 'Check for update' }), version]);
  update.addEventListener('click', async () => {
    if (!navigator.serviceWorker) return toast(updateLine('unsupported'));
    toast(updateLine('checking'));
    toast(updateLine((await checkForUpdate()) || waiting() ? 'waiting' : 'current'));
  });
  body.append(el('h2', { text: 'Appearance' }), appearance(), el('h2', { text: 'Yours' }), rows, el('h2', { text: 'About' }), el('div', { class: 'slist slinks' }, [update]));
  const target = focus ? /** @type {HTMLElement | null} */ (body.querySelector(`#set-${focus}, [data-page="${focus}"]`)) : null;
  if (target)
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1600);
    });
}

const hhmm = (/** @type {unknown} */ v, /** @type {string} */ def) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : def);

/** Quiet hours (MENU-AND-SETTINGS.md §4.2): from when to when nothing needs the owner (no pushes,
 * decisions held), the end never before 06:30 (owner ruling); and "go quiet" now, for a while.
 * @param {HTMLElement} body */
export async function quietPage(body) {
  const line = el('p', { class: 'line', role: 'status' });
  const start = el('input', { type: 'time', id: 'quiet-start', value: '22:00', step: '300' });
  const end = el('input', { type: 'time', id: 'quiet-end', value: '06:30', min: '06:30', step: '300' });
  const save = el('button', { type: 'button', class: 'btn', text: 'Save', disabled: '' });
  const window_ = el('div', { class: 'slist squiet' }, [
    el('label', { class: 'sfield', for: 'quiet-start' }, [el('span', { class: 'slabel', text: 'Starts' }), start]),
    el('label', { class: 'sfield', for: 'quiet-end' }, [el('span', { class: 'slabel', text: 'Ends (06:30 at the earliest)' }), end]),
  ]);
  const now = el('p', { class: 'snow' });
  const goes = el('div', { class: 'sactions' });
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
    const b = el('button', { type: 'button', class: 'btn soft', text });
    b.addEventListener('click', () => {
      run();
      showNow();
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
    el('p', { class: 'slead', text: 'Inside these hours I send nothing and hold anything that needs you until they end.' }),
    window_, save, line,
    el('h2', { text: 'Go quiet now' }), now, goes,
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
  } catch (e) {
    line.textContent = lineFor(failure(e));
  }
  return () => document.removeEventListener('th:quiet', showNow);
}
