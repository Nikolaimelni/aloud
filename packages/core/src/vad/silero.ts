import * as ort from 'onnxruntime-web/wasm';
import { AloudError } from '../errors';
import { TARGET_SAMPLE_RATE } from '../audio/source';

/** Silero v5 takes 512 samples at 16 kHz and refuses every other length. */
export const VAD_BLOCK = 512;
export const VAD_BLOCK_MS = (VAD_BLOCK / TARGET_SAMPLE_RATE) * 1000;

const STATE_SHAPE = [2, 1, 128];
const STATE_SIZE = 2 * 128;

export class SileroVad {
  private session: ort.InferenceSession | null = null;
  private state = new Float32Array(STATE_SIZE);

  async load(url: string): Promise<void> {
    // A bundled worker has no idea where onnxruntime's wasm ended up. transformers.js answers
    // this the same way, and pointing both halves at one published version keeps a single
    // runtime in memory instead of two.
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
    // One thread on purpose. This model is two megabytes and it runs while Whisper is working.
    ort.env.wasm.numThreads = 1;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`the weights came back ${response.status}`);
      }
      const weights = new Uint8Array(await response.arrayBuffer());
      this.session = await ort.InferenceSession.create(weights, { executionProviders: ['wasm'] });
    } catch (cause) {
      throw new AloudError('vad-load-failed', 'the voice activity model would not load', {
        cause,
      });
    }
  }

  /** Probability that this block is speech. Carries the LSTM state between calls. */
  async probability(block: Float32Array): Promise<number> {
    const session = this.session;
    if (!session) {
      throw new AloudError('vad-failed', 'the detector was used before it loaded');
    }

    const outputs = await session.run({
      input: new ort.Tensor('float32', block, [1, block.length]),
      state: new ort.Tensor('float32', this.state, STATE_SHAPE),
      sr: new ort.Tensor('int64', BigInt64Array.from([BigInt(TARGET_SAMPLE_RATE)]), []),
    });

    // Copy rather than hold onnxruntime's buffer, which it is entitled to reuse.
    this.state = Float32Array.from(outputs['stateN'].data as ArrayLike<number>);
    return (outputs['output'].data as ArrayLike<number>)[0];
  }

  reset(): void {
    this.state = new Float32Array(STATE_SIZE);
  }
}
