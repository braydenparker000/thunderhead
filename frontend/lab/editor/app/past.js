// @ts-check
// A photo's history and its versions (docs/design/EDITOR.md). History is every step the edit took, each with the
// whole edit as it then stood, so going back is putting one of them on again. A version is an edit kept by
// name. Both are saved with the photo's edit on this phone; neither copies the RAF.

/** An edit: every adjustment's value, the white balance's name and the look. @typedef {{ values: Record<string, number>, wb: string, profile: string }} State */
/** @typedef {{ key: string, name: string, val: string, st: State }} Step */
/** @typedef {{ steps: Step[], at: number, versions: { name: string, st: State }[] }} Past */
const MOST = 60, PAUSE = 1500;   // steps kept; a control still for this long starts a new step when it moves again

export const copy = (/** @type {State} */ st) => ({ values: { ...st.values }, wb: st.wb, profile: st.profile });
/** Whether two edits are one. Temp and Tint only count when set by hand: otherwise the white balance's name says it. @param {State} a @param {State} b */
export const same = (a, b) => a.wb === b.wb && a.profile === b.profile
  && Object.keys({ ...a.values, ...b.values }).every((k) => ((k === 'Temp' || k === 'Tint') && a.wb !== 'Custom') || a.values[k] === b.values[k]);
const sound = (/** @type {any} */ st) => !!st && typeof st === 'object' && !!st.values && typeof st.values === 'object' && typeof st.wb === 'string' && typeof st.profile === 'string';

/** A photo's past from its saved edit. With none saved it starts at `first` (the photo as imported), and holds
 * the edit as found after it when that is something else. @param {any} saved @param {State} first @param {State} now @returns {Past} */
export function load(saved, first, now) {
  const steps = /** @type {Step[]} */ (Array.isArray(saved?.steps) ? saved.steps.filter((/** @type {any} */ s) => s && sound(s.st)).map((/** @type {any} */ s) => ({ key: '', name: String(s.name), val: String(s.val ?? ''), st: copy(s.st) })) : []);
  if (!steps.length) { steps.push({ key: '', name: 'Imported', val: 'RAF', st: copy(first) }); if (!same(first, now)) steps.push({ key: '', name: 'Earlier edits', val: '', st: copy(now) }); }
  const versions = Array.isArray(saved?.versions) ? saved.versions.filter((/** @type {any} */ v) => v && sound(v.st)).map((/** @type {any} */ v) => ({ name: String(v.name), st: copy(v.st) })) : [];
  return { steps, at: Number.isInteger(saved?.at) ? Math.max(0, Math.min(steps.length - 1, saved.at)) : steps.length - 1, versions };
}

let moved = 0;
/** Notes an edit: a new step, or the last one again while the same control keeps moving. An edit made after
 * going back starts a new branch: the steps that were ahead are dropped.
 * @param {Past} p @param {string} key the control ('' for an edit that is always its own step) @param {string} name @param {string} val @param {State} st */
export function note(p, key, name, val, st) {
  const last = p.steps[p.at], now = Date.now(), on = !!key && p.at > 0 && p.at === p.steps.length - 1 && last.key === key && now - moved < PAUSE;
  moved = now;
  if (on) { Object.assign(last, { name, val, st: copy(st) }); return; }
  p.steps.length = p.at + 1;
  p.steps.push({ key, name, val, st: copy(st) });
  if (p.steps.length > MOST) p.steps.splice(1, p.steps.length - MOST);   // the oldest go, never the import
  p.at = p.steps.length - 1;
}
/** What is saved of it. @param {Past} p */
export const dump = (p) => ({ steps: p.steps.map(({ name, val, st }) => ({ name, val, st })), at: p.at, versions: p.versions });
