// A throwaway Worker for the production measurements X1, X3 and X4 (OPERATIONS.md §10,
// SECURITY.md §6.3). The Bench workflow deploys it under a test's own name (thunderhead-x3, -x4,
// -x1), calls it, prints numbers only, and deletes it. It never ships inside thunderhead-api and
// holds nothing real: a fixed dummy password, a fixed salt, and a per-run key (BENCH_KEY) so
// nobody else can spend its CPU while it exists.

import { DurableObject } from 'cloudflare:workers';
import { scryptSync } from 'node:crypto';

interface BenchEnv {
  BENCH: DurableObjectNamespace<Bench>;
  BENCH_KEY: string;
}

const DUMMY = 'correct horse battery staple, not a real password';
const SALT = new Uint8Array(16).fill(7);

export class Bench extends DurableObject<BenchEnv> {
  constructor(ctx: DurableObjectState, env: BenchEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID');
  }

  /** X3 (and T2): one scrypt hash as the Auth object computes it. The log line lets the tail
   * events be grouped by setting; production freezes clocks, so CPU time comes from the tail. */
  kdf(n: number, r: number, p: number): { ok: true; bytes: number } {
    console.log(`kdf n=${n} r=${r} p=${p}`);
    const out = scryptSync(DUMMY, SALT, 32, { N: n, r, p, maxmem: 128 * n * r + 1024 * 1024 });
    return { ok: true, bytes: out.length };
  }

  /** X4 step 1: write "before", take a bookmark, write "after", and ask for that bookmark to be
   * restored at the next start. */
  async pitrStart(): Promise<{ bookmark: string }> {
    this.put('mark', 'before');
    const bookmark = await this.ctx.storage.getCurrentBookmark();
    this.put('mark', 'after');
    return { bookmark };
  }

  /** X4: whether a bookmark for a past time is available (the 30-day window). */
  async pitrForTime(): Promise<{ forTime: boolean }> {
    try {
      return { forTime: Boolean(await this.ctx.storage.getBookmarkForTime(Date.now() - 60_000)) };
    } catch {
      return { forTime: false };
    }
  }

  /** X4 step 2: restore the bookmark at the next start, and restart the object now. */
  async pitrRestore(bookmark: string): Promise<void> {
    await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
    this.ctx.abort();
  }

  /** X4 step 3: "before" means the restore worked. */
  pitrRead(): { mark: string | null } {
    const row = this.ctx.storage.sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', 'mark').toArray()[0];
    return { mark: row?.v ?? null };
  }

  /** X1: a WebSocket the Worker holds while this object hibernates (acceptWebSocket). */
  override async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** X1: wakes the object and sends one message to every waiting socket. */
  poke(): number {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) ws.send('poke');
    return sockets.length;
  }

  override webSocketMessage(): void {}

  override webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code === 1005 ? 1000 : code);
  }

  private put(k: string, v: string): void {
    this.ctx.storage.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, v);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** X1: hold a WebSocket to the object until a message arrives or `timeout` seconds pass. */
async function wait(stub: DurableObjectStub<Bench>, timeout: number): Promise<Response> {
  const started = Date.now();
  const res = await stub.fetch('https://bench/ws', { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) return json({ error: 'no websocket' }, 502);
  ws.accept();
  const got = await new Promise<boolean>((done) => {
    const timer = setTimeout(() => done(false), timeout * 1000);
    ws.addEventListener('message', () => {
      clearTimeout(timer);
      done(true);
    });
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      done(false);
    });
  });
  ws.close(1000);
  return json({ got, waited_ms: Date.now() - started });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.BENCH_KEY || req.headers.get('x-bench-key') !== env.BENCH_KEY) return json({ error: 'unauthorized' }, 401);
    const num = (name: string, fallback: number) => Number(url.searchParams.get(name) ?? fallback);
    const stub = env.BENCH.getByName(url.searchParams.get('object') ?? 'bench');
    switch (url.pathname) {
      case '/kdf':
        return json(await stub.kdf(num('n', 2 ** 15), num('r', 8), num('p', 3)));
      case '/x4/start':
        return json(await stub.pitrStart());
      case '/x4/fortime':
        return json(await stub.pitrForTime());
      case '/x4/restore':
        try {
          await stub.pitrRestore(url.searchParams.get('bookmark') ?? '');
        } catch {
          // abort() ends the call by design; the restore applies at the next start
        }
        return json({ restarted: true });
      case '/x4/read':
        return json(await stub.pitrRead());
      case '/x1/wait':
        return wait(stub, Math.min(num('timeout', 20), 25));
      case '/x1/poke':
        return json({ sockets: await stub.poke() });
      default:
        return json({ error: 'not found' }, 404);
    }
  },
} satisfies ExportedHandler<BenchEnv>;
