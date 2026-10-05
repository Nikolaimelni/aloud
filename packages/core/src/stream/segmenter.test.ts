import { describe, expect, it } from 'vitest';
import { TARGET_SAMPLE_RATE } from '../audio/source';
import { Segmenter } from './segmenter';

const FRAME = 0.1;

/** Frames of a tenth of a second from `at`, loud while speaking and near silent otherwise. */
function feed(segmenter: Segmenter, at: number, seconds: number, speech: boolean): number {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i++) {
    const samples = new Float32Array(FRAME * TARGET_SAMPLE_RATE).fill(speech ? 0.3 : 0.001);
    segmenter.push({ samples, time: at + i * FRAME }, speech);
  }
  return at + frames * FRAME;
}

describe('Segmenter', () => {
  it('ends a line at a pause, starting a little before the speech and ending a little after', () => {
    const segmenter = new Segmenter({ pauseSeconds: 0.5 });
    let at = feed(segmenter, 0, 2, false);
    at = feed(segmenter, at, 1, true);
    feed(segmenter, at, 0.6, false);

    const line = segmenter.takeFinal();

    expect(line?.start).toBeCloseTo(1.7, 4);
    expect(line?.end).toBeCloseTo(3.2, 4);
    expect(line?.samples.length).toBe(Math.round(1.5 * TARGET_SAMPLE_RATE));
    expect(segmenter.takeFinal()).toBeNull();
  });

  it('keeps going through a pause shorter than the threshold', () => {
    const segmenter = new Segmenter({ pauseSeconds: 0.5 });
    let at = feed(segmenter, 0, 1, true);
    at = feed(segmenter, at, 0.3, false);
    feed(segmenter, at, 1, true);

    expect(segmenter.takeFinal()).toBeNull();
  });

  it('cuts a line that runs too long where it is quietest', () => {
    const segmenter = new Segmenter({ maxSeconds: 5 });
    let at = feed(segmenter, 0, 3.5, true);
    at = feed(segmenter, at, 0.2, false);
    feed(segmenter, at, 1.4, true);

    const line = segmenter.takeFinal();

    expect(line?.start).toBe(0);
    expect(line?.end).toBeCloseTo(3.5, 4);
  });

  it('never cuts an empty line when the ceiling is shorter than the search', () => {
    const segmenter = new Segmenter({ maxSeconds: 1 });
    feed(segmenter, 0, 3, true);

    const line = segmenter.takeFinal();

    expect(line?.start).toBe(0);
    expect(line?.samples.length).toBeGreaterThan(0);
  });

  it('guesses at the line being spoken no more often than the step', () => {
    const segmenter = new Segmenter({ stepSeconds: 1 });
    let at = feed(segmenter, 0, 0.3, true);
    expect(segmenter.takeGuess()).toBeNull();

    at = feed(segmenter, at, 0.5, true);
    expect(segmenter.takeGuess()?.end).toBeCloseTo(0.8, 4);
    expect(segmenter.takeGuess()).toBeNull();

    feed(segmenter, at, 1, true);
    expect(segmenter.takeGuess()?.end).toBeCloseTo(1.8, 4);
  });

  it('never sends the model the silence between lines', () => {
    const segmenter = new Segmenter({ pauseSeconds: 0.5 });
    let at = feed(segmenter, 0, 1, true);
    at = feed(segmenter, at, 10, false);
    feed(segmenter, at, 1, true);
    segmenter.flush();

    const first = segmenter.takeFinal();
    const second = segmenter.takeFinal();

    expect(first?.end).toBeCloseTo(1.2, 4);
    expect(second?.start).toBeCloseTo(10.7, 4);
    expect(segmenter.takeGuess()).toBeNull();
  });

  it('turns whatever was being said into a line when the stream ends', () => {
    const segmenter = new Segmenter();
    feed(segmenter, 0, 1.2, true);
    segmenter.flush();

    expect(segmenter.takeFinal()?.end).toBeCloseTo(1.2, 4);
  });
});
