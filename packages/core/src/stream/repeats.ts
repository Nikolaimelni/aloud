/** Three copies of the same phrase in a row is a decoder loop, not someone repeating themselves. */
const LOOP_REPEATS = 3;
const LONGEST_LOOP = 6;

/**
 * Cuts a decoder loop at the end of a line back to one copy. Only the end: a runaway decoder
 * never stops, so the loop is always the tail, and a repetition mid-sentence is left alone.
 * The price is that a genuine one at the very end gets cut as well.
 */
export function trimLoop(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);

  for (let size = 1; size <= LONGEST_LOOP; size++) {
    if (words.length < size * LOOP_REPEATS) break;

    const copies = tailCopies(words, size);
    if (copies >= LOOP_REPEATS) {
      return words.slice(0, words.length - size * (copies - 1)).join(' ');
    }
  }
  return words.join(' ');
}

/** How many times the final `size` words repeat back to back, counting the last one. */
function tailCopies(words: readonly string[], size: number): number {
  const tail = words.slice(words.length - size);
  let copies = 1;

  while (words.length >= size * (copies + 1)) {
    const start = words.length - size * (copies + 1);
    const block = words.slice(start, start + size);
    if (!block.every((word, index) => key(word) === key(tail[index]!))) break;
    copies++;
  }

  return copies;
}

/** Punctuation and case move around between copies; the word underneath does not. */
function key(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') || word;
}
