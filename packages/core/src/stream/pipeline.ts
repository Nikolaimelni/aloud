import type { TranscribeOptions } from '../asr/protocol';
import type { AsrClient } from '../asr/worker-client';
import type { AudioFrame, AudioSource } from '../audio/source';
import type { VadClient } from '../vad/worker-client';
import { Chunker, type AudioWindow, type ChunkerOptions } from './chunker';
import { Stabilizer, type StabilizerState } from './stabilize';

const DEFAULT_BACKPRESSURE = 5;

export interface StreamUpdate extends StabilizerState {
  /** Seconds of audio that have not been through the model yet. */
  readonly backlogSeconds: number;
  readonly lastPassMs: number;
  readonly passes: number;
}

export interface StreamingOptions {
  readonly chunker?: ChunkerOptions;
  readonly transcribe?: TranscribeOptions;
  /**
   * Stop taking frames once this much audio is waiting. A file source honours it and slows
   * down; a microphone cannot, which is what the backlog figure is for.
   */
  readonly backpressureSeconds?: number;
  readonly onUpdate: (update: StreamUpdate) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * Joins the four parts up: frames from a source, a speech flag from the detector, windows
 * from the chunker, hypotheses from the model, and one growing transcript out of the
 * stabiliser. Exactly one inference runs at a time; while it does, audio keeps arriving and
 * the next window simply gets longer. That backlog is reported rather than hidden, because a
 * machine that cannot keep up should say so instead of falling quietly behind.
 */
export class StreamingTranscriber {
  private readonly chunker: Chunker;
  private readonly stabilizer = new Stabilizer();

  private frames: Promise<void> = Promise.resolve();
  private inFlight: Promise<void> | null = null;
  private lastPassMs = 0;
  private passes = 0;
  private done: () => void = () => {};

  readonly finished = new Promise<void>((resolve) => {
    this.done = resolve;
  });

  constructor(
    private readonly source: AudioSource,
    private readonly vad: VadClient,
    private readonly asr: AsrClient,
    private readonly options: StreamingOptions,
  ) {
    this.chunker = new Chunker(options.chunker);
  }

  async start(): Promise<void> {
    await this.source.start((frame) => this.accept(frame));
    void this.source.finished.then(() => this.drain());
  }

  async stop(): Promise<void> {
    await this.source.stop();
    await this.finished;
  }

  private accept(frame: AudioFrame): Promise<void> {
    this.frames = this.frames
      .then(async () => {
        const verdict = await this.vad.classify(frame.samples);
        this.chunker.push(frame, verdict.speech);
        this.pump();

        const limit = this.options.backpressureSeconds ?? DEFAULT_BACKPRESSURE;
        if (this.inFlight && this.chunker.backlogSeconds > limit) {
          await this.inFlight;
        }
      })
      .catch((error: unknown) => this.options.onError?.(error));

    return this.frames;
  }

  private pump(): void {
    if (this.inFlight) return;

    const window = this.chunker.take();
    if (!window) return;

    this.inFlight = this.run(window)
      .catch((error: unknown) => this.options.onError?.(error))
      .finally(() => {
        this.inFlight = null;
        this.pump();
      });
  }

  private async run(window: AudioWindow): Promise<void> {
    const started = performance.now();
    const result = await this.asr.transcribe(window.samples, {
      ...this.options.transcribe,
      timestamps: 'word',
    });

    this.lastPassMs = performance.now() - started;
    this.passes++;

    const state = this.stabilizer.push(
      result.transcript.chunks.map((chunk) => ({
        text: chunk.text,
        start: window.start + chunk.start,
        end: window.start + chunk.end,
      })),
    );

    this.chunker.commit(this.stabilizer.keepAudioFrom);
    this.emit(state);
  }

  private async drain(): Promise<void> {
    await this.frames;
    await this.inFlight;

    const last = this.chunker.flush();
    if (last) {
      await this.run(last).catch((error: unknown) => this.options.onError?.(error));
    }

    this.emit(this.stabilizer.finish());
    this.done();
  }

  private emit(state: StabilizerState): void {
    this.options.onUpdate({
      ...state,
      backlogSeconds: this.chunker.backlogSeconds,
      lastPassMs: this.lastPassMs,
      passes: this.passes,
    });
  }
}
