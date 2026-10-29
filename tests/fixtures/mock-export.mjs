// "Download everything" and the backups list of the mocked Worker (API.md §11.16, §11.24): the
// password again ('right password here'), the export building for `readyAfter` polls, then ready
// with its ZIP (a few synthetic bytes, served by mock-api.mjs as application/zip).

export const EXPORT_ID = '0192f0c4-0000-7000-8000-00000000e001';
export const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

export function exportState() {
  return {
    started: false,
    polls: 0,
    readyAfter: 2,
    failed: false,
    backups: [
      { date: '2026-10-25', class: 'core', rows: 1234, bytes: 56_789, complete: true, started_at: Date.parse('2026-10-25T02:30:00Z'), finished_at: Date.parse('2026-10-25T03:20:00Z') },
    ],
  };
}

const err = (status, code) => [status, { error: { code, message: code, request_id: 'test' } }];

/** GET /v1/ops/backups, POST /v1/export, GET /v1/export/:id; null for anything else. */
export function exportAnswer(s, method, p, body) {
  if (!s) return null;
  if (method === 'GET' && p === '/v1/ops/backups') return [200, { items: s.backups, next: null }];
  if (method === 'POST' && p === '/v1/export') {
    if (body?.password !== 'right password here') return err(401, 'current_password_wrong');
    s.started = true;
    s.polls = 0;
    return [202, { export_id: EXPORT_ID }];
  }
  if (method === 'GET' && p === `/v1/export/${EXPORT_ID}`) {
    if (!s.started) return err(404, 'not_found');
    const last_backup = s.backups[0] ? { date: s.backups[0].date, finished_at: s.backups[0].finished_at } : null;
    if (s.failed) return [200, { status: 'failed', progress: 40, items: [], last_backup }];
    s.polls++;
    if (s.polls <= s.readyAfter) return [200, { status: 'building', progress: Math.round((s.polls / (s.readyAfter + 1)) * 100), items: [], last_backup }];
    return [200, { status: 'ready', progress: 100, items: [{ label: 'thunderhead-export-2026-10-29.zip', url: `/v1/export/${EXPORT_ID}/zip`, bytes: 2_345_678, expires_at: Date.now() + 3_600_000 }], last_backup }];
  }
  return null;
}
