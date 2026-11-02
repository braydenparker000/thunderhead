// @ts-check
// Settings' catalogue pages (MENU-AND-SETTINGS.md §6): one renderer for any group of the settings
// catalogue (shared/contract/settings.ts; its copy catalog-data.js is written by scripts/contract.mjs).
// Each setting is a row of the shared controls (components.js) with its one-line detail under it:
// a switch, a segmented choice (a sheet picker past four options), a range of stops, an ordered list
// (move up, move down, hide, show) or a text field in a sheet.
//   phone settings   localStorage `th.s.<key>`, removed at the default; those with an `attr` put it
//                    on <html> while not at the default (applyPhone), so CSS can follow them.
//   worker settings  GET /v1/settings, back by PATCH one key at a time, in order; kept in
//                    `th.p.settings` meanwhile so a page opens with them (wiped at sign-out).
// Other modules read a phone setting with phoneValue(key) and hear any change as the document event
// `th:setting` ({ key, value, scope }).
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el } from '/th/ui.js';
import { choice, group, icon, picker, row, sheet } from './components.js';
import { SETTING_GROUPS, SETTINGS } from './catalog-data.js';

/** @typedef {import('../../../shared/contract/settings.ts').SettingSpec} Spec */
/** @typedef {import('../../../shared/contract/settings.ts').SettingValue} Value */
/** @typedef {keyof typeof SETTING_GROUPS} Group */

const PREFIX = 'th.s.';
const CACHE = 'th.p.settings';
/** @type {readonly Spec[]} */
const ALL = SETTINGS;

/** @param {string} key */
export const spec = (key) => ALL.find((s) => s.key === key);

/** Whether `value` is one `s` allows (shared/contract/settings.ts validSetting, as the Worker checks).
 * @param {Spec} s @param {unknown} value @returns {value is Value} */
export function valid(s, value) {
  const allowed = (s.options ?? []).map((o) => o.value);
  if (s.kind === 'switch') return typeof value === 'boolean';
  if (s.kind === 'choice') return typeof value === 'string' && allowed.includes(value);
  if (s.kind === 'range') return typeof value === 'number' && allowed.includes(value);
  if (s.kind === 'order')
    return Array.isArray(value) && new Set(value).size === value.length && value.every((v) => typeof v === 'string' && allowed.includes(v));
  return typeof value === 'string' && value.length <= (s.max ?? 200) && (s.pattern === undefined || new RegExp(s.pattern).test(value));
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A phone setting's value here: what the owner chose, or its default. @param {string} key */
export function phoneValue(key) {
  const s = spec(key);
  if (!s || s.scope !== 'phone') return undefined;
  /** @type {unknown} */
  let v;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) v = undefined;
    else if (s.kind === 'switch') v = raw === 'true' ? true : raw === 'false' ? false : raw;
    else v = s.kind === 'range' ? Number(raw) : s.kind === 'order' ? JSON.parse(raw) : raw;
  } catch {}
  return valid(s, v) ? v : s.default;
}

/** Puts each phone setting that has an attribute on <html>, while it is not at its default. */
export function applyPhone(root = document.documentElement) {
  for (const s of ALL) {
    if (s.scope !== 'phone' || !s.attr) continue;
    const v = phoneValue(s.key);
    if (same(v, s.default)) root.removeAttribute(s.attr);
    else root.setAttribute(s.attr, String(v));
  }
}
applyPhone();

/** @param {Spec} s @param {Value} value */
const announce = (s, value) => document.dispatchEvent(new CustomEvent('th:setting', { detail: { key: s.key, value, scope: s.scope } }));

/** @param {Spec} s @param {Value} value */
function setPhone(s, value) {
  try {
    if (same(value, s.default)) localStorage.removeItem(PREFIX + s.key);
    else localStorage.setItem(PREFIX + s.key, s.kind === 'order' ? JSON.stringify(value) : String(value));
  } catch {}
  applyPhone();
  announce(s, value);
}

/** Worker settings as this phone last saw them. @returns {Record<string, unknown>} */
function cached() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
/** @param {Record<string, unknown>} values */
const remember = (values) => { try { localStorage.setItem(CACHE, JSON.stringify(values)); } catch {} };

/** An id for a setting's detail line. @param {string} key */
const detailId = (key) => `set-${key.replace(/[^a-z0-9]+/gi, '-')}-detail`;

/**
 * One setting's control, with its detail line. `pick(next)` is called with each new value.
 * @param {Spec} s @param {Value} value @param {(next: Value) => unknown} pick @returns {HTMLElement}
 */
export function build(s, value, pick) {
  const id = detailId(s.key);
  const detail = el('span', { class: 'row-detail', id, text: s.detail });
  /** @type {HTMLElement} */
  let node;
  if (s.kind === 'switch') {
    node = row({ title: s.label });
    node.querySelector('.row-copy')?.append(detail);
    node.classList.add('switch');
    node.setAttribute('role', 'switch');
    node.setAttribute('aria-checked', String(value));
    node.setAttribute('aria-label', s.label);
    node.setAttribute('aria-describedby', id);
    node.append(el('span', { class: 'switch-track', 'aria-hidden': 'true' }));
    node.addEventListener('click', () => {
      const next = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(next));
      pick(next);
    });
  } else if (s.kind === 'order') node = order(s, /** @type {readonly string[]} */ (value), pick);
  else if (s.kind === 'text') node = text(s, String(value), pick, detail);
  else {
    const options = /** @type {[string, string][]} */ ((s.options ?? []).map((o) => [String(o.value), o.label]));
    const back = (/** @type {string} */ raw) => pick(s.kind === 'range' ? Number(raw) : raw);
    if (options.length > 4) {
      node = picker(s.label, options, String(value), back);
      node.querySelector('.row-copy')?.append(detail);
      node.setAttribute('aria-describedby', id);
    } else {
      node = choice(s.label, options, String(value), back);
      const label = node.querySelector('.seg-label');
      label?.replaceChildren(el('div', { class: 'row-title', text: s.label }), el('div', { class: 'row-detail', id, text: s.detail }));
      node.querySelector('.seg')?.setAttribute('aria-describedby', id);
    }
  }
  node.dataset.key = s.key;
  return node;
}

/** A text setting: the row shows it; a tap edits it in a sheet. @param {Spec} s @param {string} value
 * @param {(next: Value) => unknown} pick @param {HTMLElement} detail */
function text(s, value, pick, detail) {
  const button = row({ title: s.label, value, open: true });
  button.querySelector('.row-copy')?.append(detail);
  button.addEventListener('click', () => {
    const input = el('input', { class: 'field', type: 'text', value, maxlength: String(s.max ?? 200), 'aria-label': s.label });
    const done = el('button', { type: 'button', class: 'btn', text: 'Done' });
    const line = el('p', { class: 'line', role: 'status' });
    const modal = sheet({ title: s.label, children: [input, line, done] });
    done.addEventListener('click', () => {
      const next = input.value.trim();
      if (!valid(s, next)) { line.textContent = 'That is not one this setting takes.'; return; }
      value = next;
      const shown = button.querySelector('.row-value');
      if (shown) shown.textContent = next;
      pick(next);
      void modal.close();
    });
    input.focus({ preventScroll: true });
  });
  return button;
}

/** An ordered setting: the shown items in order, each with move up, move down and hide; the hidden
 * ones below with show. @param {Spec} s @param {readonly string[]} value @param {(next: Value) => unknown} pick */
function order(s, value, pick) {
  let items = [...value];
  const shown = el('div', { class: 'group' });
  const hidden = el('div', { class: 'group' });
  const hiddenTitle = el('h2', { class: 'group-title', text: 'Hidden' });
  const host = el('section', { class: 'group-section' }, [
    el('h2', { class: 'group-title', text: s.label }),
    el('p', { class: 'shelp', id: detailId(s.key), text: s.detail }),
    shown, hiddenTitle, hidden,
  ]);
  /** @param {string} symbol @param {string} label @param {boolean} off @param {() => void} fn */
  const button = (symbol, label, off, fn) => {
    const b = el('button', { type: 'button', class: 'sback', 'aria-label': label, 'data-act': symbol }, [icon(symbol)]);
    if (off) { b.disabled = true; b.style.visibility = 'hidden'; }
    b.addEventListener('click', fn);
    return b;
  };
  /** @param {string} v */
  const option = (v) => s.options?.find((o) => o.value === v) ?? { value: v, label: v, detail: '' };
  /** @param {string} v @param {Element[]} trailing */
  const item = (v, trailing) => {
    const o = option(v);
    return el('div', { class: 'row', 'data-item': v }, [
      el('div', { class: 'row-copy' }, [el('span', { class: 'row-title', text: o.label }), el('span', { class: 'row-detail', text: o.detail ?? '' })]),
      ...trailing,
    ]);
  };
  /** Redraws, keeping focus on the item and action that had it. @param {string} [focusItem] @param {string} [focusAct] */
  const draw = (focusItem, focusAct) => {
    shown.replaceChildren(...items.map((v, i) => item(v, [
      button('arrow-up', `Move ${option(v).label} up`, i === 0, () => change(items.toSpliced(i, 1).toSpliced(i - 1, 0, v), v, 'arrow-up')),
      button('arrow-down', `Move ${option(v).label} down`, i === items.length - 1, () => change(items.toSpliced(i, 1).toSpliced(i + 1, 0, v), v, 'arrow-down')),
      button('eye-slash', `Hide ${option(v).label}`, false, () => change(items.filter((x) => x !== v), v, 'plus')),
    ])));
    const rest = (s.options ?? []).map((o) => String(o.value)).filter((v) => !items.includes(v));
    hidden.replaceChildren(...rest.map((v) => item(v, [button('plus', `Show ${option(v).label}`, false, () => change([...items, v], v, 'eye-slash'))])));
    hidden.hidden = hiddenTitle.hidden = !rest.length;
    shown.hidden = !items.length;
    if (focusItem) {
      const at = host.querySelector(`[data-item="${focusItem}"]`);
      const target = /** @type {HTMLElement | null} */ (at?.querySelector(`[data-act="${focusAct}"]:not(:disabled)`) ?? at?.querySelector('button:not(:disabled)'));
      target?.focus({ preventScroll: true });
    }
  };
  /** @param {string[]} next @param {string} v @param {string} act */
  const change = (next, v, act) => { items = next; draw(v, act); pick([...items]); };
  draw();
  return host;
}

/**
 * Renders the catalogue group `name` into `body`: its lead line, then each part of it as a titled
 * group (a group with no parts as one untitled group), a note under a part that has one, and `after`
 * (a page's own read-only groups). Resolves once the worker values are in (at once for a phone group).
 * @param {HTMLElement} body @param {Group} name @param {{ after?: Node[] }} [opts]
 */
export async function renderGroup(body, name, opts = {}) {
  /** @type {{ title: string, lead: string, notes?: Record<string, string> }} */
  const g = SETTING_GROUPS[name];
  const specs = ALL.filter((s) => s.group === name);
  const line = el('p', { class: 'line', role: 'status' });
  /** @type {Record<string, unknown>} worker values, as last confirmed or as sent */
  let store = cached();
  /** @type {Record<string, unknown>} worker values the Worker last confirmed */
  let confirmed = { ...store };
  /** @param {Spec} s @returns {Value} */
  const value = (s) => {
    if (s.scope === 'phone') return /** @type {Value} */ (phoneValue(s.key));
    const v = store[s.key];
    return valid(s, v) ? v : s.default;
  };
  /** @type {Map<string, HTMLElement>} */
  const nodes = new Map();
  /** Each change is its own PATCH, sent one after another, so the Worker keeps the last. */
  let sending = Promise.resolve();
  /** @param {Spec} s @param {Value} next */
  const save = (s, next) => {
    if (s.scope === 'phone') return setPhone(s, next);
    store = { ...store, [s.key]: next };
    remember(store);
    line.textContent = '';
    sending = sending.then(async () => {
      try {
        await signedIn((t) => api.call('/v1/settings', { method: 'PATCH', token: t, body: { [s.key]: next } }));
        confirmed = { ...confirmed, [s.key]: next };
        announce(s, next);
      } catch (e) {
        line.textContent = lineFor(failure(e));
        // Put the control back to what the Worker has, unless a newer change of it is on its way.
        if (store[s.key] !== next) return;
        store = { ...store, [s.key]: confirmed[s.key] };
        remember(store);
        redraw(s);
      }
    });
  };
  /** @param {Spec} s */
  const control = (s) => {
    const n = build(s, value(s), (next) => save(s, next));
    nodes.set(s.key, n);
    return n;
  };
  /** @param {Spec} s */
  const redraw = (s) => {
    const old = nodes.get(s.key);
    const had = old?.contains(document.activeElement);
    const n = control(s);
    old?.replaceWith(n);
    if (had) /** @type {HTMLElement | null} */ (n.querySelector('[tabindex="0"], button:not(:disabled)') ?? n)?.focus({ preventScroll: true });
  };

  const parts = [];
  for (const section of [...new Set(specs.map((s) => s.section ?? ''))]) {
    const inPart = specs.filter((s) => (s.section ?? '') === section);
    const rows = inPart.filter((s) => s.kind !== 'order').map(control);
    for (const s of inPart.filter((x) => x.kind === 'order')) parts.push(control(s));
    if (rows.length) parts.push(section ? group(section, rows) : el('div', { class: 'group' }, rows));
    const note = section && g.notes?.[section];
    if (note) parts.push(el('p', { class: 'shelp', text: note }));
  }
  const host = el('div', { class: 'scatalog', 'data-group': name }, parts);
  body.append(el('p', { class: 'slead', text: g.lead }), host, ...(opts.after ?? []), line);

  if (!specs.some((s) => s.scope === 'worker')) return;
  // Until the Worker answers, its values can't be changed here: a change would race the answer.
  host.inert = true;
  host.setAttribute('aria-busy', 'true');
  try {
    const got = /** @type {Record<string, unknown>} */ (await signedIn((t) => api.settings(t)));
    const next = { ...store };
    for (const s of ALL) {
      if (s.scope !== 'worker') continue;
      if (s.key in got) next[s.key] = got[s.key];
      else delete next[s.key];
    }
    const before = store;
    store = next;
    confirmed = { ...next };
    remember(store);
    for (const s of specs) if (s.scope === 'worker' && !same(before[s.key], store[s.key])) redraw(s);
    host.inert = false;
  } catch (e) {
    line.textContent = lineFor(failure(e));
  }
  host.removeAttribute('aria-busy');
}

/** For a page's read-only facts: a row that is not a control, with its detail and an optional value.
 * @param {string} title @param {string} detail @param {string} [value] */
export function infoRow(title, detail, value) {
  const r = el('div', { class: 'row', 'data-info': '' }, [
    el('div', { class: 'row-copy' }, [el('span', { class: 'row-title', text: title }), el('span', { class: 'row-detail', text: detail })]),
  ]);
  if (value !== undefined) r.append(el('span', { class: 'row-value', text: value }));
  return r;
}

