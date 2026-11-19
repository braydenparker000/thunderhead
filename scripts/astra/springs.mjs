// Astra's three springs as CSS tokens (FEEL.md "Tokens"), made from their stiffness and damping by
// frontend/astra/src/ui/spring.js.
//   node scripts/astra/springs.mjs          prints each token, with its overshoot and settle time
//   node scripts/astra/springs.mjs --write  writes them into frontend/astra/src/styles/tokens.css
//   node scripts/astra/springs.mjs --check  fails if tokens.css differs from what the maths gives
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPRINGS, linearEasing, overshoot, settleTime } from '../../frontend/astra/src/ui/spring.js';

const TOKENS = fileURLToPath(new URL('../../frontend/astra/src/styles/tokens.css', import.meta.url));

/** Each spring's token line, as tokens.css carries it. */
export function tokenLines() {
  return Object.entries(SPRINGS).map(([name, s]) => `  --spring-${name}: ${linearEasing(s)};`);
}

/** tokens.css with its spring lines replaced by `lines`; throws when one is missing. */
export function withSprings(css, lines = tokenLines()) {
  let out = css;
  for (const line of lines) {
    const name = line.match(/--spring-[a-z]+/)[0];
    const re = new RegExp(`^  ${name}: [^\\n]*;$`, 'm');
    if (!re.test(out)) throw Error(`tokens.css has no ${name} line`);
    out = out.replace(re, line);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = readFileSync(TOKENS, 'utf8');
  if (process.argv.includes('--check')) {
    if (withSprings(css) !== css) { console.error('tokens.css springs differ from scripts/astra/springs.mjs: run it with --write'); process.exit(1); }
    console.log('tokens.css springs match');
  } else if (process.argv.includes('--write')) {
    writeFileSync(TOKENS, withSprings(css));
    console.log('tokens.css springs written');
  } else {
    for (const [name, s] of Object.entries(SPRINGS))
      console.log(`--spring-${name} (stiffness ${s.stiffness}, damping ${s.damping}, with ${s.duration} ms): overshoot ${(overshoot(s) * 100).toFixed(2)}%, settles in ${Math.round(settleTime(s) * 1000)} ms of spring time`);
    console.log(tokenLines().join('\n'));
  }
}
