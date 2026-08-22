/** Where the Silero weights live. Two megabytes, fetched once and cached by the browser. */
export const SILERO_VAD_URL =
  'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx';

export type VadTuning = {
  /** Probability at which silence becomes speech. */
  readonly enter?: number;
  /** Probability at which speech becomes silence again. Lower, so it does not chatter. */
  readonly exit?: number;
  /** Keep calling it speech for this long after the probability drops. */
  readonly hangoverMs?: number;
};

export type VadRequest =
  | { readonly kind: 'load'; readonly id: number; readonly url: string; readonly tuning: VadTuning }
  | { readonly kind: 'classify'; readonly id: number; readonly samples: Float32Array };

export type VadEvent =
  | { readonly kind: 'loaded'; readonly id: number; readonly elapsedMs: number }
  | {
      readonly kind: 'verdict';
      readonly id: number;
      readonly speech: boolean;
      readonly probability: number;
    }
  | { readonly kind: 'failed'; readonly id: number; readonly message: string };
