import { describe, expect, it } from 'vitest';
import { Chunker } from './chunker';
import { TARGET_SAMPLE_RATE, type AudioFrame } from '../audio/source';

function feed(chunker: Chunker, from: number, seconds: number, speech = true): number {
  const samples = new Float32Array(Math.round(seconds * TARGET_SAMPLE_RATE));
  samples.fill(from + 1);
  const frame: AudioFrame = { samples, time: from };
  chunker.push(frame, speech);
  return from + seconds;
}

describe('Chunker', () => {
  it('waits for a full step before asking the model anything', () => {
    const chunker = new Chunker({ stepSeconds: 1.5 });

    const at = feed(chunker, 0, 1);
    expect(chunker.take()).toBeNull();

    feed(chunker, at, 1);
    expect(chunker.take()).not.toBeNull();
  });

  it('hands over everything it is holding', () => {
    const chunker = new Chunker({ stepSeconds: 1 });
    const at = feed(chunker, 0, 0.5);
    feed(chunker, at, 0.8);

    const window = chunker.take();

    expect(window?.start).toBe(0);
    expect(window?.samples.length).toBe(Math.round(1.3 * TARGET_SAMPLE_RATE));
  });

  it('stays quiet when nobody spoke since the last window', () => {
    const chunker = new Chunker({ stepSeconds: 1 });
    const spoke = feed(chunker, 0, 1.2, true);
    expect(chunker.take()).not.toBeNull();

    const quiet = feed(chunker, spoke, 1.2, false);
    expect(chunker.take()).toBeNull();

    feed(chunker, quiet, 1.2, true);
    expect(chunker.take()).not.toBeNull();
  });

  it('forgets audio that has been confirmed', () => {
    const chunker = new Chunker({ stepSeconds: 1 });
    const at = feed(chunker, 0, 2);
    chunker.take();
    chunker.commit(1.5);

    feed(chunker, at, 1.2);
    const window = chunker.take();

    expect(window?.start).toBeCloseTo(1.5, 4);
    expect(window?.samples.length).toBe(Math.round(1.7 * TARGET_SAMPLE_RATE));
  });

  it('never hands the model more than the ceiling', () => {
    const chunker = new Chunker({ stepSeconds: 1, maxWindowSeconds: 3 });
    let at = 0;
    for (let i = 0; i < 10; i++) {
      at = feed(chunker, at, 1);
    }

    const window = chunker.take();

    expect(window?.samples.length).toBe(3 * TARGET_SAMPLE_RATE);
    expect(window?.start).toBeCloseTo(7, 4);
  });

  it('flushes nothing at the end of a session nobody spoke in', () => {
    const chunker = new Chunker({ stepSeconds: 1 });
    const at = feed(chunker, 0, 2, false);
    chunker.take();
    feed(chunker, at, 0.5, false);

    expect(chunker.flush()).toBeNull();
  });

  it('flushes nothing when the tail after the last window is silent', () => {
    const chunker = new Chunker({ stepSeconds: 1 });
    const spoke = feed(chunker, 0, 1.2);
    expect(chunker.take()).not.toBeNull();

    feed(chunker, spoke, 0.8, false);

    expect(chunker.flush()).toBeNull();
  });

  it('flushes what was said after the last window', () => {
    const chunker = new Chunker({ stepSeconds: 1 });
    const spoke = feed(chunker, 0, 1.2);
    chunker.take();
    feed(chunker, spoke, 0.4);

    expect(chunker.flush()?.samples.length).toBe(Math.round(1.6 * TARGET_SAMPLE_RATE));
  });

  it('reports the backlog when windows are not being taken', () => {
    const chunker = new Chunker({ stepSeconds: 1 });
    const at = feed(chunker, 0, 2);
    feed(chunker, at, 2);

    expect(chunker.backlogSeconds).toBeCloseTo(4, 4);
    chunker.take();
    expect(chunker.backlogSeconds).toBe(0);
  });
});
