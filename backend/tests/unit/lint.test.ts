// The phrase lint (shared/contract/lint.ts, BEHAVIOR.md §10): each banned phrase is refused, in any
// case, and emoji; code is exempt. A reply's shape is not its business: a list, an opener, an
// offer at the end and a word of sympathy all pass (the shape lint was taken out on 2026-11-11,
// when the owner asked for fewer rules on the chat). Invented lines only.
import { describe, expect, it } from 'vitest';
import * as lint from '../../../shared/contract/lint.ts';
import { BANNED_PHRASES, lintMindText } from '../../../shared/contract/lint.ts';

describe('the phrase lint', () => {
  it('refuses each banned phrase, whatever its case, and emoji', () => {
    for (const p of BANNED_PHRASES) {
      expect(lintMindText(`Well. ${p.toUpperCase()} then.`), p).toBe(`banned phrase: "${p}"`);
    }
    expect(lintMindText('Done 🎉')).toBe('no emoji');
  });

  it('keeps only flattery, pressure and machinery talk', () => {
    expect([...BANNED_PHRASES].sort()).toEqual(
      [
        'amazing work',
        'as an ai language model',
        "don't break your streak",
        'great question',
        'i have successfully',
        'i will now run',
        'keep pushing forward',
        'using the bash tool',
        "you're a natural",
      ].sort(),
    );
  });

  it('leaves code alone', () => {
    expect(lintMindText('Fixed.\n```\nsay "great question"\n```')).toBeNull();
  });

  it('has nothing to say about a reply’s shape', () => {
    for (const line of [
      '- the dentist at 9:30\n- choir at six',
      '1. the train\n2. the bus',
      'Sure, it is moved.',
      'Of course. Queued.',
      'Rain from four. Here are the details.',
      'Two ways. Options: the train or the bus.',
      'Moved to Friday. Let me know if that works.',
      'I can move it to Friday, want me to?',
      "I'm so sorry about your day. Tell me about it, or the quiet mix is there.",
      'Morning. The first thing today is at ten.',
      "I don't know. Give me the evening.",
    ])
      expect(lintMindText(line), line).toBeNull();
    // The shape lint's exports are gone, so nothing can call it by mistake.
    expect(Object.keys(lint).sort()).toEqual(['BANNED_PHRASES', 'lintMindText']);
  });
});
