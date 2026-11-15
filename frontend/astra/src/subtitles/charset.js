// A subtitle file's bytes as text. Most files are UTF-8; older ones are in
// the code page their language used on Windows, which the bytes do not name.
// The language (an add-on's, or the one the viewer chose when picking a file
// from the phone) is therefore a hint, checked against the bytes: French
// loaded under "Russian" must not come out in Cyrillic letters.

import {baseLanguage, preferredLanguages} from '../engine/languages.js';

const CYRILLIC = 'windows-1251', CENTRAL = 'windows-1250', ARABIC = 'windows-1256', BALTIC = 'windows-1257';
const PAGES = {ru: CYRILLIC, uk: CYRILLIC, bg: CYRILLIC, mk: CYRILLIC, be: CYRILLIC, kk: CYRILLIC, ky: CYRILLIC, mn: CYRILLIC, tg: CYRILLIC,
  ar: ARABIC, fa: ARABIC, ur: ARABIC, he: 'windows-1255', el: 'windows-1253', th: 'windows-874', ko: 'euc-kr',
  pl: CENTRAL, cs: CENTRAL, sk: CENTRAL, hu: CENTRAL, ro: CENTRAL, hr: CENTRAL, sl: CENTRAL, bs: CENTRAL,
  tr: 'windows-1254', az: 'windows-1254', vi: 'windows-1258', lt: BALTIC, lv: BALTIC, et: BALTIC};
// Pages whose letters above ASCII are another script, not accented Latin letters.
const OTHER_SCRIPT = /^(windows-125[1356]|windows-874|gb18030|big5|shift_jis|euc-jp|euc-kr)$/;

/** The code pages a language's old files use, likeliest first. Takes 'el', 'gre', 'ell', 'el-GR', 'zh-TW'. */
export function codePages(language) {
  const raw = String(language || '').trim(), lang = baseLanguage(raw);
  let script = '';
  try { script = new Intl.Locale(Intl.getCanonicalLocales(raw)[0]).maximize().script || ''; } catch {}
  if (lang === 'zh') return script === 'Hant' ? ['big5', 'gb18030'] : ['gb18030', 'big5']; // Traditional (Taiwan, Hong Kong) or Simplified
  if (lang === 'ja') return ['euc-jp', 'shift_jis']; // Shift_JIS bytes are never valid EUC-JP, so the wrong one is seen at once
  if (lang === 'sr') return script === 'Latn' ? [CENTRAL, CYRILLIC] : [CYRILLIC, CENTRAL]; // written in both alphabets
  return PAGES[lang] ? [PAGES[lang]] : [];
}

const count = (text, ch) => { let n = 0; for (let i = text.indexOf(ch); i >= 0; i = text.indexOf(ch, i + 1)) n++; return n; };

/**
 * True when the bytes above ASCII sit inside words of ASCII letters ("café",
 * "über"), as in every Latin-alphabet language. In Cyrillic, Greek, Hebrew,
 * Arabic, Thai, Chinese, Japanese and Korean files they form whole words.
 * Only words holding such a byte count, so tags and ASS headers do not sway it.
 */
export function looksLatin(bytes) {
  let letters = 0, high = 0, a = 0, h = 0;
  const end = Math.min(bytes.length, 1 << 16);
  for (let i = 0; i <= end; i++) {
    const b = i < end ? bytes[i] : 0, lower = b | 0x20;
    if (b >= 0x80) h++;
    else if (lower >= 0x61 && lower <= 0x7a) a++;
    else { if (h) { letters += a; high += h; } a = h = 0; }
  }
  return letters >= 0.45 * (letters + high);
}

/** A subtitle file's text: UTF-8 or UTF-16 when the bytes say so, else the likeliest old code page. */
export function decodeText(bytes, language = '', viewer = preferredLanguages()) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  // UTF-16 without a mark: every other byte is zero in Latin text (the times
  // and tags of any subtitle file). Looked for first, since zeros are valid UTF-8.
  const pairs = Math.min(bytes.length, 400) >> 1;
  let odd = 0, even = 0;
  for (let i = 0; i < pairs; i++) { if (bytes[2 * i] === 0) even++; if (bytes[2 * i + 1] === 0) odd++; }
  if (pairs && odd > pairs * 0.6 && even < pairs * 0.1) return new TextDecoder('utf-16le').decode(bytes);
  if (pairs && even > pairs * 0.6 && odd < pairs * 0.1) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch {}
  // UTF-8 with a few damaged letters (or a mark and then damage) is still UTF-8: one bad byte must not garble the rest.
  const utf8 = new TextDecoder('utf-8').decode(bytes), bad = count(utf8, '�');
  let good = 0;
  for (let i = 0; i < utf8.length; i++) { const c = utf8.charCodeAt(i); if (c >= 0x80 && c !== 0xfffd && (c < 0xdc00 || c > 0xdfff)) good++; }
  if (good >= 10 * bad) return utf8;
  // An old code page: the language's, then the viewer's own languages', then Western European.
  let pages = [...codePages(language), ...viewer.flatMap(codePages)];
  if (looksLatin(bytes)) pages = pages.filter(p => !OTHER_SCRIPT.test(p));
  let high = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) high++;
  for (const page of [...new Set(pages)]) {
    // A page the bytes do not fit leaves holes; a damaged byte or two is forgiven.
    try { const text = new TextDecoder(page).decode(bytes); if (count(text, '�') <= high / 50) return text; } catch {}
  }
  return new TextDecoder('windows-1252').decode(bytes);
}
