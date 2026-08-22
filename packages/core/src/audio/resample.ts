import { AloudError } from '../errors';
import { TARGET_SAMPLE_RATE } from './source';

/**
 * Half-length of the prototype filter, measured in samples of the slower rate.
 * Wider means a sharper transition band and more multiplies per output sample;
 * at 16 kHz out, 32 costs a few million multiplies a second, which is nothing.
 */
const HALF_LENGTH = 32;
const STOPBAND_DB = 72;

/**
 * The cutoff sits a little below Nyquist so the transition band has somewhere to go.
 * For 48k -> 16k that keeps everything up to ~7.1 kHz and buys ~70 dB by 8 kHz.
 */
const ROLLOFF = 0.94;

/**
 * Rational resampler: windowed-sinc prototype, evaluated as a polyphase bank so the
 * zeros introduced by upsampling are never actually multiplied.
 *
 * Devices hand us 44.1 or 48 kHz and the model wants 16, and dropping every third
 * sample would fold everything above 8 kHz back into the speech band -- sibilants land
 * on top of vowels and the transcript quietly gets worse in a way no one can point at.
 */
export class Resampler {
  readonly inputRate: number;
  readonly outputRate: number;

  private readonly up: number;
  private readonly down: number;
  private readonly tapsPerPhase: number;
  private readonly taps: Float32Array;
  private readonly history: Float32Array;

  private consumed = 0;
  private produced = 0;

  constructor(inputRate: number, outputRate: number = TARGET_SAMPLE_RATE) {
    const input = Math.round(inputRate);
    const output = Math.round(outputRate);
    if (!(input > 0) || !(output > 0)) {
      throw new AloudError(
        'unsupported-sample-rate',
        `cannot resample ${inputRate} Hz to ${outputRate} Hz`,
      );
    }

    this.inputRate = input;
    this.outputRate = output;

    const divisor = gcd(input, output);
    this.up = output / divisor;
    this.down = input / divisor;

    const bank = buildPolyphase(this.up, this.down);
    this.taps = bank.taps;
    this.tapsPerPhase = bank.tapsPerPhase;
    this.history = new Float32Array(bank.tapsPerPhase - 1);
  }

  /** Constant group delay, in output samples. Timestamps should be pulled back by this. */
  get delaySamples(): number {
    return (HALF_LENGTH * Math.max(this.up, this.down)) / this.down;
  }

  /**
   * Feed a block of input, get back however many output samples it completed. The
   * boundary between calls is invisible: state carries the tail of the previous block.
   */
  process(input: Float32Array): Float32Array {
    const { up, down, tapsPerPhase, taps, history } = this;
    const historyLength = history.length;
    const lastIndex = this.consumed + input.length - 1;

    // Largest n whose filter window ends at or before the newest sample we hold.
    const lastOutput = Math.ceil(((lastIndex + 1) * up) / down) - 1;
    const count = Math.max(0, lastOutput - this.produced + 1);
    const out = new Float32Array(count);

    const buffer = new Float32Array(historyLength + input.length);
    buffer.set(history, 0);
    buffer.set(input, historyLength);
    const offset = this.consumed - historyLength;

    for (let k = 0; k < count; k++) {
      const position = (this.produced + k) * down;
      const phase = position % up;
      const newest = (position - phase) / up - offset;
      const start = phase * tapsPerPhase;

      // Both indices are inside their arrays by construction: see the invariant above.
      let sum = 0;
      for (let i = 0; i < tapsPerPhase; i++) {
        sum += taps[start + i]! * buffer[newest - i]!;
      }
      out[k] = sum;
    }

    if (historyLength > 0) {
      history.set(buffer.subarray(buffer.length - historyLength));
    }
    this.consumed += input.length;
    this.produced += count;

    return out;
  }

  reset(): void {
    this.history.fill(0);
    this.consumed = 0;
    this.produced = 0;
  }
}

function buildPolyphase(up: number, down: number): { taps: Float32Array; tapsPerPhase: number } {
  const slower = Math.max(up, down);
  const length = 2 * HALF_LENGTH * slower + 1;
  const cutoff = (0.5 * ROLLOFF) / slower;
  const beta = 0.1102 * (STOPBAND_DB - 8.7);
  const center = (length - 1) / 2;
  const normaliser = besselI0(beta);

  const prototype = new Float64Array(length);
  for (let j = 0; j < length; j++) {
    const t = j - center;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const r = (2 * t) / (length - 1);
    prototype[j] = (sinc * besselI0(beta * Math.sqrt(1 - r * r))) / normaliser;
  }

  const tapsPerPhase = Math.ceil(length / up);
  const taps = new Float32Array(up * tapsPerPhase);

  for (let phase = 0; phase < up; phase++) {
    let sum = 0;
    for (let i = 0; i < tapsPerPhase; i++) {
      const j = phase + i * up;
      if (j < length) sum += prototype[j]!;
    }
    // Each phase is normalised on its own, otherwise DC gain wobbles with the phase
    // and a steady tone comes out amplitude-modulated at the resampling period.
    const scale = sum === 0 ? 0 : 1 / sum;
    for (let i = 0; i < tapsPerPhase; i++) {
      const j = phase + i * up;
      taps[phase * tapsPerPhase + i] = j < length ? prototype[j]! * scale : 0;
    }
  }

  return { taps, tapsPerPhase };
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-14) break;
  }
  return sum;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}
