import { AloudError } from '../errors';
import { WhisperEngine } from './engine';
import type { AsrEvent, AsrRequest } from './protocol';

/**
 * The worker side of the protocol. Lives here rather than in the app so the only thing the
 * app owns is the `new Worker(...)` line that a bundler has to see literally.
 */
export function createAsrHandler(
  post: (event: AsrEvent) => void,
): (request: AsrRequest) => Promise<void> {
  const engine = new WhisperEngine();

  return async (request) => {
    const started = performance.now();

    try {
      if (request.kind === 'load') {
        const device = await engine.load(request.spec, (progress) =>
          post({ kind: 'progress', progress }),
        );
        post({ kind: 'loaded', id: request.id, device, elapsedMs: performance.now() - started });
        return;
      }

      const transcript = await engine.transcribe(request.samples, request.options);
      post({
        kind: 'transcript',
        id: request.id,
        transcript,
        elapsedMs: performance.now() - started,
      });
    } catch (error) {
      post({
        kind: 'failed',
        id: request.id,
        code: error instanceof AloudError ? error.code : 'inference-failed',
        message: unwrap(error),
      });
    }
  };
}

/** Worker stack traces never reach the page, so the cause chain has to travel as text. */
function unwrap(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current instanceof Error && parts.length < 4) {
    parts.push(current.message);
    current = current.cause;
  }

  return parts.length > 0 ? parts.join(': ') : String(error);
}
