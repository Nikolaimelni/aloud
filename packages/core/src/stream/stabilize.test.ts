import { describe, expect, it } from 'vitest';
import { Stabilizer, textOf, type Word } from './stabilize';

/** Whisper hands back words with a leading space, so the tests do too. */
function words(text: string, from = 0, step = 0.3): Word[] {
  return text
    .split(' ')
    .filter(Boolean)
    .map((token, index) => ({
      text: ` ${token}`,
      start: from + index * step,
      end: from + (index + 1) * step,
    }));
}

describe('Stabilizer', () => {
  it('confirms nothing on the first pass, because nothing has agreed with it yet', () => {
    const state = new Stabilizer().push(words('so in college I was'));

    expect(state.confirmed).toEqual([]);
    expect(textOf(state.pending)).toBe('so in college I was');
  });

  it('confirms the part two passes agree on', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('so in college I was'));
    const state = stabilizer.push(words('so in college I worked'));

    expect(textOf(state.confirmed)).toBe('so in college I');
    expect(textOf(state.pending)).toBe('worked');
  });

  it('never rewrites what it has already confirmed', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('we ship on wednesday'));
    stabilizer.push(words('we ship on wednesday'));

    const state = stabilizer.push(words('we shipped on thursday'));

    expect(textOf(state.confirmed)).toBe('we ship on wednesday');
  });

  it('treats punctuation and case as noise when comparing', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('right so the deploy'));
    const state = stabilizer.push(words('Right, so the deploy,'));

    expect(textOf(state.confirmed)).toBe('Right, so the deploy,');
    expect(state.pending).toEqual([]);
  });

  it('drops words that belong to audio it has already settled', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('one two three'));
    stabilizer.push(words('one two three four'));
    expect(stabilizer.confirmedUntil).toBeCloseTo(0.9, 6);

    // A later window still sees "three", but that stretch of audio is done with.
    const state = stabilizer.push(words('three four five', 0.6));

    expect(textOf(state.confirmed)).toBe('one two three four');
    expect(textOf(state.pending)).toBe('five');
  });

  it('cuts a decoder loop back to one copy', () => {
    const stabilizer = new Stabilizer();
    const looping = words('thank you thank you thank you thank you');

    stabilizer.push(looping);
    const state = stabilizer.push(looping);

    expect(textOf(state.confirmed)).toBe('thank you');
    expect(state.pending).toEqual([]);
  });

  it('leaves a repetition someone actually said alone', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('no no it does not'));
    const state = stabilizer.push(words('no no it does not'));

    expect(textOf(state.confirmed)).toBe('no no it does not');
  });

  it('only ever grows the confirmed text, window after window', () => {
    const stabilizer = new Stabilizer();
    const passes = [
      'so the plan',
      'so the plan is',
      'so the plan is to roll',
      'so the plan is to roll out',
      'so the plan is to roll out on friday',
    ];

    const seen: string[] = [];
    for (const pass of passes) {
      seen.push(textOf(stabilizer.push(words(pass)).confirmed));
    }

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].startsWith(seen[i - 1])).toBe(true);
    }
    expect(seen.at(-1)).toBe('so the plan is to roll out');
  });
});
