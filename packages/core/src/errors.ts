export type AloudErrorCode =
  | 'unsupported-sample-rate'
  | 'capture-denied'
  | 'capture-failed'
  | 'worklet-load-failed'
  | 'invalid-wav'
  | 'unsupported-wav-format'
  | 'no-backend'
  | 'model-load-failed'
  | 'inference-failed'
  | 'vad-load-failed'
  | 'vad-failed';

export class AloudError extends Error {
  readonly code: AloudErrorCode;

  constructor(code: AloudErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AloudError';
    this.code = code;
  }
}

/** Worker stack traces never reach the page, so the cause chain has to travel as text. */
export function unwrap(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current instanceof Error && parts.length < 4) {
    parts.push(current.message);
    current = current.cause;
  }

  return parts.length > 0 ? parts.join(': ') : String(error);
}
