// GET /v1/ops/diag's Music part (shared/contract/diag.ts): the music knowledge job's state without a
// name: its phase and times, GET /v1/music/know's counts, each host's record, which keys are present,
// and the facts rows by kind and by the sources each still has to ask. A code layer of the one Music class.
import type { DiagKnow } from '../../../shared/contract/diag.ts';
import * as ks from '../areas/music/know-store';
import { MusicExport } from './music-export';

export abstract class MusicDiag extends MusicExport {
  /** One pass over `know_facts` (kind, busy and todo only), besides the status's own counts. */
  knowDiag(now = Date.now()): DiagKnow {
    const st = ks.knowState(this.db);
    const { albums, songs, artists, filled, picks } = this.knowStatus(now);
    const hosts: DiagKnow['hosts'] = {};
    for (const [host, h] of Object.entries(ks.hostsOf(this.db)))
      hosts[host] = { fails: h.fails, until: h.until, ok_at: h.ok_at ?? null, refused_at: h.refused_at ?? null };
    const facts: DiagKnow['facts'] = {};
    const todo: DiagKnow['todo'] = {};
    const rows = this.db.all<{ kind: string; busy: number; todo: string }>('SELECT kind, busy, todo FROM know_facts');
    for (const r of rows) {
      facts[r.kind] ??= { busy: 0, idle: 0, todo: 0 };
      const f = facts[r.kind];
      if (r.busy) f.busy++;
      else f.idle++;
      const left = r.todo.split(',').filter(Boolean);
      if (left.length) f.todo++;
      for (const s of left) todo[s] = (todo[s] ?? 0) + 1;
    }
    return {
      phase: st.phase,
      at: st.at || null,
      refreshed: st.refreshed,
      top_at: st.top_at,
      picks_at: st.picks_at,
      counts: { albums, songs, artists, filled, picks },
      hosts,
      keys: this.knowKeys(),
      facts,
      todo,
    };
  }
}
