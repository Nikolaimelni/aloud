import { AloudError } from '../errors';
import { Resampler } from './resample';
import { TARGET_SAMPLE_RATE, type AudioSource, type FrameHandler } from './source';
import { decodeWav } from './wav';

/** At full speed the loop never awaits, so it hands the thread back every so often. */
const YIELD_EVERY = 128;

export type WavSourceOptions = {
  readonly data: ArrayBuffer;
  /** Input samples per frame, before resampling. 1024 is what the capture worklet posts. */
  readonly frameSize?: number;
  /** 1 is real time. Infinity is as fast as the machine manages, which is what CI wants. */
  readonly speed?: number;
};

/**
 * The same pipeline the microphone feeds, fed from a file instead. This is the adapter that
 * makes accuracy measurable: the same audio on every run, and a transcript that either
 * matches the reference or does not.
 */
export class WavSource implements AudioSource {
  private running = false;
  private stopped = false;
  private done: () => void = () => {};

  readonly finished = new Promise<void>((resolve) => {
    this.done = resolve;
  });

  private readonly options: WavSourceOptions;

  constructor(options: WavSourceOptions) {
    this.options = options;
  }

  async start(onFrame: FrameHandler): Promise<void> {
    if (this.running) {
      throw new AloudError('capture-failed', 'source is already running');
    }
    // Stopped before it started: the session is over, and `finished` has already resolved.
    if (this.stopped) return;

    const { sampleRate, samples } = decodeWav(this.options.data);
    const frameSize = this.options.frameSize ?? 1024;
    const speed = this.options.speed ?? Infinity;
    this.running = true;

    void this.pump(samples, sampleRate, frameSize, speed, onFrame);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.done();
  }

  private async pump(
    samples: Float32Array,
    sampleRate: number,
    frameSize: number,
    speed: number,
    onFrame: FrameHandler,
  ): Promise<void> {
    const resampler = new Resampler(sampleRate);
    const delay = resampler.delaySamples / TARGET_SAMPLE_RATE;
    const frameMs = (frameSize / sampleRate / speed) * 1000;
    let produced = 0;
    let sinceYield = 0;

    for (let at = 0; at < samples.length && this.running; at += frameSize) {
      const end = Math.min(at + frameSize, samples.length);
      const block = resampler.process(samples.subarray(at, end));

      if (block.length > 0) {
        await onFrame({ samples: block, time: Math.max(0, produced / TARGET_SAMPLE_RATE - delay) });
        produced += block.length;
      }

      if (Number.isFinite(frameMs)) {
        await sleep(frameMs);
      } else if (++sinceYield === YIELD_EVERY) {
        sinceYield = 0;
        await sleep(0);
      }
    }

    await this.stop();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
