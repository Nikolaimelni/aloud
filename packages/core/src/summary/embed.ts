import { pipeline } from '@huggingface/transformers';
import { AloudError } from '../errors';
import { retry } from '../retry';
import type { AsrDevice } from '../asr/protocol';
import { EMBEDDING_MODEL, EMBEDDING_REVISION } from './model';

type Extractor = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

export type Vectors = {
  readonly dims: readonly [number, number];
  readonly data: Float32Array;
};

/** Sentence embeddings, loaded the first time anyone asks for a summary and not before. */
export class Embedder {
  private extractor: Extractor | null = null;

  async embed(texts: readonly string[], device: AsrDevice): Promise<Vectors> {
    if (texts.length === 0) {
      return { dims: [0, 0], data: new Float32Array(0) };
    }

    try {
      this.extractor ??= await retry(() =>
        pipeline('feature-extraction', EMBEDDING_MODEL, {
          device,
          dtype: 'q8',
          revision: EMBEDDING_REVISION,
        }),
      );

      const output = await this.extractor([...texts], { pooling: 'mean', normalize: true });
      const [rows, width] = output.dims;

      return {
        dims: [rows ?? texts.length, width ?? 0],
        data: Float32Array.from(output.data as ArrayLike<number>),
      };
    } catch (cause) {
      throw new AloudError('inference-failed', 'the summary model did not finish', { cause });
    }
  }
}
