import { describe, expect, it } from 'vitest';
import { Resampler } from './resample';

function tone(frequency: number, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sin((2 * Math.PI * frequency * i) / rate);
  }
  return out;
}

/** Amplitude at one frequency, Hann-windowed so nothing nearby leaks into the answer. */
function amplitudeAt(signal: Float32Array, frequency: number, rate: number): number {
  let re = 0;
  let im = 0;
  let windowGain = 0;
  for (let i = 0; i < signal.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / signal.length);
    const phase = (2 * Math.PI * frequency * i) / rate;
    re += signal[i]! * w * Math.cos(phase);
    im += signal[i]! * w * Math.sin(phase);
    windowGain += w;
  }
  return (2 * Math.hypot(re, im)) / windowGain;
}

/** Drop the filter's startup transient before measuring anything. */
function steady(signal: Float32Array): Float32Array {
  return signal.subarray(256);
}

describe('Resampler', () => {
  it('passes speech-band content through at unit amplitude', () => {
    const out = new Resampler(48_000).process(tone(1000, 48_000, 1));
    expect(amplitudeAt(steady(out), 1000, 16_000)).toBeCloseTo(1, 2);
  });

  it('keeps the top of the band', () => {
    const out = new Resampler(48_000).process(tone(6000, 48_000, 1));
    expect(amplitudeAt(steady(out), 6000, 16_000)).toBeGreaterThan(0.95);
  });

  it('kills a 10 kHz tone instead of folding it down to 6 kHz', () => {
    const out = new Resampler(48_000).process(tone(10_000, 48_000, 1));
    expect(amplitudeAt(steady(out), 6000, 16_000)).toBeLessThan(1e-3);
  });

  it('handles 44.1 kHz, where the ratio is not an integer', () => {
    const input = tone(1000, 44_100, 1);
    const out = new Resampler(44_100).process(input);

    expect(out.length).toBe(16_000);
    expect(amplitudeAt(steady(out), 1000, 16_000)).toBeCloseTo(1, 2);
  });

  it('rejects aliases at 44.1 kHz too', () => {
    // 9 kHz would fold to 7 kHz, which is inside the band we keep.
    const out = new Resampler(44_100).process(tone(9000, 44_100, 1));
    expect(amplitudeAt(steady(out), 7000, 16_000)).toBeLessThan(1e-3);
  });

  it('does not care how the input is chopped up', () => {
    const input = tone(1200, 48_000, 0.5);

    const whole = new Resampler(48_000).process(input);

    const streamed = new Resampler(48_000);
    const pieces: Float32Array[] = [];
    for (let at = 0; at < input.length; at += 128) {
      pieces.push(streamed.process(input.subarray(at, Math.min(at + 128, input.length))));
    }

    const joined = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
    let written = 0;
    for (const piece of pieces) {
      joined.set(piece, written);
      written += piece.length;
    }

    expect(joined.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) {
      expect(joined[i]).toBeCloseTo(whole[i]!, 6);
    }
  });

  it('reports the group delay it introduces', () => {
    expect(new Resampler(48_000).delaySamples).toBe(32);
  });
});
