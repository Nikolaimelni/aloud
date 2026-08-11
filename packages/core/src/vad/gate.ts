import type { VadTuning } from './protocol';

const ENTER = 0.5;
const EXIT = 0.35;
const HANGOVER_MS = 250;

/**
 * Turns a stream of per-block probabilities into a stable speech flag.
 *
 * Two thresholds rather than one, because a single threshold flickers on every breath, and a
 * hangover on top, because the gap between two words is silence to the model and not to the
 * person listening. Without the hangover the chunker would decide nobody was talking in the
 * middle of a sentence and quietly stop transcribing it.
 */
export class SpeechGate {
  private readonly enter: number;
  private readonly exit: number;
  private readonly hangoverMs: number;

  private open = false;
  private quietMs = 0;

  constructor(tuning: VadTuning = {}) {
    this.enter = tuning.enter ?? ENTER;
    this.exit = tuning.exit ?? EXIT;
    this.hangoverMs = tuning.hangoverMs ?? HANGOVER_MS;
  }

  get speaking(): boolean {
    return this.open;
  }

  update(probability: number, blockMs: number): boolean {
    if (probability >= this.enter) {
      this.open = true;
      this.quietMs = 0;
      return true;
    }

    if (this.open && probability < this.exit) {
      this.quietMs += blockMs;
      if (this.quietMs >= this.hangoverMs) {
        this.open = false;
      }
    } else if (this.open) {
      // Between the two thresholds: not confident either way, so hold.
      this.quietMs = 0;
    }

    return this.open;
  }

  reset(): void {
    this.open = false;
    this.quietMs = 0;
  }
}
