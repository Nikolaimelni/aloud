export type AloudErrorCode =
  'unsupported-sample-rate' | 'capture-denied' | 'capture-failed' | 'worklet-load-failed';

export class AloudError extends Error {
  readonly code: AloudErrorCode;

  constructor(code: AloudErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AloudError';
    this.code = code;
  }
}
