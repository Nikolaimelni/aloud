import type { TranscribeOptions } from '../asr/protocol';
import type { AsrClient } from '../asr/worker-client';
import type { AudioFrame, AudioSource } from '../audio/source';
import type { VadClient } from '../vad/worker-client';
import { trimLoop } from './repeats';
import { Segmenter, type SegmenterOptions, type Utterance } from './segmenter';
import type { Segment } from './transcript';

const DEFAULT_BACKPRESSURE = 5;

/** Only the calls made here, so a test can stand in for the workers. */
type Vad = Pick<VadClient, 'reset' | 'classify'>;
type Asr = Pick<AsrClient, 'transcribe'>;

export type StreamUpdate = {
  /** Lines the model has had its final say on. They will not change again. */
  readonly confirmed: readonly Segment[];
  /** The current guess at the line still being spoken. Expect it to be rewritten. */
  readonly pending: string;
  /** Seconds of finished lines still waiting for the model. */
  readonly backlogSeconds: number;
  /** How long after the latest line ended its text was final. */
  readonly confirmedLagSeconds: number;
  readonly heardSeconds: number;
  /** Model time spent on every pass so far, summed here once rather than by each listener. */
  readonly computeMs: number;
  readonly passes: number;
};

export type StreamingOptions = {
  readonly segmenter?: SegmenterOptions;
  readonly transcribe?: TranscribeOptions;
  /**
   * Once this many seconds of lines are waiting, a source that can wait is held until the
   * pass in flight finishes. A live one never is: holding it would only hide the backlog in a
   * queue of frames.
   */
  readonly backpressureSeconds?: number;
  readonly onUpdate: (update: StreamUpdate) => void;
  readonly onError?: (error: unknown) => void;
};

type Pass = { readonly utterance: Utterance; readonly final: boolean };

/**
 * Joins the parts up: frames from a source, a speech flag from the detector, lines from the
 * segmenter, text from the model. Exactly one pass runs at a time, and a finished line always
 * goes before another guess at the one still being spoken.
 */
export class StreamingTranscriber {
  private readonly segmenter: Segmenter;
  private readonly lines: Segment[] = [];

  private frames: Promise<void> = Promise.resolve();
  private inFlight: Promise<void> | null = null;
  private inFlightSeconds = 0;
  private guess = '';
  private guessFor = 0;
  private lagSeconds = 0;
  private computeMs = 0;
  private passes = 0;
  private done: () => void = () => {};

  readonly finished = new Promise<void>((resolve) => {
    this.done = resolve;
  });

  private readonly source: AudioSource;
  private readonly vad: Vad;
  private readonly asr: Asr;
  private readonly options: StreamingOptions;

  constructor(source: AudioSource, vad: Vad, asr: Asr, options: StreamingOptions) {
    this.source = source;
    this.vad = vad;
    this.asr = asr;
    this.options = options;
    this.segmenter = new Segmenter(options.segmenter);
  }

  async start(): Promise<void> {
    try {
      await this.vad.reset();
      await this.source.start((frame) => this.accept(frame));
    } catch (error) {
      // Nothing will drain a stream that never started, and stop() waits for `finished`.
      this.done();
      throw error;
    }
    void this.source.finished.then(() => this.drain());
  }

  async stop(): Promise<void> {
    await this.source.stop();
    await this.finished;
  }

  private get backlogSeconds(): number {
    return this.segmenter.queuedSeconds + this.inFlightSeconds;
  }

  private accept(frame: AudioFrame): Promise<void> {
    this.frames = this.frames
      .then(async () => {
        const verdict = await this.vad.classify(frame.samples);
        this.segmenter.push(frame, verdict.speech);
        this.pump();

        const limit = this.options.backpressureSeconds ?? DEFAULT_BACKPRESSURE;
        if (!this.source.live && this.inFlight && this.backlogSeconds > limit) {
          await this.inFlight;
        }
      })
      .catch((error: unknown) => this.options.onError?.(error));

    return this.frames;
  }

  private pump(): void {
    if (this.inFlight) return;

    const final = this.segmenter.takeFinal();
    // A guess is for someone watching the words arrive. A file read flat out gets finals only.
    const utterance = final ?? (this.source.live ? this.segmenter.takeGuess() : null);
    if (!utterance) return;

    this.inFlight = this.run({ utterance, final: final !== null })
      .catch((error: unknown) => this.options.onError?.(error))
      .finally(() => {
        this.inFlight = null;
        this.inFlightSeconds = 0;
        this.pump();
      });
  }

  private async run({ utterance, final }: Pass): Promise<void> {
    if (final) this.inFlightSeconds = utterance.end - utterance.start;

    const started = performance.now();
    const result = await this.asr.transcribe(utterance.samples, { ...this.options.transcribe });
    this.computeMs += performance.now() - started;
    this.passes++;

    const text = trimLoop(result.transcript.text);
    if (final) {
      if (text) this.lines.push({ start: utterance.start, end: utterance.end, text });
      if (this.guessFor === utterance.id) this.guess = '';
      this.lagSeconds = Math.max(0, this.segmenter.heardUntil - utterance.end);
    } else {
      this.guess = text;
      this.guessFor = utterance.id;
    }

    this.emit();
  }

  private async drain(): Promise<void> {
    await this.frames;
    this.segmenter.flush();
    this.pump();
    // A pass that finishes calls pump(), which starts the next line, so one await is not
    // enough: finishing while that pass runs would lose the last line.
    while (this.inFlight) {
      await this.inFlight;
    }

    this.guess = '';
    this.emit();
    this.done();
  }

  private emit(): void {
    this.options.onUpdate({
      confirmed: [...this.lines],
      pending: this.guess,
      backlogSeconds: this.backlogSeconds,
      confirmedLagSeconds: this.lagSeconds,
      heardSeconds: this.segmenter.heardUntil,
      computeMs: this.computeMs,
      passes: this.passes,
    });
  }
}
