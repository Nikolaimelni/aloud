import { env, pipeline } from '@huggingface/transformers';
import { AloudError } from '../errors';
import { retry } from '../retry';
import type {
  AsrDevice,
  AsrModelSpec,
  AsrPrecision,
  ModelProgress,
  Transcript,
  TranscribeOptions,
} from './protocol';

type Transcriber = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>;

/** Whisper only ever sees 30-second windows, so anything longer is chunked with an overlap. */
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;

/**
 * Measured on an 11 s clip with whisper-base on an AMD GCN5 GPU: q4 everywhere runs at 0.23x
 * real time and pulls 142 MB, against 0.63x and 206 MB for the fp32 encoder that the
 * transformers.js examples reach for. On WASM the q8 decoder will not even build a session,
 * onnxruntime rejects the quantised graph. The benchmark has since agreed: q4 loses nothing
 * measurable on either language at any of the three sizes.
 */
const DEFAULT_DTYPE: AsrPrecision = 'q4';

export class WhisperEngine {
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

  async transcribe(samples: Float32Array, options: TranscribeOptions): Promise<Transcript> {
    const transcriber = this.transcriber;
    if (!transcriber) {
      throw new AloudError('inference-failed', 'transcribe was called before the model loaded');
    }

    try {
      const output = await transcriber(samples, {
        task: options.task ?? 'transcribe',
        return_timestamps: options.timestamps ?? true,
        chunk_length_s: CHUNK_SECONDS,
        stride_length_s: STRIDE_SECONDS,
        ...(options.language ? { language: options.language } : {}),
      });

      return {
        text: output.text.trim(),
        chunks: (output.chunks ?? []).map((chunk) => {
          const [start, end] = chunk.timestamp;
          // Whisper leaves the last chunk open-ended more often than the types admit.
          return { start, end: Number.isFinite(end) ? end : start, text: chunk.text };
        }),
      };
    } catch (cause) {
      throw new AloudError('inference-failed', 'the model stopped mid-transcription', { cause });
    }
  }
}

/**
 * transformers.js points onnxruntime at jsDelivr when it is imported. Keep the build it chose,
 * which is a different one on Safari, and change only where the files come from.
 */
export function serveRuntimeFrom(base: string): void {
  const wasm = env.backends.onnx.wasm;
  const paths = wasm?.wasmPaths;
  if (!wasm || !paths || typeof paths === 'string' || paths instanceof URL) return;

  wasm.wasmPaths = {
    ...(paths.mjs ? { mjs: new URL(fileName(paths.mjs), base).href } : {}),
    ...(paths.wasm ? { wasm: new URL(fileName(paths.wasm), base).href } : {}),
  };
}

function fileName(path: URL | string): string {
  return String(path).split('/').pop() ?? '';
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
