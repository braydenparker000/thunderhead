// Builds frontend/ui/icons.svg, one <symbol id="<name>"> per name in frontend/ui/icons.txt, from
// @phosphor-icons/core (MIT, regular weight). The sprite is committed; run this after editing the
// list: node scripts/icons.mjs (DESIGN-SYSTEM.md §13). `--check` fails if the committed sprite is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const source = `${repo}node_modules/@phosphor-icons/core/assets/regular/`;
const target = `${repo}frontend/ui/icons.svg`;

export function buildSprite() {
  const names = readFileSync(`${repo}frontend/ui/icons.txt`, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const symbols = names.map((name) => {
    const svg = readFileSync(`${source}${name}.svg`, 'utf8');
    const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect width="256" height="256" fill="none"\/>/g, '').trim();
    return `<symbol id="${name}" viewBox="0 0 256 256">${body}</symbol>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg"><!-- Phosphor Icons (MIT), built by scripts/icons.mjs from ui/icons.txt -->\n${symbols.join('\n')}\n</svg>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sprite = buildSprite();
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== sprite) { console.error('ui/icons.svg is stale: run node scripts/icons.mjs'); process.exit(1); }
  } else writeFileSync(target, sprite);
  console.log(`icons.svg: ${Buffer.byteLength(sprite)} bytes`);
}
