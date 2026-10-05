import { levelOf } from '../audio/level';
import { TARGET_SAMPLE_RATE, type AudioFrame } from '../audio/source';

export type SegmenterOptions = {
  /** Seconds of silence that end a line. */
  readonly pauseSeconds?: number;
  /** Nobody pauses on cue, so past this a line is cut at the quietest moment it has. */
  readonly maxSeconds?: number;
  /** How often the line still being spoken gets a fresh guess. */
  readonly stepSeconds?: number;
};

/** Audio to hand the model, and where it sits in the session. */
export type Utterance = {
  readonly id: number;
  readonly samples: Float32Array;
  readonly start: number;
  readonly end: number;
};

const PAUSE = 0.5;
const MAX = 15;
const STEP = 0.6;
/** The detector answers a block late and onsets are quiet, so a line starts a little early. */
const PRE_ROLL = 0.3;
/** And ends a little late, or a trailing consonant goes. */
const TAIL = 0.2;
/** How far back from the ceiling a forced cut looks for a quiet moment. */
const CUT_SEARCH = 2;
/** A guess at less than this is mostly the model guessing. */
const MIN_GUESS = 0.5;

type Open = {
  readonly id: number;
  readonly frames: AudioFrame[];
  lastSpeech: number;
  lastGuessAt: number;
};

/**
 * Cuts the stream into lines at the pauses. Moonshine has no word timestamps to cut on, and
 * it does not need them: a pause is where a person would have put the line break anyway, and
 * the model is fast enough to read a whole line again for every guess.
 */
export class Segmenter {
  private readonly pause: number;
  private readonly max: number;
  private readonly step: number;

  private nextId = 1;
  private heard = 0;
  private preRoll: AudioFrame[] = [];
  private open: Open | null = null;
  private readonly finals: Utterance[] = [];

  constructor(options: SegmenterOptions = {}) {
    this.pause = options.pauseSeconds ?? PAUSE;
    this.max = options.maxSeconds ?? MAX;
    this.step = options.stepSeconds ?? STEP;
  }

  /** Session time of the newest sample it has been given. */
  get heardUntil(): number {
    return this.heard;
  }

  /** Seconds of finished lines still waiting for the model. */
  get queuedSeconds(): number {
    return this.finals.reduce((total, line) => total + line.end - line.start, 0);
  }

  push(frame: AudioFrame, speech: boolean): void {
    const end = endOf(frame);
    this.heard = end;

    const open = this.open;
    if (!open) {
      this.keepForPreRoll(frame);
      if (speech) {
        this.open = {
          id: this.nextId++,
          frames: this.preRoll,
          lastSpeech: end,
          lastGuessAt: -Infinity,
        };
        this.preRoll = [];
      }
      return;
    }

    open.frames.push(frame);
    if (speech) open.lastSpeech = end;

    if (end - open.lastSpeech >= this.pause) {
      this.close(open.lastSpeech + TAIL);
    } else if (end - open.frames[0]!.time >= this.max) {
      this.cut(open);
    }
  }

  /** The oldest finished line, in order, until there are none. */
  takeFinal(): Utterance | null {
    return this.finals.shift() ?? null;
  }

  /** The line still being spoken, once a step has passed since the last guess at it. */
  takeGuess(): Utterance | null {
    const open = this.open;
    if (!open || this.heard - open.lastGuessAt < this.step) return null;
    if (this.heard - open.frames[0]!.time < MIN_GUESS) return null;

    open.lastGuessAt = this.heard;
    return utterance(open.id, open.frames);
  }

  /** No more audio is coming, so whatever was being said is a line now. */
  flush(): void {
    if (this.open) this.close(Math.min(this.open.lastSpeech + TAIL, this.heard));
  }

  private close(at: number): void {
    const open = this.open!;
    const line = open.frames.filter((frame) => frame.time < at);
    // After a forced cut the remainder can be nothing but the tail of a pause.
    if (line.length > 0) this.finals.push(utterance(open.id, line));
    this.open = null;

    for (const frame of open.frames.slice(line.length)) {
      this.keepForPreRoll(frame);
    }
  }

  private cut(open: Open): void {
    // Cutting at the first frame would send the model an empty line and leave the same line
    // over the ceiling, to be cut again on the next frame. A ceiling under CUT_SEARCH gets there.
    if (open.frames.length < 2) return;

    let at = open.frames.at(-1)!.time;
    let quietest = Infinity;
    for (const frame of open.frames.slice(1)) {
      if (frame.time < this.heard - CUT_SEARCH) continue;
      const level = levelOf(frame.samples);
      if (level < quietest) {
        quietest = level;
        at = frame.time;
      }
    }

    const line = open.frames.filter((frame) => frame.time < at);
    this.finals.push(utterance(open.id, line));
    this.open = {
      id: this.nextId++,
      frames: open.frames.slice(line.length),
      lastSpeech: open.lastSpeech,
      lastGuessAt: -Infinity,
    };
  }

  private keepForPreRoll(frame: AudioFrame): void {
    this.preRoll.push(frame);
    // The first frame goes once the second alone reaches far enough back. The tolerance is for
    // frame times that are sums of floats.
    while (this.preRoll.length > 1 && this.preRoll[1]!.time <= frame.time - PRE_ROLL + 1e-6) {
      this.preRoll.shift();
    }
  }
}

function endOf(frame: AudioFrame): number {
  return frame.time + frame.samples.length / TARGET_SAMPLE_RATE;
}

function utterance(id: number, frames: readonly AudioFrame[]): Utterance {
  const samples = new Float32Array(
    frames.reduce((total, frame) => total + frame.samples.length, 0),
  );
  let at = 0;
  for (const frame of frames) {
    samples.set(frame.samples, at);
    at += frame.samples.length;
  }

  const first = frames[0];
  const last = frames.at(-1);
  return { id, samples, start: first?.time ?? 0, end: last ? endOf(last) : 0 };
}
