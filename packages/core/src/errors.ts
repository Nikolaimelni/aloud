export type AloudErrorCode =
  | 'unsupported-sample-rate'
  | 'capture-denied'
  | 'capture-failed'
  | 'worklet-load-failed'
  | 'invalid-wav'
  | 'unsupported-wav-format'
  | 'no-backend'
  | 'model-load-failed'
  | 'inference-failed';

export class AloudError extends Error {
  readonly code: AloudErrorCode;

  constructor(code: AloudErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AloudError';
    this.code = code;
  }
}
