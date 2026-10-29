// A small, deterministic shell parser for the PreToolUse rules. It is not a full POSIX parser:
// it splits a command line into simple commands (on ; && || | & newlines and parentheses), keeps
// quoting, records output-redirect targets, skips heredoc bodies, and also parses the insides of
// $(…), `…`, `bash -c '…'` and `eval …`, so a denied command can't hide in a substitution.

/** @typedef {{words: string[], redirects: string[], inputs: string[]}} Segment */

/** Index of the `)` matching the `(` at `open`, respecting quotes. */
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === "'") { const j = src.indexOf("'", i + 1); i = j < 0 ? src.length : j; continue; }
    if (c === '"') { let j = i + 1; while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1; i = j; continue; }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return i;
  }
  return src.length;
}

/** Reads a heredoc delimiter word starting at i; returns [delimiter, index after it]. */
function heredocWord(src, i) {
  while (src[i] === ' ' || src[i] === '\t' || src[i] === '-') i++;
  let word = '';
  while (i < src.length && !/[\s;&|<>()]/.test(src[i])) {
    if (src[i] === "'" || src[i] === '"') { const q = src[i]; const j = src.indexOf(q, i + 1); word += src.slice(i + 1, j < 0 ? src.length : j); i = j < 0 ? src.length : j + 1; continue; }
    if (src[i] === '\\') { word += src[i + 1] ?? ''; i += 2; continue; }
    word += src[i++];
  }
  return [word, i];
}

/**
 * @param {string} src
 * @param {number} [depth]
 * @returns {Segment[]}
 */
export function parseShell(src, depth = 0) {
  /** @type {Segment[]} */
  const segments = [];
  const subs = [];
  const heredocs = [];
  let words = [], redirects = [], inputs = [], cur = null, mode = null; // mode: 'out' | 'in' | 'skip' for the next word
  const pushWord = () => {
    if (cur === null) return;
    if (mode === 'out') redirects.push(cur);
    else if (mode === 'in') inputs.push(cur);
    else if (mode !== 'skip') words.push(cur);
    mode = null;
    cur = null;
  };
  const endSegment = () => {
    pushWord();
    if (words.length || redirects.length || inputs.length) segments.push({words, redirects, inputs});
    words = []; redirects = []; inputs = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { if (src[i + 1] === '\n') { i++; continue; } cur = (cur ?? '') + (src[++i] ?? ''); continue; }
    if (c === "'") { const j = src.indexOf("'", i + 1); const end = j < 0 ? src.length : j; cur = (cur ?? '') + src.slice(i + 1, end); i = end; continue; }
    if (c === '"') {
      let j = i + 1, buf = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) { buf += src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '(') { const end = matchParen(src, j + 1); subs.push(src.slice(j + 2, end)); buf += src.slice(j, end + 1); j = end + 1; continue; }
        if (src[j] === '`') { const k = src.indexOf('`', j + 1); const end = k < 0 ? src.length : k; subs.push(src.slice(j + 1, end)); j = end + 1; continue; }
        buf += src[j++];
      }
      cur = (cur ?? '') + buf;
      i = j;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') { const end = matchParen(src, i + 1); subs.push(src.slice(i + 2, end)); cur = (cur ?? '') + src.slice(i, end + 1); i = end; continue; }
    if (c === '`') { const j = src.indexOf('`', i + 1); const end = j < 0 ? src.length : j; subs.push(src.slice(i + 1, end)); cur = (cur ?? '') + '``'; i = end; continue; }
    if (c === '#' && cur === null) { const j = src.indexOf('\n', i); i = (j < 0 ? src.length : j) - 1; continue; }
    if (c === ' ' || c === '\t') { pushWord(); continue; }
    if (c === '\n') {
      endSegment();
      // Skip heredoc bodies: everything up to each delimiter line.
      while (heredocs.length) {
        const delim = heredocs.shift();
        let j = i + 1;
        for (;;) {
          const nl = src.indexOf('\n', j);
          const line = src.slice(j, nl < 0 ? src.length : nl);
          if (line.trim() === delim || nl < 0) { i = nl < 0 ? src.length : nl; break; }
          j = nl + 1;
        }
      }
      continue;
    }
    if (c === '&' && src[i + 1] === '>') { pushWord(); i += src[i + 2] === '>' ? 2 : 1; mode = 'out'; continue; }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      endSegment();
      if ((c === '|' || c === '&') && src[i + 1] === c) i++;
      continue;
    }
    if (c === '>') {
      if (cur !== null && /^\d+$/.test(cur)) cur = null; else pushWord();
      if (src[i + 1] === '>' || src[i + 1] === '|') i++;
      if (src[i + 1] === '&') { i++; mode = 'skip'; continue; }
      mode = 'out';
      continue;
    }
    if (c === '<') {
      pushWord();
      if (src[i + 1] === '<' && src[i + 2] === '<') { i += 2; mode = 'skip'; continue; }
      if (src[i + 1] === '<') { const [delim, next] = heredocWord(src, i + 2); heredocs.push(delim); i = next - 1; continue; }
      mode = 'in';
      continue;
    }
    cur = (cur ?? '') + c;
  }
  endSegment();
  if (depth < 4) {
    for (const sub of subs) segments.push(...parseShell(sub, depth + 1));
    for (const seg of [...segments]) {
      const {cmd, args} = unwrap(seg.words);
      if (['bash', 'sh', 'zsh', 'dash'].includes(cmd)) {
        const k = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a));
        if (k >= 0 && args[k + 1] !== undefined) segments.push(...parseShell(args[k + 1], depth + 1));
      }
      if (cmd === 'eval' && args.length) segments.push(...parseShell(args.join(' '), depth + 1));
    }
  }
  return segments;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
export const base = word => String(word).split('/').pop();

/**
 * Strips leading VAR=… assignments and wrapper commands (sudo, env VAR=…, nohup, time, timeout, nice,
 * command, exec, xargs, npx, pnpm exec, yarn). `bareEnv` is true for `env` with no command after it.
 * @param {string[]} words
 * @returns {{cmd: string, args: string[], bareEnv: boolean}}
 */
export function unwrap(words) {
  let w = [...words];
  for (let guard = 0; guard < 10; guard++) {
    while (w.length && ASSIGNMENT.test(w[0])) w.shift();
    const head = base(w[0] ?? '');
    if (head === 'env') {
      w.shift();
      while (w.length && (w[0].startsWith('-') || ASSIGNMENT.test(w[0]))) { const f = w.shift(); if (f === '-u' || f === '-C' || f === '-S') w.shift(); }
      if (!w.length) return {cmd: 'env', args: [], bareEnv: true};
      continue;
    }
    if (['sudo', 'nohup', 'time', 'command', 'exec', 'xargs', 'npx', 'builtin'].includes(head)) {
      w.shift();
      while (w.length && w[0].startsWith('-')) { const f = w.shift(); if (['-u', '-g', '-n', '-I', '-p'].includes(f)) w.shift(); }
      continue;
    }
    if (head === 'nice') { w.shift(); if (w[0] === '-n') w.splice(0, 2); else if (/^-\d+$/.test(w[0] ?? '')) w.shift(); continue; }
    if (head === 'timeout') { w.shift(); while (w.length && w[0].startsWith('-')) { const f = w.shift(); if (f === '-s' || f === '-k') w.shift(); } w.shift(); continue; }
    if ((head === 'pnpm' || head === 'yarn' || head === 'bunx') && w.length > 1) { w.shift(); if (w[0] === 'exec' || w[0] === 'dlx') w.shift(); continue; }
    break;
  }
  return {cmd: base(w[0] ?? ''), args: w.slice(1), bareEnv: false};
}
