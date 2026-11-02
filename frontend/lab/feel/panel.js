import { ramp, density } from '/th/type.js';
import { springs, setSpring, linearCurve, restTime, configureMotion, motionSettings, motionReduced } from '/th/motion.js';

const KEY = 'th.lab.feel';
const SPRINGS = ['page', 'ring', 'pop', 'island'];
const MOTION = ['--d-instant', '--d-fast', '--d-quick', '--d-base', '--d-sheet', '--d-page', '--d-rise', '--d-edge', '--settle', '--pop', '--press-scale'];
const NAMES = [...MOTION, ...Object.keys(ramp()), ...Object.keys(density())];
let current;
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const params = value => ({ stiffness: value.stiffness, damping: value.damping });
const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

/** Opens only when boot explicitly loads the lab; stored tuning has no effect elsewhere. */
export async function start() {
  if (current) return current;
  const root = document.documentElement;
  const originalInline = new Map(NAMES.map(name => [name, [root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]]));
  const originalSprings = Object.fromEntries(SPRINGS.map(name => [name, params(springs[name])]));
  const originalMotion = motionSettings();
  const originalReduced = motionReduced();
  const base = Object.fromEntries(NAMES.map(name => [name, getComputedStyle(root).getPropertyValue(name).trim()]));
  const appearance = { s: {}, l: {} };
  // Read the file's defaults, even if Appearance or reduced motion is active at startup.
  for (const sheet of document.styleSheets) {
    if (!sheet.href || new URL(sheet.href).pathname !== '/ui/tokens.css') continue;
    for (const rule of sheet.cssRules) {
      const target = rule.selectorText === ':root' ? base : rule.selectorText === ':root[data-text="s"]' ? appearance.s : rule.selectorText === ':root[data-text="l"]' ? appearance.l : null;
      if (target) for (const name of NAMES) if (rule.style.getPropertyValue(name)) target[name] = rule.style.getPropertyValue(name).trim();
    }
  }
  base['--press-scale'] ||= '.97';
  const resolve = value => value.replace(/var\((--[\w-]+)\)/g, (_, name) => base[name] || '');
  for (const size of ['s', 'l']) for (const name of ['--fs-reply', '--fs-input']) appearance[size][name] = resolve(appearance[size][name] || base[name]);
  const defaults = () => ({
    v: 1, springs: structuredClone(originalSprings), pressScale: Number(base['--press-scale']), pressTime: parseFloat(base['--d-fast']),
    base: 15, ratio: 1.2, heroMax: 46, snapOffRamp: false, density: 1,
    haptics: originalMotion.haptics, reduced: originalReduced, tuned: {},
  });
  let state = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.v === 1 && saved.tuned && typeof saved.tuned === 'object') {
      for (const name of SPRINGS) state.springs[name] = {
        stiffness: number(saved.springs?.[name]?.stiffness, originalSprings[name].stiffness, 100, 1600),
        damping: number(saved.springs?.[name]?.damping, originalSprings[name].damping, .5, 1),
      };
      for (const [name, min, max] of [['pressScale', .94, 1], ['pressTime', 60, 200], ['base', 13, 16], ['heroMax', 40, 48], ['density', .9, 1.1]]) state[name] = number(saved[name], state[name], min, max);
      if ([1.125, 1.2, 1.25, 1.333].includes(saved.ratio)) state.ratio = saved.ratio;
      for (const name of ['snapOffRamp', 'haptics', 'reduced']) if (typeof saved[name] === 'boolean') state[name] = saved[name];
      for (const name of ['motion', 'pressScale', 'pressTime', 'type', 'density', 'haptics', 'reduced']) state.tuned[name] = saved.tuned[name] === true;
    }
  } catch { /* Invalid or unavailable local storage leaves the file defaults intact. */ }

  const sheet = element('link');
  sheet.rel = 'stylesheet'; sheet.href = '/lab/feel/panel.css';
  const loaded = new Promise((resolve, reject) => { sheet.onload = resolve; sheet.onerror = () => reject(new Error('The feel panel stylesheet could not load.')); });
  document.head.append(sheet);
  await loaded;

  const panel = element('aside', 'feel-lab');
  panel.id = 'feel-lab'; panel.setAttribute('aria-label', 'Feel tuning');
  const header = element('header', 'feel-header');
  const drag = element('button', 'feel-drag', 'Move');
  drag.type = 'button'; drag.setAttribute('aria-label', 'Move tuning panel'); drag.title = 'Drag, or use the arrow keys';
  const heading = element('div', 'feel-heading');
  heading.append(element('strong', '', 'Feel'), element('span', '', 'Tune the live app'));
  const toggle = element('button', 'feel-toggle', 'Collapse');
  toggle.type = 'button'; toggle.setAttribute('aria-controls', 'feel-body'); toggle.setAttribute('aria-expanded', 'true');
  header.append(drag, heading, toggle);
  const body = element('div', 'feel-body'); body.id = 'feel-body';
  body.append(element('p', 'feel-intro', 'Changes preview while this panel is open. Collapse to pause the preview.'));
  panel.append(header, body);
  const controls = [];
  let opened = true;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Tuning still works without storage. */ } };
  const restore = () => {
    for (const [name, [value, priority]] of originalInline) value ? root.style.setProperty(name, value, priority) : root.style.removeProperty(name);
    for (const name of SPRINGS) setSpring(name, originalSprings[name]);
    configureMotion(originalMotion);
  };
  const values = (text = 'm') => {
    const out = {};
    if (state.tuned.motion) {
      const page = Math.round(restTime(state.springs.page) / 10) * 10;
      const pop = Math.round(restTime(state.springs.pop) / 10) * 10;
      Object.assign(out, { '--settle': linearCurve(state.springs.page, 410), '--pop': linearCurve(state.springs.pop, 345), '--d-page': `${page}ms`, '--d-sheet': `${page}ms`, '--d-quick': `${pop}ms`, '--d-base': `${pop}ms`, '--d-fast': `${state.pressTime}ms` });
    }
    if (state.tuned.pressTime) out['--d-fast'] = `${state.pressTime}ms`;
    if (state.tuned.pressScale) out['--press-scale'] = String(state.pressScale);
    if (state.tuned.type) Object.assign(out, ramp({ base: state.base, ratio: state.ratio, heroMax: state.heroMax, snapOffRamp: state.snapOffRamp, text }));
    if (state.tuned.density) Object.assign(out, density(state.density));
    return out;
  };
  const apply = () => {
    if (!opened) return;
    restore();
    if (state.tuned.motion) for (const name of SPRINGS) setSpring(name, state.springs[name]);
    if (state.tuned.haptics) configureMotion({ haptics: state.haptics });
    if (state.tuned.reduced) configureMotion({ reduced: state.reduced });
    for (const [name, value] of Object.entries(values(root.dataset.text || 'm'))) root.style.setProperty(name, value);
  };
  const update = (group, action) => { action(); state.tuned[group] = true; apply(); save(); status.textContent = 'Preview updated.'; };
  const fieldset = title => { const group = element('fieldset', 'feel-group'); group.append(element('legend', '', title)); body.append(group); return group; };
  const range = (group, label, id, min, max, step, read, write, tuned, display = String) => {
    const row = element('div', 'feel-control');
    const title = element('label', '', label); title.htmlFor = id;
    const output = element('output'); output.setAttribute('for', id); output.setAttribute('aria-hidden', 'true');
    const input = element('input'); input.type = 'range'; input.id = id; input.min = min; input.max = max; input.step = step;
    const sync = () => { input.value = read(); output.value = display(read()); };
    controls.push(sync); sync();
    input.addEventListener('input', () => { update(tuned, () => write(Number(input.value))); sync(); });
    row.append(title, output, input); group.append(row);
  };
  const checkbox = (group, label, id, name, tuned) => {
    const row = element('label', 'feel-check'); row.htmlFor = id;
    const input = element('input'); input.type = 'checkbox'; input.id = id;
    const sync = () => { input.checked = state[name]; }; controls.push(sync); sync();
    input.addEventListener('change', () => update(tuned, () => { state[name] = input.checked; }));
    row.append(input, element('span', '', label)); group.append(row);
  };
  for (const name of SPRINGS) {
    const title = name[0].toUpperCase() + name.slice(1), group = fieldset(`${title} spring`);
    range(group, `${title} stiffness`, `feel-${name}-stiffness`, 100, 1600, 10, () => state.springs[name].stiffness, value => { state.springs[name].stiffness = value; }, 'motion');
    range(group, `${title} damping`, `feel-${name}-damping`, .5, 1, .01, () => state.springs[name].damping, value => { state.springs[name].damping = value; }, 'motion', value => value.toFixed(2));
  }
  const press = fieldset('Press');
  range(press, 'Scale while held', 'feel-press-scale', .94, 1, .005, () => state.pressScale, value => { state.pressScale = value; }, 'pressScale', value => value.toFixed(3));
  range(press, 'Press-in duration', 'feel-press-time', 60, 200, 10, () => state.pressTime, value => { state.pressTime = value; }, 'pressTime', value => `${value} ms`);
  const type = fieldset('Type');
  range(type, 'Base size', 'feel-base', 13, 16, .5, () => state.base, value => { state.base = value; }, 'type', value => `${value} px`);
  const ratioRow = element('div', 'feel-select');
  const ratioLabel = element('label', '', 'Scale ratio'); ratioLabel.htmlFor = 'feel-ratio'; ratioRow.append(ratioLabel);
  const ratio = element('select'); ratio.id = 'feel-ratio';
  for (const value of [1.125, 1.2, 1.25, 1.333]) { const option = element('option', '', String(value)); option.value = value; ratio.append(option); }
  controls.push(() => { ratio.value = state.ratio; }); ratio.value = state.ratio;
  ratio.addEventListener('change', () => update('type', () => { state.ratio = Number(ratio.value); }));
  ratioRow.append(ratio); type.append(ratioRow);
  range(type, 'Hero maximum', 'feel-hero', 40, 48, 1, () => state.heroMax, value => { state.heroMax = value; }, 'type', value => `${value} px`);
  checkbox(type, 'Snap off-ramp sizes', 'feel-snap', 'snapOffRamp', 'type');
  range(type, 'Line-height density', 'feel-density', .9, 1.1, .01, () => state.density, value => { state.density = value; }, 'density', value => value.toFixed(2));
  const preview = fieldset('Preview');
  checkbox(preview, 'Haptics', 'feel-haptics', 'haptics', 'haptics');
  checkbox(preview, 'Reduced motion', 'feel-reduced', 'reduced', 'reduced');
  const actions = element('div', 'feel-actions');
  const reset = element('button', '', 'Reset'), copy = element('button', '', 'Copy tokens');
  reset.type = copy.type = 'button'; actions.append(reset, copy);
  const status = element('p', 'feel-status', 'File defaults are active.'); status.setAttribute('role', 'status');
  const exportLabel = element('label', 'feel-export-label', 'Tokens to save'); exportLabel.htmlFor = 'feel-export';
  const output = element('textarea', 'feel-export'); output.id = 'feel-export'; output.readOnly = true; output.rows = 6; output.spellcheck = false;
  body.append(actions, status, exportLabel, output);
  reset.addEventListener('click', () => {
    state = defaults(); for (const sync of controls) sync(); restore();
    try { localStorage.removeItem(KEY); } catch {}
    output.value = ''; status.textContent = 'File defaults restored.';
  });
  const exportTokens = () => {
    const tokens = { ...base, ...values('m') };
    const rows = NAMES.map(name => `  ${name}:${tokens[name]};`);
    const sizes = ['s', 'l'].map(text => {
      const axis = state.tuned.type ? ramp({ base: state.base, ratio: state.ratio, heroMax: state.heroMax, snapOffRamp: state.snapOffRamp, text }) : appearance[text];
      return `:root[data-text="${text}"]{--fs-reply:${axis['--fs-reply']};--fs-input:${axis['--fs-input']}}`;
    });
    const engine = SPRINGS.map(name => `${name} ${JSON.stringify(state.tuned.motion ? state.springs[name] : originalSprings[name])}`).join(', ');
    return `:root{\n  /* feel, tuned ${new Date().toISOString().slice(0, 10)} on the owner's phone */\n${rows.join('\n')}\n}\n${sizes.join('\n')}\n/* engine: ${engine} */\n`;
  };
  copy.addEventListener('click', async () => {
    output.value = exportTokens();
    try { await navigator.clipboard.writeText(output.value); status.textContent = 'Tokens copied. The block is also below.'; }
    catch { status.textContent = 'Tokens are ready below. Select the block to copy it.'; }
  });
  const setOpen = value => {
    opened = value; body.hidden = !value; panel.classList.toggle('feel-collapsed', !value);
    toggle.textContent = value ? 'Collapse' : 'Open feel'; toggle.setAttribute('aria-expanded', String(value));
    value ? apply() : restore();
    move(0, 0);
  };
  toggle.addEventListener('click', () => setOpen(!opened));
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  let x = 0, y = 0, held;
  const move = (dx, dy) => {
    const rect = panel.getBoundingClientRect();
    x += Math.max(8 - rect.left, Math.min(innerWidth - 8 - rect.right, dx));
    y += Math.max(8 - rect.top, Math.min(innerHeight - 8 - rect.bottom, dy));
    panel.style.translate = `${x}px ${y}px`;
  };
  drag.addEventListener('pointerdown', event => { event.preventDefault(); held = { id: event.pointerId, x: event.clientX, y: event.clientY }; drag.setPointerCapture(event.pointerId); });
  drag.addEventListener('pointermove', event => { if (!held || event.pointerId !== held.id) return; move(event.clientX - held.x, event.clientY - held.y); held.x = event.clientX; held.y = event.clientY; });
  drag.addEventListener('pointerup', () => { held = null; }); drag.addEventListener('pointercancel', () => { held = null; });
  drag.addEventListener('keydown', event => { const delta = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[event.key]; if (delta) { event.preventDefault(); move(...delta); } });
  window.addEventListener('resize', () => move(0, 0));
  const observer = new MutationObserver(() => { if (opened && state.tuned.type) apply(); });
  observer.observe(root, { attributes: true, attributeFilter: ['data-text'] });
  document.body.append(panel);
  apply();
  if (Object.values(state.tuned).some(Boolean)) status.textContent = 'Your saved preview is active.';
  current = { open: () => setOpen(true), close: () => setOpen(false) };
  return current;
}
