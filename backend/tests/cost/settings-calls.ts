// The settings catalogue's calls of the cost suite (cost.test.ts checks every budget): the mind's
// briefing reads each `mind: true` setting by its key (settings/catalog.ts), a row only for one the
// owner has stored, so a briefing is measured before and after every one of them is stored; and the
// Settings pages' PATCH of one catalogue key, and of all of the mind's at once. Run last: the stored
// settings would add their rows to any briefing measured after them.

import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { SETTINGS, type SettingSpec } from '../../../shared/contract/settings';
import { api, apiJson, core, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function settingsCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const pw = `${PASSWORD} new`;
  const d = await grant('192.0.2.250', pw);
  const made = await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
    token: d.token,
    body: { name: 'chat-settings-cost', role: 'mind:chat', current_password: pw },
  });
  const m = { token: made.body.token, headers: { 'TH-Session': 'cse_cost_settings' } };
  await api('GET', '/v1/auth/me', d);
  await api('GET', '/v1/auth/me', m);
  const body = {
    claim: false,
    session_id: 'cse_cost_settings',
    role: 'chat',
    constitution_sha256: 'none',
    th_version: '0.1.0',
  };
  const brief = () => api('POST', '/v1/mind/brief', { ...m, body });
  const k = core();
  await brief();

  await cost('POST /v1/mind/brief (no claim, no setting stored) (Core)', brief, 200, k);
  await cost(
    'PATCH /v1/settings, 1 catalogue key (Core)',
    () => api('PATCH', '/v1/settings', { token: d.token, body: { 'mind.voice': 'warmer' } }),
    200,
    k,
  );
  const mind = (SETTINGS as readonly SettingSpec[]).filter((s) => s.mind);
  await cost(
    `PATCH /v1/settings, every mind setting (${mind.length} keys) (Core)`,
    () =>
      api('PATCH', '/v1/settings', { token: d.token, body: Object.fromEntries(mind.map((s) => [s.key, s.default])) }),
    200,
    k,
  );
  await cost(`POST /v1/mind/brief (no claim, ${mind.length} settings stored) (Core)`, brief, 200, k);
}
