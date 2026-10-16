import { env, pipeline } from '@huggingface/transformers';
import { TARGET_SAMPLE_RATE } from '../audio/source';
import { AloudError } from '../errors';
import { retry } from '../retry';
import type { AsrDevice, AsrModelSpec, AsrPrecision, ModelProgress, Transcript } from './protocol';

type Transcriber = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>;

/**
 * q8 is what keeps tiny at 32 MB. The q4 export quantises the matrices but leaves the token
 * table in float32, and comes out at 55.
 */
const DEFAULT_DTYPE: AsrPrecision = 'q8';

/**
 * The paper caps output at six tokens per second of audio, so a decoder that has lost the
 * thread cannot write a page. transformers.js rounds the seconds down, which gives a line
 * under a second no tokens at all; this rounds up, with a floor for a single word.
 */
const TOKENS_PER_SECOND = 6;
const MIN_TOKENS = 8;

export class SpeechEngine {
  private transcriber: Transcriber | null = null;
  private loaded: AsrDevice | null = null;

  get device(): AsrDevice | null {
    return this.loaded;
  }

  async load(
    spec: AsrModelSpec,
    onProgress: (progress: ModelProgress) => void,
    runtimeUrl?: string,
  ): Promise<AsrDevice> {
    const device = spec.device === 'auto' ? await detectDevice() : spec.device;
    if (runtimeUrl) {
      serveRuntimeFrom(runtimeUrl);
    }

    try {
      this.transcriber = await retry(() =>
        pipeline('automatic-speech-recognition', spec.model, {
          device,
          dtype: spec.dtype ?? DEFAULT_DTYPE,
          // The files come from this commit. transformers.js 4.2 still asks `main` for their
          // sizes first, so `resolve/main` in the network panel is the progress bar, not the model.
          ...(spec.revision ? { revision: spec.revision } : {}),
          progress_callback: (info) => {
            if (info.status === 'progress') {
              onProgress({ file: info.file, loaded: info.loaded, total: info.total });
            }
          },
        }),
      );
    } catch (cause) {
      throw new AloudError('model-load-failed', `${spec.model} would not load on ${device}`, {
        cause,
      });
    }

    this.loaded = device;
    return device;
  }

  async transcribe(samples: Float32Array): Promise<Transcript> {
    const transcriber = this.transcriber;
    if (!transcriber) {
      throw new AloudError('inference-failed', 'transcribe was called before the model loaded');
    }

    const seconds = samples.length / TARGET_SAMPLE_RATE;
    try {
      const output = await transcriber(samples, {
        max_new_tokens: Math.max(MIN_TOKENS, Math.ceil(seconds * TOKENS_PER_SECOND)),
      });
      return { text: output.text.trim() };
    } catch (cause) {
      throw new AloudError('inference-failed', 'the model stopped mid-transcription', { cause });
    }
  }
}

/**
 * transformers.js points onnxruntime at jsDelivr when it is imported, and at the asyncify build
 * everywhere but Safari. The app runs on WASM only, so it takes the plain build, half the size
 * and with no eval in it, from its own origin. WebGPU needs the other build: leave `base` out.
 */
export function serveRuntimeFrom(base: string): void {
  const wasm = env.backends.onnx.wasm;
  if (!wasm) {
    throw new AloudError('model-load-failed', 'onnxruntime has no WebAssembly backend here');
  }

  wasm.wasmPaths = {
    mjs: new URL('ort-wasm-simd-threaded.mjs', base).href,
    wasm: new URL('ort-wasm-simd-threaded.wasm', base).href,
  };
  // The service worker already keeps these for offline use. Left on, transformers.js stores a
  // second 14 MB copy in its own cache and imports the .mjs from a blob: URL.
  env.useWasmCache = false;
}

async function detectDevice(): Promise<AsrDevice> {
  if (!('gpu' in navigator)) {
    return 'wasm';
  }
  try {
    return (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}
