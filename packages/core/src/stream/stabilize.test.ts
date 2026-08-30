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

  it('keeps the audio behind a word it is still unsure about', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('one two three'));
    stabilizer.push(words('one two three four'));

    expect(stabilizer.confirmedUntil).toBeCloseTo(0.9, 6);
    expect(stabilizer.keepAudioFrom).toBeCloseTo(0.5, 6);

    stabilizer.push(words('one two three four five'));
    // "five" starts at 1.2 and is only a guess, so its audio stays, plus the margin in front.
    expect(stabilizer.keepAudioFrom).toBeCloseTo(0.8, 6);
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

  it('does not print a word twice when the context margin hears it again', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('one two three'));
    stabilizer.push(words('one two three four'));

    // "three" ended at 0.9. The next window starts inside the margin, hears it again, and
    // puts its end late enough to get past the time filter.
    const state = stabilizer.push([
      { text: ' three', start: 0.62, end: 1.05 },
      { text: ' four', start: 1.05, end: 1.3 },
      { text: ' five', start: 1.3, end: 1.6 },
    ]);

    expect(textOf(state.confirmed)).toBe('one two three four');
    expect(textOf(state.pending)).toBe('five');
  });

  it('keeps a repeated word that starts after the settled audio', () => {
    const stabilizer = new Stabilizer();
    stabilizer.push(words('I said no'));
    stabilizer.push(words('I said no no'));

    const state = stabilizer.push(words('I said no no'));

    expect(textOf(state.confirmed)).toBe('I said no no');
  });

  it('cuts a decoder loop back to one copy', () => {
    const stabilizer = new Stabilizer();
    const looping = words('thank you thank you thank you thank you');

    stabilizer.push(looping);
    const state = stabilizer.push(looping);

    expect(textOf(state.confirmed)).toBe('thank you');
    expect(state.pending).toEqual([]);
  });

  it('only looks for the loop at the end, which is where a runaway decoder lives', () => {
    const stabilizer = new Stabilizer();
    const said = words('no no no no no listen I do not like it');

    stabilizer.push(said);
    const state = stabilizer.push(said);

    expect(textOf(state.confirmed)).toBe('no no no no no listen I do not like it');
  });

  it('does cut a real repetition that happens to end the window', () => {
    // The price of the rule above: a decoder that has come off the rails never stops, so the
    // loop is always at the tail, and anything genuine sitting there looks identical.
    const stabilizer = new Stabilizer();
    const said = words('and I said no no no no no');

    stabilizer.push(said);
    const state = stabilizer.push(said);

    expect(textOf(state.confirmed)).toBe('and I said no');
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
      expect(seen[i]!.startsWith(seen[i - 1]!)).toBe(true);
    }
    expect(seen.at(-1)).toBe('so the plan is to roll out');
  });
});
