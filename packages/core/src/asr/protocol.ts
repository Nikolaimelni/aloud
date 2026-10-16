import type { AloudErrorCode } from '../errors';
import type { Fetching } from '../fetching';

export type AsrDevice = 'webgpu' | 'wasm';
export type AsrPrecision = 'fp32' | 'fp16' | 'q8' | 'q4';
/** One precision for the whole model, or one per ONNX module. */
export type AsrDtype = AsrPrecision | Readonly<Record<string, AsrPrecision>>;

export type AsrModelSpec = {
  /** Hugging Face repo, for example `onnx-community/moonshine-tiny-ONNX`. */
  readonly model: string;
  /** A commit in that repo. Left out, whatever `main` is today. */
  readonly revision?: string;
  readonly device: AsrDevice | 'auto';
  /** Per-module when the encoder and the decoder want different precision. */
  readonly dtype?: AsrDtype;
};

export type Transcript = {
  readonly text: string;
};

export type ModelProgress = {
  readonly file: string;
  readonly loaded: number;
  readonly total: number;
};

export type AsrRequest =
  | ({ readonly kind: 'load'; readonly id: number; readonly spec: AsrModelSpec } & Fetching)
  /**
   * Sentence embeddings for the summary. They live in this worker rather than a third one
   * because transformers.js is already resident here. They never run while the model is
   * transcribing, and do not need it loaded, so they say how to fetch just as a load does.
   */
  | ({ readonly kind: 'embed'; readonly id: number; readonly texts: readonly string[] } & Fetching)
  | {
      readonly kind: 'transcribe';
      readonly id: number;
      readonly samples: Float32Array;
    };

export type AsrEvent =
  | { readonly kind: 'progress'; readonly progress: ModelProgress }
  | {
      readonly kind: 'loaded';
      readonly id: number;
      readonly device: AsrDevice;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'transcript';
      readonly id: number;
      readonly transcript: Transcript;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'vectors';
      readonly id: number;
      readonly dims: readonly [number, number];
      readonly data: Float32Array;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'failed';
      readonly id: number;
      readonly code: AloudErrorCode;
      readonly message: string;
    };
