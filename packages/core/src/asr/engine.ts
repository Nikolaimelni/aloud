import { pipeline } from '@huggingface/transformers';
import { AloudError } from '../errors';
import type {
  AsrDevice,
  AsrDtype,
  AsrModelSpec,
  ModelProgress,
  Transcript,
  TranscribeOptions,
} from './protocol';

type Transcriber = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>;

/** Whisper only ever sees 30-second windows, so anything longer is chunked with an overlap. */
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;

export class WhisperEngine {
  private transcriber: Transcriber | null = null;
  private loaded: AsrDevice | null = null;

  get device(): AsrDevice | null {
    return this.loaded;
  }

  async load(
    spec: AsrModelSpec,
    onProgress: (progress: ModelProgress) => void,
  ): Promise<AsrDevice> {
    const device = spec.device === 'auto' ? await detectDevice() : spec.device;

    try {
      this.transcriber = await pipeline('automatic-speech-recognition', spec.model, {
        device,
        dtype: spec.dtype ?? defaultDtype(device),
        progress_callback: (info) => {
          if (info.status === 'progress') {
            onProgress({ file: info.file, loaded: info.loaded, total: info.total });
          }
        },
      });
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

export async function detectDevice(): Promise<AsrDevice> {
  if (!('gpu' in navigator)) {
    return 'wasm';
  }
  try {
    return (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

/**
 * On WebGPU the encoder stays fp32: it runs once per window and quantising it costs more
 * accuracy than it saves time, while the decoder runs once per token and takes q4 quietly.
 * WASM gets q8 throughout because there the download size hurts more than the arithmetic.
 */
export function defaultDtype(device: AsrDevice): AsrDtype {
  return device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
}
