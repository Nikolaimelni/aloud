import { describe, expect, it } from 'vitest';
import { Recorder } from './recorder';
import { decodeWav } from './wav';

function tone(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = 0.6 * Math.sin(i / 5);
  return out;
}

describe('Recorder', () => {
  it('writes a WAV its own decoder reads back', async () => {
    const recorder = new Recorder(16_000);
    const source = tone(4000);
    recorder.push(source.subarray(0, 1500));
    recorder.push(source.subarray(1500));

    const decoded = decodeWav(await recorder.toWav().arrayBuffer());

    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.channels).toBe(1);
    expect(decoded.samples.length).toBe(4000);
    for (let i = 0; i < source.length; i++) {
      expect(decoded.samples[i]).toBeCloseTo(source[i]!, 3);
    }
  });

  it('knows how long it has been running', () => {
    const recorder = new Recorder(16_000);
    recorder.push(new Float32Array(8000));
    expect(recorder.seconds).toBeCloseTo(0.5, 6);
  });

  it('grows past its first allocation', () => {
    const recorder = new Recorder(100);
    for (let i = 0; i < 10; i++) recorder.push(new Float32Array(1000));
    expect(recorder.seconds).toBeCloseTo(100, 6);
  });

  it('clips instead of wrapping around', async () => {
    const recorder = new Recorder(16_000);
    recorder.push(new Float32Array([2, -2, 0]));

    const decoded = decodeWav(await recorder.toWav().arrayBuffer());

    expect(decoded.samples[0]).toBeCloseTo(1, 3);
    expect(decoded.samples[1]).toBeCloseTo(-1, 3);
  });
});
