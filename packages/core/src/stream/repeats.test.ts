import { describe, expect, it } from 'vitest';
import { trimLoop } from './repeats';

describe('trimLoop', () => {
  it('cuts a decoder loop back to one copy', () => {
    expect(trimLoop('thank you thank you thank you thank you')).toBe('thank you');
  });

  it('sees through punctuation and case between copies', () => {
    expect(trimLoop('Thank you. Thank you. thank you!')).toBe('Thank you.');
  });

  it('only looks for the loop at the end, which is where a runaway decoder lives', () => {
    const said = 'no no no no no listen I do not like it';
    expect(trimLoop(said)).toBe(said);
  });

  it('does cut a real repetition that happens to end the line', () => {
    // The price of the rule above: a decoder that has come off the rails never stops, so the
    // loop is always at the tail, and anything genuine sitting there looks identical.
    expect(trimLoop('and I said no no no no no')).toBe('and I said no');
  });

  it('leaves a repetition someone actually said alone', () => {
    expect(trimLoop('no no it does not')).toBe('no no it does not');
    expect(trimLoop('I said no no')).toBe('I said no no');
  });
});
