export interface Word {
  readonly text: string;
  /** Seconds from the start of the session, not the window. */
  readonly start: number;
  readonly end: number;
}

export interface StabilizerState {
  /** Two passes have agreed on these. They will not change again. */
  readonly confirmed: readonly Word[];
  /** The current guess for everything after that. Expect it to be rewritten. */
  readonly pending: readonly Word[];
}

/** Three copies of the same phrase in a row is a decoder loop, not someone repeating themselves. */
const LOOP_REPEATS = 3;
const LONGEST_LOOP = 6;

/** A word that ends this far before the confirmed boundary belongs to audio already settled. */
const OVERLAP_TOLERANCE = 0.1;

/**
 * LocalAgreement-2. Every window produces a fresh guess at the same stretch of speech; a word
 * is only printed as final once two consecutive guesses put it in the same place. Everything
 * after that stays visibly provisional, because it will change.
 *
 * This is the one piece of the project that is an algorithm rather than a library call, and
 * the one place where a bug looks like "the text flickers sometimes" instead of a stack trace.
 */
export class Stabilizer {
  private readonly settled: Word[] = [];
  private previous: readonly Word[] = [];

  /** End time of the last confirmed word. The chunker drops audio behind it. */
  get confirmedUntil(): number {
    const last = this.settled.at(-1);
    return last ? last.end : 0;
  }

  get state(): StabilizerState {
    return { confirmed: [...this.settled], pending: [...this.previous] };
  }

  push(hypothesis: readonly Word[]): StabilizerState {
    const boundary = this.confirmedUntil;
    const fresh = trimLoop(hypothesis.filter((word) => word.end > boundary + OVERLAP_TOLERANCE));

    const agreed = agreementLength(this.previous, fresh);
    this.settled.push(...fresh.slice(0, agreed));
    this.previous = fresh.slice(agreed);

    return this.state;
  }

  reset(): void {
    this.settled.length = 0;
    this.previous = [];
  }
}

export function textOf(words: readonly Word[]): string {
  return words
    .map((word) => word.text)
    .join('')
    .trim();
}

/** How many words at the front of both guesses say the same thing. */
function agreementLength(before: readonly Word[], after: readonly Word[]): number {
  const limit = Math.min(before.length, after.length);
  let length = 0;
  while (length < limit && same(before[length], after[length])) {
    length++;
  }
  return length;
}

function same(left: Word, right: Word): boolean {
  return key(left.text) === key(right.text);
}

/** Punctuation and case move around between passes; the word underneath does not. */
function key(text: string): string {
  const stripped = text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  return stripped || text.trim();
}

function trimLoop(words: readonly Word[]): readonly Word[] {
  for (let size = 1; size <= LONGEST_LOOP; size++) {
    if (words.length < size * LOOP_REPEATS) break;

    const copies = tailCopies(words, size);
    if (copies >= LOOP_REPEATS) {
      return words.slice(0, words.length - size * (copies - 1));
    }
  }
  return words;
}

/** How many times the final `size` words repeat back to back, counting the last one. */
function tailCopies(words: readonly Word[], size: number): number {
  const tail = words.slice(words.length - size);
  let copies = 1;

  while (words.length >= size * (copies + 1)) {
    const start = words.length - size * (copies + 1);
    const block = words.slice(start, start + size);
    if (!block.every((word, index) => same(word, tail[index]))) break;
    copies++;
  }

  return copies;
}
