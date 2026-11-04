// The phrase and shape lints (shared/contract/lint.ts, BEHAVIOR.md §2.2 and §10): each banned shape
// refuses its case in the place it names and lets a near neighbour through; a reply that is only a
// list is refused, a list after a sentence is not; code is exempt; the phrase lint alone takes
// none of the shapes (cards, home lines and the night's lines keep it). Invented lines only.
import { describe, expect, it } from 'vitest';
import { BANNED_SHAPES, lintChatReply, lintMindText, lintShape, ONLY_A_LIST } from '../../../shared/contract/lint.ts';

/** Each shape: a reply it refuses, and one it lets through. */
const CASES: Record<string, [string, string]> = {
  sure: ['Sure, it is moved.', 'Fairly sure, about four in five.'],
  certainly: ['Certainly. The later train.', 'The later train, certainly the quieter one.'],
  absolutely: ['Absolutely, done.', 'It is absolutely dry until four.'],
  'of course': ['Of course. Queued.', 'The course starts at ten.'],
  'here are': ['Rain from four. Here are the details.', 'The keys you asked about are here.'],
  'options:': ['Two ways. Options: train or bus.', 'You have two good ways: the train or the bus.'],
  'let me know if': ['Moved to Friday. Let me know if that works.', 'Moved to Friday; you let me know when it suits.'],
  'want me to': ['I can move it to Friday, want me to?', 'You said you want me to stop raising it, so I have.'],
  'would you like me to': ['Done. Would you like me to book it too?', 'Done. Booked, as you would like.'],
  'feel free to': ['It is on the shelf. Feel free to skip it.', 'It is on the shelf; you are free to skip it.'],
};

describe('the shape lint', () => {
  it('has a case for every banned shape, refused in its place and its neighbour let through', () => {
    expect(Object.keys(CASES).sort()).toEqual(BANNED_SHAPES.map((s) => s.phrase).sort());
    for (const s of BANNED_SHAPES) {
      const [bad, good] = CASES[s.phrase];
      expect(lintShape(bad), bad).toBe(`banned shape: "${s.phrase}" (${s.at})`);
      expect(lintShape(good), good).toBeNull();
      expect(lintChatReply(bad), bad).not.toBeNull();
      // The phrase lint alone, which cards and the night's lines take, refuses none of them.
      expect(lintMindText(bad), bad).toBeNull();
    }
  });

  it('refuses a reply that is only a list, not a sentence with a list after it, nor code', () => {
    expect(lintShape('- the dentist at 9:30\n- choir at six')).toBe(ONLY_A_LIST);
    expect(lintShape('1. train\n2. bus')).toBe(ONLY_A_LIST);
    expect(lintShape('Two on tomorrow:\n- the dentist at 9:30\n- choir at six')).toBeNull();
    expect(lintShape('Fixed.\n```\n- a\n- b\n```')).toBeNull();
    expect(lintShape('```\nlet me know if\n```')).toBeNull();
  });

  it('runs the phrase lint first in a chat reply, and lets the register through', () => {
    expect(lintChatReply('Great question. The dentist at 9:30.')).toBe('banned phrase: "great question"');
    for (const line of [
      'Morning. The first thing today is at ten.',
      'I was wrong about Tuesday. I have written that down.',
      "I don't know. Give me the evening.",
      'Surely the later train: it has the better light.',
    ])
      expect(lintChatReply(line), line).toBeNull();
  });
});
