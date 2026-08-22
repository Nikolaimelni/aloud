import { TARGET_SAMPLE_RATE, type AudioFrame } from '../audio/source';

export type ChunkerOptions = {
  /**
   * Seconds of new audio between windows. A pass costs the model about a second whatever
   * the window length, so a step below that just builds a queue. This is the dial.
   */
  readonly stepSeconds?: number;
  /** Ceiling, not the normal case: once text is confirmed the window shrinks back. */
  readonly maxWindowSeconds?: number;
};

export type AudioWindow = {
  readonly samples: Float32Array;
  /** Session time of the first sample. */
  readonly start: number;
};

const DEFAULT_STEP = 1.5;
const DEFAULT_MAX_WINDOW = 20;

/**
 * Holds the audio that has not been confirmed yet and decides when to ask the model again.
 *
 * Windows are cut at the confirmed boundary rather than at a voice activity boundary: the
 * stabiliser confirms whole words, so the cut already lands between words, which is the only
 * property the alignment was ever for. Voice activity is used for the other thing, which is
 * not running the model at all while nobody is talking.
 */
export class Chunker {
  private readonly step: number;
  private readonly maxWindow: number;

  private data: Float32Array;
  private length = 0;

  /** Session time of data[0]. */
  private bufferStart = 0;
  private heard = 0;
  private lastWindowAt = 0;
  private lastSpeechAt = -1;

  constructor(options: ChunkerOptions = {}) {
    this.step = options.stepSeconds ?? DEFAULT_STEP;
    this.maxWindow = options.maxWindowSeconds ?? DEFAULT_MAX_WINDOW;
    this.data = new Float32Array(TARGET_SAMPLE_RATE * 8);
  }

  get bufferedSeconds(): number {
    return this.length / TARGET_SAMPLE_RATE;
  }

  /** Session time of the newest sample it has been given. */
  get heardUntil(): number {
    return this.heard;
  }

  /** Seconds of audio waiting for a window. Climbs when the model cannot keep up. */
  get backlogSeconds(): number {
    return Math.max(0, this.heard - this.lastWindowAt);
  }

  push(frame: AudioFrame, speech: boolean): void {
    this.append(frame.samples);
    this.heard = frame.time + frame.samples.length / TARGET_SAMPLE_RATE;
    if (speech) {
      this.lastSpeechAt = this.heard;
    }
  }

  take(): AudioWindow | null {
    if (this.heard - this.lastWindowAt < this.step) {
      return null;
    }

    // Nobody spoke since the last window. Running the model on silence is how Whisper ends
    // up thanking you for watching.
    if (this.lastSpeechAt <= this.lastWindowAt) {
      this.lastWindowAt = this.heard;
      return null;
    }

    const from = Math.max(0, this.length - Math.round(this.maxWindow * TARGET_SAMPLE_RATE));
    this.lastWindowAt = this.heard;

    return {
      samples: this.data.slice(from, this.length),
      start: this.bufferStart + from / TARGET_SAMPLE_RATE,
    };
  }

  /** Hand over whatever is left, step or no step. For the end of a recording. */
  flush(): AudioWindow | null {
    if (this.length === 0) return null;

    const from = Math.max(0, this.length - Math.round(this.maxWindow * TARGET_SAMPLE_RATE));
    this.lastWindowAt = this.heard;

    return {
      samples: this.data.slice(from, this.length),
      start: this.bufferStart + from / TARGET_SAMPLE_RATE,
    };
  }

  /** Everything before this second is settled, so stop carrying it. */
  commit(until: number): void {
    const drop = Math.min(
      this.length,
      Math.max(0, Math.round((until - this.bufferStart) * TARGET_SAMPLE_RATE)),
    );
    if (drop === 0) return;

    this.data.copyWithin(0, drop, this.length);
    this.length -= drop;
    this.bufferStart += drop / TARGET_SAMPLE_RATE;
  }

  reset(): void {
    this.length = 0;
    this.bufferStart = 0;
    this.heard = 0;
    this.lastWindowAt = 0;
    this.lastSpeechAt = -1;
  }

  private append(samples: Float32Array): void {
    if (this.length + samples.length > this.data.length) {
      const grown = new Float32Array(Math.max(this.data.length * 2, this.length + samples.length));
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    this.data.set(samples, this.length);
    this.length += samples.length;
  }
}
