// The lab's "Server speed" (TorBox panel): how fast each of TorBox's file-server groups is from this phone. The
// Worker hands over TorBox's public speed-test files (GET /v1/astra/torbox/servers: a group's label, its region and
// a test file; a web page may not read TorBox's own list), and the page reads the first 1 MB of each, three at a
// time, at most 20 groups (20 MB), only after it has said how much it will read and the owner taps again, and never
// beside a playing film (the lab's film stops first). The table is sorted fastest first: group, region, Mbit/s, the
// first byte's time, and which group the owner's own film came from in the last check. The copied report carries
// the table's words, never an address.

import {rangeRead} from './torbox-check.js';

export const PIECE = 1 << 20, MAX = 20, AT_ONCE = 3;

/** One group timed: {group, region, mbps, first} (mbps null with `error` when the page could not read it). */
export async function timeOne(fetchFn, server, signal) {
  const r = await rangeRead(fetchFn, server.url, `bytes=0-${PIECE - 1}`, PIECE, signal);
  const base = {group: server.group, region: server.region || ''};
  if (!r.readable || !r.bytes) return {...base, mbps: null, first: r.readable ? Math.round(r.first) : null, error: r.readable ? 'nothing read' : 'not readable by the page'};
  const secs = Math.max(1, r.total - r.first) / 1000;
  return {...base, mbps: +(r.bytes * 8 / secs / 1e6).toFixed(1), first: Math.round(r.first), bytes: r.bytes};
}

/** Fastest first; those that could not be read last. */
export const fastest = rows => [...rows].sort((a, b) => (b.mbps ?? -1) - (a.mbps ?? -1));

/** Times `servers` (the first MAX), AT_ONCE at a time; onRow hears each as it ends. Resolves the rows, fastest first. */
export async function timeServers(servers, {fetchFn = (...a) => globalThis.fetch(...a), signal, onRow = () => {}} = {}) {
  const queue = servers.slice(0, MAX), rows = [];
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const row = await timeOne(fetchFn, queue.shift(), signal);
      if (signal?.aborted) return;
      rows.push(row);
      onRow(row, fastest(rows));
    }
  };
  await Promise.all(Array.from({length: AT_ONCE}, worker));
  return fastest(rows);
}

/** The table as report lines: group, region, speed, first byte, and the film's own group marked. No address. */
export function speedLines(rows, filmGroup = '') {
  if (!rows?.length) return [];
  return ['Server speed (1 MB from each of TorBox’s server groups, from this phone, fastest first):',
    ...rows.map(r => `    ${r.group}${r.region ? ` (${r.region})` : ''}: ${r.mbps != null ? `${r.mbps} Mbit/s` : r.error}${r.first != null ? `, first byte ${r.first} ms` : ''}${filmGroup && r.group === filmGroup ? '  ← your film’s server in the last check' : ''}`)];
}

const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children); return e; };

/**
 * The panel's part, placed after `anchor`: the button, a line saying what it will read, and the table. `api` is the
 * page's Worker helper (loaded on first use), `stop()` ends the lab's playback, `busy()` is true while the TorBox
 * check runs, `filmGroup()` the group of the film in the last check. Returns {rows(), lines()} for the report.
 */
export function speedPanel({anchor, api, fetchFn, stop = () => {}, busy = () => false, filmGroup = () => '', onDone = () => {}}) {
  const button = el('button', {type: 'button', className: 'btn', id: 'torbox-speed', textContent: 'Server speed'});
  const hint = el('p', {className: 'hint', id: 'torbox-speed-hint', role: 'status'});
  const table = el('table', {className: 'card speed-table', id: 'torbox-speed-table', hidden: true});
  anchor.after(button, hint, table);
  let servers = null, rows = [], running = null;
  const render = list => {
    const group = filmGroup();
    table.hidden = false;
    table.replaceChildren(el('thead', {}, el('tr', {}, ...['Group', 'Region', 'Mbit/s', 'First byte'].map(t => el('th', {textContent: t})))),
      el('tbody', {}, ...list.map(r => el('tr', {className: group && r.group === group ? 'film' : ''},
        el('td', {textContent: r.group + (group && r.group === group ? ' (your film)' : '')}), el('td', {textContent: r.region || '–'}),
        el('td', {textContent: r.mbps != null ? String(r.mbps) : r.error}), el('td', {textContent: r.first != null ? `${r.first} ms` : '–'})))));
  };
  button.addEventListener('click', async () => {
    if (running) { running.abort(); return; }
    if (busy()) { hint.textContent = 'Wait for the TorBox check to finish first.'; return; }
    if (!servers) {
      hint.textContent = 'Asking your server for TorBox’s test files…';
      try {
        const answer = await (await api())('/v1/astra/torbox/servers');
        const list = (Array.isArray(answer?.servers) ? answer.servers : []).filter(s => s && typeof s.url === 'string' && typeof s.group === 'string');
        if (!list.length) { hint.textContent = answer?.note || 'TorBox listed no test files.'; return; }
        servers = list.slice(0, MAX);
        const mb = Math.round(servers.length * PIECE / 1e6);
        hint.textContent = `This reads 1 MB from each of ${servers.length} TorBox server groups (about ${mb} MB in all), ${AT_ONCE} at a time. The lab’s film stops first.${answer.note ? ` ${answer.note}` : ''}`;
        button.textContent = `Measure (${mb} MB)`;
      } catch (error) { hint.textContent = `Your server could not list them: ${String(error?.message || 'no reason given').replace(/\.$/, '')}.`; }
      return;
    }
    stop();
    running = new AbortController();
    button.textContent = 'Stop';
    rows = [];
    try {
      rows = await timeServers(servers, {fetchFn, signal: running.signal, onRow: (_r, all) => { rows = all; render(all); }});
      render(rows);
      hint.textContent = running.signal.aborted ? 'Stopped.' : `Done: ${rows.filter(r => r.mbps != null).length} of ${rows.length} groups read.`;
      onDone();
    } finally { running = null; servers = null; button.textContent = 'Server speed'; }
  });
  return {rows: () => rows, lines: () => speedLines(rows, filmGroup()), running: () => !!running};
}
