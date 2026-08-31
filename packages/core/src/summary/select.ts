export type KeyLineOptions = {
  /** How many lines to keep. Defaults to something proportional to the transcript. */
  readonly count?: number;
  /** 0 is pure relevance, 1 is pure novelty. The middle is where summaries live. */
  readonly diversity?: number;
  /** Anything shorter is filler: "yeah", "right", "mm hm". */
  readonly minimumWords?: number;
};

const DIVERSITY = 0.3;
const MINIMUM_WORDS = 4;

/**
 * Extractive summary by maximal marginal relevance: take the line closest to the centre of
 * what was said, then keep taking lines that are central but unlike the ones already taken.
 *
 * Extractive on purpose. An abstractive summary means a second language model, another
 * download and a new way to be confidently wrong about what someone said; picking real
 * sentences out of the transcript can at worst be uninteresting.
 */
export function pickKeyLines(
  texts: readonly string[],
  vectors: readonly Float32Array[],
  options: KeyLineOptions = {},
): number[] {
  const diversity = options.diversity ?? DIVERSITY;
  const minimumWords = options.minimumWords ?? MINIMUM_WORDS;

  const eligible: number[] = [];
  for (let i = 0; i < texts.length && i < vectors.length; i++) {
    if (words(texts[i]!) >= minimumWords) {
      eligible.push(i);
    }
  }
  if (eligible.length === 0) return [];

  const wanted = Math.min(eligible.length, options.count ?? defaultCount(eligible.length));
  const centre = centroid(eligible.map((index) => vectors[index]!));
  const relevance = new Map(eligible.map((index) => [index, dot(vectors[index]!, centre)]));

  const picked: number[] = [];
  while (picked.length < wanted) {
    let best = -1;
    let bestScore = -Infinity;

    for (const index of eligible) {
      if (picked.includes(index)) continue;

      let closest = 0;
      for (const already of picked) {
        closest = Math.max(closest, dot(vectors[index]!, vectors[already]!));
      }

      const score = (1 - diversity) * relevance.get(index)! - diversity * closest;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }

    if (best === -1) break;
    picked.push(best);
  }

  return picked.sort((a, b) => a - b);
}

function defaultCount(lines: number): number {
  return Math.max(3, Math.min(8, Math.round(lines / 6)));
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function centroid(vectors: readonly Float32Array[]): Float32Array {
  const first = vectors[0];
  if (!first) return new Float32Array(0);

  const sum = new Float32Array(first.length);
  for (const vector of vectors) {
    for (let i = 0; i < sum.length; i++) {
      sum[i]! += vector[i]!;
    }
  }

  let length = 0;
  for (const value of sum) {
    length += value * value;
  }
  length = Math.sqrt(length) || 1;

  for (let i = 0; i < sum.length; i++) {
    sum[i]! /= length;
  }
  return sum;
}

/** The embedder returns unit vectors, so this is the cosine. */
function dot(left: Float32Array, right: Float32Array): number {
  let total = 0;
  for (let i = 0; i < left.length && i < right.length; i++) {
    total += left[i]! * right[i]!;
  }
  return total;
}
