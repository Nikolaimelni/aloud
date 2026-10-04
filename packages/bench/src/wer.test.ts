import { describe, expect, it } from 'vitest';
import { normalise } from './normalise';
import { wordErrorRate } from './wer';

describe('normalise', () => {
  it('drops punctuation and case', () => {
    expect(normalise('Ask not, what your country can do!')).toEqual([
      'ask',
      'not',
      'what',
      'your',
      'country',
      'can',
      'do',
    ]);
  });

  it('treats yo as ye, which is how it is usually typed', () => {
    expect(normalise('ещё')).toEqual(['еще']);
  });

  it('counts a number as the same number however it was written', () => {
    expect(normalise('fifty two')).toEqual(['50', '2']);
    expect(normalise('пятьдесят')).toEqual(['50']);
    expect(normalise('сто штук')).toEqual(['100', 'штук']);
  });

  it('spells out the abbreviations that reference transcripts spell out', () => {
    expect(normalise('Mr. Quilter met Dr. St. John')).toEqual([
      'mister',
      'quilter',
      'met',
      'doctor',
      'saint',
      'john',
    ]);
  });

  it('leaves a word alone that happens to name an object property', () => {
    expect(normalise('a constructor')).toEqual(['a', 'constructor']);
  });
});

describe('wordErrorRate', () => {
  it('is zero when the words match through the punctuation', () => {
    const result = wordErrorRate(
      'ASK NOT WHAT YOUR COUNTRY CAN DO FOR YOU',
      'Ask not, what your country can do for you.',
    );

    expect(result.wer).toBe(0);
    expect(result.hits).toBe(9);
  });

  it('does not punish the model for writing a number as digits', () => {
    expect(
      wordErrorRate('мы можем ему только пятьдесят дать', 'мы можем ему только 50 дать').wer,
    ).toBe(0);
  });

  it('counts a swapped word as one substitution', () => {
    const result = wordErrorRate('we ship on wednesday', 'we ship on thursday');

    expect(result.substitutions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.wer).toBeCloseTo(0.25, 6);
  });

  it('tells a dropped word from an invented one', () => {
    expect(wordErrorRate('one two three', 'one three')).toMatchObject({
      deletions: 1,
      insertions: 0,
      substitutions: 0,
    });
    expect(wordErrorRate('one two three', 'one two extra three')).toMatchObject({
      deletions: 0,
      insertions: 1,
      substitutions: 0,
    });
  });

  it('handles an empty hypothesis as losing everything', () => {
    expect(wordErrorRate('one two three', '').wer).toBe(1);
  });

  it('does not divide by zero when there is nothing to compare against', () => {
    expect(wordErrorRate('', '').wer).toBe(0);
    expect(wordErrorRate('', 'thank you for watching').wer).toBe(1);
  });
});
