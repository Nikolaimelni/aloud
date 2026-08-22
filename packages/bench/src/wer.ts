import { normalise } from './normalise';

export type ErrorCounts = {
  readonly hits: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
};

export type WerResult = ErrorCounts & {
  /** Errors per reference word. Above 1 is possible, if the model invents enough. */
  readonly wer: number;
  readonly referenceWords: number;
};

/**
 * Word error rate by Levenshtein alignment. Kept honest about which kind of error it found,
 * because deletions and insertions mean very different things in a streaming transcript:
 * deletions are usually a window that cut a word in half, insertions are usually the model
 * talking over silence.
 */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const want = normalise(reference);
  const got = normalise(hypothesis);

  // Full matrix: these clips are seconds long, not hours.
  const cost: number[][] = [];
  for (let i = 0; i <= want.length; i++) {
    const row = new Array<number>(got.length + 1).fill(0);
    row[0] = i;
    cost.push(row);
  }
  for (let j = 0; j <= got.length; j++) {
    cost[0]![j] = j;
  }

  for (let i = 1; i <= want.length; i++) {
    for (let j = 1; j <= got.length; j++) {
      const same = want[i - 1] === got[j - 1];
      cost[i]![j] = Math.min(
        cost[i - 1]![j - 1]! + (same ? 0 : 1),
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
    }
  }

  let hits = 0;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  let i = want.length;
  let j = got.length;
  while (i > 0 || j > 0) {
    const here = cost[i]![j]!;
    if (i > 0 && j > 0 && want[i - 1] === got[j - 1] && here === cost[i - 1]![j - 1]!) {
      hits++;
      i--;
      j--;
    } else if (i > 0 && j > 0 && here === cost[i - 1]![j - 1]! + 1) {
      substitutions++;
      i--;
      j--;
    } else if (i > 0 && here === cost[i - 1]![j]! + 1) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }

  const errors = substitutions + deletions + insertions;
  return {
    hits,
    substitutions,
    deletions,
    insertions,
    referenceWords: want.length,
    wer: want.length === 0 ? (errors === 0 ? 0 : 1) : errors / want.length,
  };
}
