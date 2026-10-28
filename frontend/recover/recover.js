// /recover/: reset the password with the recovery code, or, with both lost, with a reset ticket
// that works only after 24 h and that any signed-in device can cancel (SIGN-IN.md §8, §10).
// Either way every device is signed out and a new recovery code is shown once.
import { CONFIG } from '/config.js';
import { api, configured } from '/th/client.js';
import { fingerprint, groupCode, makeCode, normalizeCode } from '/th/codes.js';
import { LINES, lineFor } from '/th/copy.js';
import { deviceHints } from '/th/device.js';
import { failure, waitLabel } from '/th/flow.js';
import { kv } from '/th/idb.js';
import { store } from '/th/session.js';
import { countdown, recoveryScreen, toast, wireShowButtons } from '/th/ui.js';

const $ = (s) => document.querySelector(s);
const db = kv('th-recover');
const sr = $('#sr');
const say = (el, text) => { el.textContent = text; sr.textContent = text; };
const POLL_MS = 30_000;

wireShowButtons();

// --- tabs ------------------------------------------------------------------------------------
const tabs = [['#tab-code', '#code-pane'], ['#tab-reset', '#reset-pane']];
let resetStarted = false;
function pick(which) {
  for (const [tab, pane] of tabs) {
    const on = tab === which;
    $(tab).setAttribute('aria-selected', String(on));
    $(pane).hidden = !on;
  }
  if (which === '#tab-reset' && !resetStarted) { resetStarted = true; startReset(); }
}
for (const [tab] of tabs) $(tab).addEventListener('click', () => pick(tab));

/** "Thursday 14:05 (23 h 59 min)" for a moment in ms. */
function readyAt(ms) {
  const d = new Date(ms);
  const left = Math.max(0, ms - Date.now());
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000);
  const when = `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${when} (${h} h ${m} min)`;
}

/** Sign in with the new password and show the new recovery code; then Home. */
async function signedInWithCode(r, username) {
  await store.write({ session_id: r.session_id, token: r.token, signed_in_at: Date.now(), username });
  await db.drop();
  for (const [, pane] of tabs) $(pane).hidden = true;
  document.querySelector('.tabs').hidden = true;
  const done = $('#done');
  done.hidden = false;
  const last5 = await recoveryScreen(done, r.recovery_code);
  await api.confirmRecovery(r.token, last5).catch(() => {});
  location.replace('/');
}

/**
 * Submits one of the two forms: `code` is the recovery code or the reset code.
 * @param {{ button: HTMLButtonElement, line: HTMLElement, label: string, username: string, code: string, password: string }} o
 */
async function recover(o) {
  if (window.top !== window.self || o.button.disabled) return;
  if (!configured) { say(o.line, "Sign-in isn't switched on for this site yet."); return; }
  const code = normalizeCode(o.code);
  if (!code) { say(o.line, LINES.wrong_username_or_code); return; }
  o.button.disabled = true;
  o.button.textContent = 'Resetting…';
  say(o.line, '');
  try {
    const r = await api.recover({ username: o.username, code, new_password: o.password, device: await deviceHints() });
    if ('PasswordCredential' in window) {
      try { await navigator.credentials.store(new window.PasswordCredential({ id: o.username, password: o.password })); } catch {}
    }
    await signedInWithCode(r, o.username);
  } catch (e) {
    const f = failure(e);
    o.button.textContent = o.label;
    if (f.code === 'setup_required') { location.replace('/setup/'); return; }
    if (f.code === 'rate_limited') {
      const until = performance.now() + Math.max(1, f.retryAfter ?? 1) * 1000;
      say(o.line, f.scope === 'account' ? LINES.rate_account : LINES.rate_source);
      countdown(o.button, sr, () => ({ state: performance.now() < until ? 'waiting' : 'idle', waitLeft: (until - performance.now()) / 1000 }), o.label, 'Too many tries from here.', waitLabel);
      return;
    }
    o.button.disabled = false;
    if (f.code === 'reset_not_ready') { showResetState({ reset: 'pending', usable_after: e.details?.usable_after }); say(o.line, ''); return; }
    say(o.line, lineFor(f, { auth: true }));
  }
}

$('#recover').addEventListener('submit', (e) => {
  e.preventDefault();
  recover({ button: $('#go'), line: $('#line'), label: 'Reset password', username: $('#username').value, code: $('#code').value, password: $('#new-password').value });
});

// --- reset ticket ----------------------------------------------------------------------------
let resetCode = '', resetFp = '';

function showResetState(s) {
  const st = $('#rstate'), form = $('#reset');
  const state = s?.reset ?? 'none';
  form.hidden = state !== 'ready';
  $('#reset-start').hidden = state === 'ready' || state === 'pending';
  const lines = {
    none: 'Waiting for the ticket. Ask the mind, or run the workflow.',
    pending: s?.usable_after ? `Your reset will be ready ${readyAt(s.usable_after)}. Any signed-in device can cancel it.` : 'Your reset is waiting. Any signed-in device can cancel it.',
    cancelled: LINES.reset_cancelled,
    expired: LINES.reset_expired,
    used: LINES.reset_used,
    ready: '',
  };
  st.textContent = lines[state] ?? lines.none;
  if (state === 'ready' && !$('#r-code').value) $('#r-code').value = groupCode(resetCode);
}

async function startReset() {
  resetCode = (await db.get('code').catch(() => '')) ?? '';
  if (!resetCode) { resetCode = makeCode(); await db.set('code', resetCode).catch(() => {}); }
  resetFp = await fingerprint(resetCode);
  $('#rfp').textContent = resetFp;
  $('#rfp-say').textContent = resetFp;
  $('#rcode').textContent = groupCode(resetCode);
  if (CONFIG.repo_url) {
    $('#gh-secret').href = `${CONFIG.repo_url}/settings/secrets/actions/new`;
    $('#gh-run').href = `${CONFIG.repo_url}/actions/workflows/auth-reset.yml`;
    $('#gh-links').hidden = false;
  }
  if (!configured) { $('#rstate').textContent = "Sign-in isn't switched on for this site yet."; return; }
  // Every 30 s while the page is in view; one timer only, restarted when it comes back.
  let timer = 0;
  const check = async () => {
    clearTimeout(timer);
    try { showResetState(await api.resetState(resetFp)); } catch {}
    if (!document.hidden) timer = setTimeout(check, POLL_MS);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
}

$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(resetFp); toast('Copied'); } catch { toast('Select the fingerprint and copy it'); }
});
$('#reveal').addEventListener('click', () => {
  const box = $('#rcode');
  box.hidden = !box.hidden;
  $('#reveal').textContent = box.hidden ? 'Show' : 'Hide';
});
$('#reset').addEventListener('submit', (e) => {
  e.preventDefault();
  recover({ button: $('#r-go'), line: $('#r-line'), label: 'Reset password', username: $('#r-username').value, code: $('#r-code').value, password: $('#r-new-password').value });
});

if (location.hash === '#reset') pick('#tab-reset');
