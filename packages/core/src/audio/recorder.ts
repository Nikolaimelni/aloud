import { TARGET_SAMPLE_RATE } from './source';
import { encodeWav } from './wav';

/** Sixteen-bit, because an hour of float32 is a quarter of a gigabyte for no benefit. */
export class Recorder {
  private data: Int16Array;
  private length = 0;

  private readonly sampleRate: number;

  constructor(sampleRate: number = TARGET_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
    this.data = new Int16Array(sampleRate * 30);
  }

  get seconds(): number {
    return this.length / this.sampleRate;
  }

  push(samples: Float32Array): void {
    if (this.length + samples.length > this.data.length) {
      const grown = new Int16Array(Math.max(this.data.length * 2, this.length + samples.length));
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }

    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]!));
      this.data[this.length + i] = Math.round(clamped * 32767);
    }
    this.length += samples.length;
  }

  toWav(): Blob {
    return new Blob([encodeWav(this.data.subarray(0, this.length), this.sampleRate)], {
      type: 'audio/wav',
    });
  }
}
