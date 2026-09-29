import { AloudError, unwrap } from '../errors';
import { Embedder } from '../summary/embed';
import { serveRuntimeFrom, WhisperEngine } from './engine';
import type { AsrEvent, AsrRequest } from './protocol';

/**
 * The worker side of the protocol. Lives here rather than in the app so the only thing the
 * app owns is the `new Worker(...)` line that a bundler has to see literally.
 */
export function createAsrHandler(
  post: (event: AsrEvent) => void,
): (request: AsrRequest) => Promise<void> {
  const engine = new WhisperEngine();
  const embedder = new Embedder();

  return async (request) => {
    const started = performance.now();

    try {
      if (request.kind === 'load') {
        const device = await engine.load(
          request.spec,
          (progress) => post({ kind: 'progress', progress }),
          request.runtimeUrl,
        );
        post({ kind: 'loaded', id: request.id, device, elapsedMs: performance.now() - started });
        return;
      }

      if (request.kind === 'embed') {
        if (request.runtimeUrl) serveRuntimeFrom(request.runtimeUrl);
        const vectors = await embedder.embed(request.texts, engine.device ?? 'wasm');
        post({
          kind: 'vectors',
          id: request.id,
          dims: vectors.dims,
          data: vectors.data,
          elapsedMs: performance.now() - started,
        });
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
