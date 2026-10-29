// What MEMORY.md §13 says is never stored, as one check the Worker runs on every fact, loose end
// and day note it is asked to keep (`422 never_stored`): keys and tokens by their shapes, a
// password or PIN said with its value, a card number and an IBAN. It errs toward everyday words:
// "my bus pass is in the drawer", a "PIN-protected notebook" and an ISBN are kept.

/** Token and key shapes: this system's own (th1_, thm_, ths_, thc_, tha_, thw_, thfp_) and the
 * common providers', a JWT, a private key block, a Bearer header, and a recovery code. */
const SECRET_SHAPES = [
  /\b(?:th1|thm|ths|thc|tha|thw|thfp)_[A-Za-z0-9_-]{16,}/,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{20,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){4}\b/,
];
/** After the word for a secret: what it is for ("for the gate", "of my laptop", up to 4 words)
 * and then `is`, `was`, `:` or `=`; or a separator alone, or nothing. */
const THEN = String.raw`(?:\s+(?:for|of)(?:\s+[^\s:=]+){1,4}?\s*(is|was|:|=)|\s*(is|was|:|=)?)\s*`;
/** The word for a secret, then its value: "my password is …", "PIN: …", "the passcode for the
 * gate is …". A hyphen after it makes an adjective ("PIN-protected", "password-protected"), and a
 * bare "pass" or a lower-case "pin" is an everyday word ("my bus pass is", "the bridge pin is
 * loose"), so neither counts. */
const SECRET_SAID = [
  new RegExp(String.raw`\b(password|passcode|passphrase|recovery code|pin code)(?!-)${THEN}`, 'gi'),
  new RegExp(String.raw`\b(PIN)\b(?!-)${THEN}`, 'g'),
];
/** Words whose value is a secret whatever it looks like, once it is said ("my password is Summer"). */
const SAID_ONCE = /^pass(?:word|code|phrase)$/i;
/** Words that describe a password rather than being one ("her password was reset"). */
const DESCRIBING = new Set(
  (
    'reset changed weak strong wrong correct fine long short expired old new saved required needed ' +
    'missing forgotten simple complicated secure insecure case-sensitive'
  ).split(' '),
);
/** A lower-case "pin" counts only before 4–8 digits; a card's security code is 3–4. */
const DIGITS_SAID = /\b(?:pin\s*(?:is|was|:|=)\s*\d{4,8}|(?:cvv|cvc|security code)\s*(?:is|was|:|=)?\s*\d{3,4})\b/i;
const QUOTES = '"\'‘’“”`«»';

/** Quoted, or one word of 4 or more characters with a digit or a symbol (trailing punctuation
 * aside): "hunter2", "Tr0ub4dor&3", "'open sesame'"; not "loose" or "in the drawer". */
function secretish(value: string): boolean {
  if (QUOTES.includes(value[0] ?? ' ')) return value.length > 2;
  const word = (value.split(/\s/, 1)[0] ?? '').replace(/[.,;:!?)\]]+$/, '');
  return word.length >= 4 && /\p{N}|[^\p{L}\p{N}\s]/u.test(word);
}

/** The value is one word: nothing follows it, or its sentence ends with it ("is Summer."). */
function oneWord(value: string): boolean {
  const [first = '', ...rest] = value.split(/\s+/);
  return first !== '' && (rest.join('') === '' || /[.!?;,]$/.test(first));
}
const firstWord = (value: string) => (value.split(/\s+/, 1)[0] ?? '').replace(/[.!?;,]+$/, '').toLowerCase();

function passwordSaid(text: string): boolean {
  if (DIGITS_SAID.test(text)) return true;
  for (const re of SECRET_SAID)
    for (const m of text.matchAll(re)) {
      const said = m[2] ?? m[3];
      const value = text.slice((m.index ?? 0) + m[0].length);
      // "Her password was reset": one word that describes it, not the password itself.
      if (!value || (oneWord(value) && DESCRIBING.has(firstWord(value)))) continue;
      // A passphrase is words; a password said in one word is that word.
      if (said && SAID_ONCE.test(m[1]) && (/^passphrase$/i.test(m[1]) || oneWord(value))) return true;
      if (secretish(value)) return true;
    }
  return false;
}

/** Card numbers by their networks' leading digits and lengths (Visa, Mastercard, American Express,
 * Discover, JCB, Diners Club, UnionPay), for an unformatted run of digits. */
const CARD_PREFIX =
  /^(?:4(?:\d{12}|\d{15}|\d{18})|5[1-5]\d{14}|2(?:22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)\d{12}|3[47]\d{13}|6(?:011|5\d\d|4[4-9]\d)\d{12,15}|35(?:2[89]|[3-8]\d)\d{12,15}|3(?:0[0-5]|[689]\d)\d{11,16}|62\d{14,17})$/;
/** Written the way cards are: groups of four (or 4-6-5) with one kind of separator. */
const CARD_GROUPS = /^(?:\d{4}([ -])\d{4}(?:\1\d{4}){1,2}(?:\1\d{1,3})?|\d{4}([ -])\d{6}\2\d{4,5})$/;

/** A card number: it passes the Luhn check and either is written like a card or starts like one.
 * Luhn alone passes one number in ten (order numbers, ISBNs, timestamps). */
function card(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return luhn(digits) && (CARD_GROUPS.test(raw) || CARD_PREFIX.test(digits));
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function iban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  const moved = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : Number(ch);
    rest = Number(`${rest}${v}`) % 97;
  }
  return rest === 1;
}

/** What MEMORY.md §13 says is never stored, if the text holds one: a key or token, a password, a
 * card number (`card`) or a bank account number (an IBAN). */
export function neverStored(text: string): 'secret' | 'password' | 'card' | 'bank' | null {
  if (SECRET_SHAPES.some((re) => re.test(text))) return 'secret';
  if (passwordSaid(text)) return 'password';
  for (const m of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) if (card(m[0])) return 'card';
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g)) if (iban(m[0])) return 'bank';
  return null;
}
