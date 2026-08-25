import { describe, expect, it } from 'vitest';
import { pickKeyLines } from './select';

/** Unit vectors in two dimensions, which is enough to argue about angles. */
function at(degrees: number): Float32Array {
  const radians = (degrees * Math.PI) / 180;
  return new Float32Array([Math.cos(radians), Math.sin(radians)]);
}

const LONG = 'a line with quite enough words in it to count';

describe('pickKeyLines', () => {
  it('takes the line nearest the middle of what was said', () => {
    const texts = [LONG, LONG, LONG];
    const vectors = [at(0), at(45), at(90)];

    expect(pickKeyLines(texts, vectors, { count: 1 })).toEqual([1]);
  });

  it('would rather cover two subjects than the same one twice', () => {
    const texts = [LONG, LONG, LONG];
    // Two lines about the same thing, one about something else.
    const vectors = [at(0), at(2), at(88)];

    const picked = pickKeyLines(texts, vectors, { count: 2, diversity: 0.5 });

    expect(picked).toHaveLength(2);
    expect(picked).toContain(2);
    expect(picked.includes(0) && picked.includes(1)).toBe(false);
  });

  it('ignores the noises people make while thinking', () => {
    const texts = ['yeah', 'mm hm', LONG, 'right'];
    const vectors = [at(0), at(1), at(2), at(3)];

    expect(pickKeyLines(texts, vectors, { count: 3 })).toEqual([2]);
  });

  it('hands back transcript order, not ranking order', () => {
    const texts = [LONG, LONG, LONG, LONG];
    const vectors = [at(0), at(120), at(240), at(300)];

    const picked = pickKeyLines(texts, vectors, { count: 3 });

    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
  });

  it('asks for no more than it has', () => {
    const picked = pickKeyLines([LONG, LONG], [at(0), at(30)], { count: 9 });
    expect(picked).toHaveLength(2);
  });

  it('has nothing to say about an empty transcript', () => {
    expect(pickKeyLines([], [], { count: 3 })).toEqual([]);
    expect(pickKeyLines(['yeah'], [at(0)], { count: 3 })).toEqual([]);
  });

  it('scales the default count with the length of the transcript', () => {
    const many = Array.from({ length: 60 }, () => LONG);
    const vectors = many.map((_, index) => at(index * 6));

    const picked = pickKeyLines(many, vectors);

    expect(picked.length).toBeGreaterThanOrEqual(3);
    expect(picked.length).toBeLessThanOrEqual(8);
  });
});
