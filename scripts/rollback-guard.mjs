// Whether the deploy's automatic rollback (deploy.yml, OPERATIONS.md §5.1 step 8) may run: only
// over this run's own deployment. A newer deployment made meanwhile by someone else (setting a
// secret in the dashboard makes one) stays live, because a rollback past it would bring back the
// older version's secret values. When the live deployment can't be read, it rolls back as before.
//   npx wrangler deployments status --json \
//     | node scripts/rollback-guard.mjs <version live before> <this run's version> <this run's message>
// Prints `rollback`, `live` (the version from before is live, so there is nothing to undo) or
// `keep: <why>`.

/**
 * @param {any} status the latest deployment, as `wrangler deployments status --json` prints it
 * @param {{ prev: string, ours: string, message: string }} run
 */
export function decide(status, { prev, ours, message }) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const live = [...versions].sort((a, b) => (b?.percentage ?? 0) - (a?.percentage ?? 0))[0]?.version_id;
  if (!live) return 'rollback';
  if (live === prev) return 'live';
  if ((ours && live === ours) || status.annotations?.['workers/message'] === message) return 'rollback';
  const by = status.annotations?.['workers/triggered_by'] ?? status.source ?? 'unknown';
  return `keep: the live deployment (${by}, ${status.created_on ?? 'time unknown'}, version ${live}) is not this run's`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [prev = '', ours = '', message = ''] = process.argv.slice(2);
  let s = '';
  process.stdin.on('data', (d) => (s += d)).on('end', () => {
    let status = null;
    try {
      status = JSON.parse(s);
    } catch {}
    process.stdout.write(decide(status, { prev, ours, message }));
  });
}
