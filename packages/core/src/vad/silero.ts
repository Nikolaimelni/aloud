import * as ort from 'onnxruntime-web/wasm';
import { AloudError } from '../errors';
import { retry } from '../retry';
import { fetchUnlessStalled } from '../stall';
import { TARGET_SAMPLE_RATE } from '../audio/source';

/** Silero v5 reads 512 new samples at 16 kHz per call. */
export const VAD_BLOCK = 512;
export const VAD_BLOCK_MS = (VAD_BLOCK / TARGET_SAMPLE_RATE) * 1000;

/**
 * The reference wrapper (silero_vad/utils_vad.py) puts the last 64 samples of the previous
 * call in front of every block, so the model sees 576. Leaving them off still runs, and gives
 * probabilities for input the model was not trained on.
 */
const CONTEXT = 64;

const STATE_SHAPE = [2, 1, 128];
const STATE_SIZE = 2 * 128;

export class SileroVad {
  private session: ort.InferenceSession | null = null;
  private state = new Float32Array(STATE_SIZE);
  private input = new Float32Array(CONTEXT + VAD_BLOCK);

  async load(url: string, runtimeUrl?: string): Promise<void> {
    // A bundled worker has no idea where onnxruntime's wasm ended up, so it is told.
    ort.env.wasm.wasmPaths =
      runtimeUrl ?? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
    // One thread on purpose. This model is two megabytes and it runs while the speech model
    // is working.
    ort.env.wasm.numThreads = 1;

    try {
      const weights = await download(url);
      this.session = await ort.InferenceSession.create(weights, { executionProviders: ['wasm'] });
    } catch (cause) {
      throw new AloudError('vad-load-failed', 'the voice activity model would not load', {
        cause,
      });
    }
  }

  /** Probability that this block is speech. Carries the LSTM state and context between calls. */
  async probability(block: Float32Array): Promise<number> {
    const session = this.session;
    if (!session) {
      throw new AloudError('vad-failed', 'the detector was used before it loaded');
    }

    const input = this.input;
    input.set(block, CONTEXT);

    const outputs = await session.run({
      input: new ort.Tensor('float32', input, [1, input.length]),
      state: new ort.Tensor('float32', this.state, STATE_SHAPE),
      sr: new ort.Tensor('int64', BigInt64Array.from([BigInt(TARGET_SAMPLE_RATE)]), []),
    });

    input.copyWithin(0, input.length - CONTEXT);
    // Copy rather than hold onnxruntime's buffer, which it is entitled to reuse.
    this.state = Float32Array.from(outputs['stateN']!.data as ArrayLike<number>);
    return (outputs['output']!.data as ArrayLike<number>)[0]!;
  }

  reset(): void {
    this.state = new Float32Array(STATE_SIZE);
    this.input.fill(0);
  }
}

function download(url: string): Promise<Uint8Array> {
  return retry(async () => {
    const response = await fetchUnlessStalled(url);
    if (!response.ok) {
      throw new Error(`the weights came back ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  });
}
