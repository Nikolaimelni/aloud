import { describe, expect, it } from 'vitest';
import { levelOf } from './level';

function constant(value: number, length = 512): Float32Array {
  return new Float32Array(length).fill(value);
}

describe('levelOf', () => {
  it('reads nothing on silence', () => {
    expect(levelOf(constant(0))).toBe(0);
  });

  it('reads full on full scale', () => {
    expect(levelOf(constant(1))).toBe(1);
    expect(levelOf(constant(-1))).toBe(1);
  });

  it('puts half scale halfway up, which a linear meter would not', () => {
    // -30 dBFS is a thirtieth of full amplitude and sits in the middle of a 60 dB scale.
    const halfway = levelOf(constant(10 ** (-30 / 20)));

    expect(halfway).toBeCloseTo(0.5, 2);
  });

  it('has nothing to say about an empty frame', () => {
    expect(levelOf(new Float32Array(0))).toBe(0);
  });
});
