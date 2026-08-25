import type { AloudErrorCode } from '../errors';

export type AsrDevice = 'webgpu' | 'wasm';
export type AsrPrecision = 'fp32' | 'fp16' | 'q8' | 'q4';
/** One precision for the whole model, or one per ONNX module. */
export type AsrDtype = AsrPrecision | Readonly<Record<string, AsrPrecision>>;

export type AsrModelSpec = {
  /** Hugging Face repo, for example `onnx-community/whisper-base`. */
  readonly model: string;
  readonly device: AsrDevice | 'auto';
  /** Per-module when the encoder and the decoder want different precision. */
  readonly dtype?: AsrDtype;
};

export type TranscribeOptions = {
  /** Whisper language name or code. Leave it out and the model guesses, badly, on short audio. */
  readonly language?: string;
  readonly task?: 'transcribe' | 'translate';
  readonly timestamps?: boolean | 'word';
};

export type TranscriptChunk = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export type Transcript = {
  readonly text: string;
  readonly chunks: readonly TranscriptChunk[];
};

export type ModelProgress = {
  readonly file: string;
  readonly loaded: number;
  readonly total: number;
};

export type AsrRequest =
  | { readonly kind: 'load'; readonly id: number; readonly spec: AsrModelSpec }
  /**
   * Sentence embeddings for the summary. They live in this worker rather than a third one
   * because transformers.js is already resident here, and they only ever run when Whisper
   * has finished and is sitting idle.
   */
  | { readonly kind: 'embed'; readonly id: number; readonly texts: readonly string[] }
  | {
      readonly kind: 'transcribe';
      readonly id: number;
      readonly samples: Float32Array;
      readonly options: TranscribeOptions;
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
