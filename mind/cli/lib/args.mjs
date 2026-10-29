// A small argv parser: `--key value`, `--key=value`, boolean flags, repeatable flags, `--` ends flags.
// A lone `-` is a positional (it means "read stdin").

/**
 * @param {string[]} argv
 * @param {{bool?: string[], repeat?: string[]}} [spec]
 * @returns {{flags: Record<string, any>, rest: string[]}}
 */
export function parseArgs(argv, {bool = [], repeat = []} = {}) {
  /** @type {Record<string, any>} */
  const flags = {};
  const rest = [];
  for (const key of repeat) flags[key] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--') || arg === '--') { rest.push(arg); continue; }
    let key = arg.slice(2);
    let value;
    const eq = key.indexOf('=');
    if (eq >= 0) { value = key.slice(eq + 1); key = key.slice(0, eq); }
    else if (bool.includes(key)) value = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
    else value = true;
    if (repeat.includes(key)) flags[key].push(value);
    else flags[key] = value;
  }
  return {flags, rest};
}
