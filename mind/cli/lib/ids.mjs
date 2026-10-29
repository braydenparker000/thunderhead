import {createHash, randomBytes} from 'node:crypto';

/** UUIDv7 (RFC 9562): 48-bit ms timestamp, version 7, variant 10, random rest. Lowercase. */
export function uuidv7(now = Date.now()) {
  const b = randomBytes(16);
  let ms = BigInt(now);
  for (let i = 5; i >= 0; i--) { b[i] = Number(ms & 0xffn); ms >>= 8n; }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const sha256 = data => createHash('sha256').update(data).digest('hex');
