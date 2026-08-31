import type { AloudErrorCode } from '../errors';

/**
 * Where the Silero weights live. Two megabytes, fetched once and cached by the browser. Pinned
 * to a commit so the file cannot change under the benchmark.
 */
export const SILERO_VAD_URL =
  'https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx';

export type VadTuning = {
  /** Probability at which silence becomes speech. */
  readonly enter?: number;
  /** Probability at which speech becomes silence again. Lower, so it does not chatter. */
  readonly exit?: number;
  /** Keep calling it speech for this long after the probability drops. */
  readonly hangoverMs?: number;
};

export type VadRequest =
  | {
      readonly kind: 'load';
      readonly id: number;
      readonly url: string;
      readonly tuning: VadTuning;
      /** Where the page serves onnxruntime's wasm. Left out, it comes from jsDelivr. */
      readonly runtimeUrl?: string;
    }
  /** The worker outlives a session, and its LSTM state and gate should not. */
  | { readonly kind: 'reset'; readonly id: number }
  | { readonly kind: 'classify'; readonly id: number; readonly samples: Float32Array };

export type VadEvent =
  | { readonly kind: 'loaded'; readonly id: number; readonly elapsedMs: number }
  | { readonly kind: 'reset'; readonly id: number }
  | {
      readonly kind: 'verdict';
      readonly id: number;
      readonly speech: boolean;
      readonly probability: number;
    }
  | {
      readonly kind: 'failed';
      readonly id: number;
      readonly code: AloudErrorCode;
      readonly message: string;
    };
