// /setup/: first-time setup, once, from the phone (SIGN-IN.md §4). The page makes a setup code,
// keeps it on this device and shows only its fingerprint; the owner installs the fingerprint
// through GitHub or Cloudflare, then chooses a username and password here.
import { CONFIG } from '/config.js';
import { api, configured } from '/th/client.js';
import { fingerprint, makeCode } from '/th/codes.js';
import { LINES, lineFor } from '/th/copy.js';
import { deviceHints } from '/th/device.js';
import { failure, waitLabel } from '/th/flow.js';
import { kv } from '/th/idb.js';
import { store } from '/th/session.js';
import { countdown, recoveryScreen, toast, wireShowButtons } from '/th/ui.js';

const $ = (s) => document.querySelector(s);
const db = kv('th-setup');
const POLL_MS = 5000, POLL_FOR_MS = 10 * 60 * 1000;
const sr = $('#sr'), wait = $('#wait'), line = $('#line'), create = $('#create');
const say = (el, text) => { el.textContent = text; sr.textContent = text; };
const show = (id) => { for (const s of ['s1', 's2', 's3', 's4']) $(`#${s}`).hidden = s !== id; };
let code = '', fp = '', poll = 0;

wireShowButtons();

async function loadCode(fresh = false) {
  code = fresh ? '' : ((await db.get('code').catch(() => '')) ?? '');
  if (!code) {
    code = makeCode();
    await db.set('code', code).catch(() => {});
  }
  fp = await fingerprint(code);
  $('#fp').textContent = fp;
}

if (CONFIG.repo_url) {
  $('#gh-secret').href = `${CONFIG.repo_url}/settings/secrets/actions/new`;
  $('#gh-run').href = `${CONFIG.repo_url}/actions/workflows/auth-setup.yml`;
  $('#gh-links').hidden = false;
}

let ready = true;
if (!configured) {
  say(wait, "Sign-in isn't switched on for this site yet.");
  $('#done').disabled = true;
} else {
  const state = await api.authState().catch(() => null);
  if (state?.setup === 'done') { location.replace('/signin/'); ready = false; }
}
if (ready) await loadCode();

$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(fp); toast('Copied'); } catch { toast('Select the fingerprint and copy it'); }
});

$('#restart').addEventListener('click', async () => {
  clearTimeout(poll);
  await db.drop();
  await loadCode(true);
  say(wait, '');
  toast('New fingerprint made');
});

$('#done').addEventListener('click', () => {
  clearTimeout(poll);
  const until = Date.now() + POLL_FOR_MS;
  const check = async () => {
    try {
      const s = await api.authState(fp);
      if (s.setup === 'done') { location.replace('/signin/'); return; }
      if (s.setup_fp === 'ready') { say(wait, ''); show('s2'); $('#username').focus(); return; }
      say(wait, s.setup_fp === 'mismatch' ? 'A different fingerprint is installed. Copy this one again, or start over.' : LINES.setup_fp_missing);
    } catch (e) {
      say(wait, lineFor(failure(e), { auth: true }));
    }
    if (Date.now() < until) poll = setTimeout(check, POLL_MS);
    else say(wait, 'Still not there. Check that the workflow run is green, then tap I\'ve done that again.');
  };
  check();
});

$('#setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (window.top !== window.self || create.disabled) return;
  const username = $('#username').value, password = $('#new-password').value;
  create.disabled = true;
  create.textContent = 'Creating…';
  say(line, '');
  try {
    const r = await api.setup({ setup_code: code, username, password, device: await deviceHints() });
    await store.write({ session_id: r.session_id, token: r.token, signed_in_at: Date.now(), username });
    await db.drop();
    if ('PasswordCredential' in window) {
      try { await navigator.credentials.store(new window.PasswordCredential({ id: username, password })); } catch {}
    }
    show('s3');
    const last5 = await recoveryScreen($('#s3'), r.recovery_code);
    await api.confirmRecovery(r.token, last5).catch(() => {});
    show('s4');
  } catch (err) {
    const f = failure(err);
    create.textContent = 'Create account';
    if (f.code === 'setup_done') { location.replace('/signin/'); return; }
    if (f.code === 'setup_fp_missing') { create.disabled = false; show('s1'); say(wait, LINES.setup_fp_missing); return; }
    if (f.code === 'rate_limited') {
      const until = performance.now() + Math.max(1, f.retryAfter ?? 1) * 1000;
      say(line, f.scope === 'account' ? LINES.rate_account : LINES.rate_source);
      countdown(create, sr, () => ({ state: performance.now() < until ? 'waiting' : 'idle', waitLeft: (until - performance.now()) / 1000 }), 'Create account', 'Too many tries from here.', waitLabel);
      return;
    }
    create.disabled = false;
    say(line, lineFor(f, { auth: true }));
  }
});
