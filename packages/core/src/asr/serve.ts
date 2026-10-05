import { env } from '@huggingface/transformers';
import { AloudError, unwrap } from '../errors';
import { queued } from '../queue';
import { fetchUnlessStalled } from '../stall';
import { Embedder } from '../summary/embed';
import { serveRuntimeFrom, SpeechEngine } from './engine';
import type { AsrEvent, AsrRequest } from './protocol';

/**
 * The worker side of the protocol. Lives here rather than in the app so the only thing the
 * app owns is the `new Worker(...)` line that a bundler has to see literally.
 */
export function createAsrHandler(
  post: (event: AsrEvent) => void,
): (request: AsrRequest) => Promise<void> {
  // Both models download through transformers.js, and retry() around them only helps if a
  // stalled connection turns into an error.
  env.fetch = fetchUnlessStalled;
  const engine = new SpeechEngine();
  const embedder = new Embedder();

  // One onnxruntime per worker: a transcribe that overtook its load, or an embed racing a
  // pass, would share it between two callers.
  return queued(async (request) => {
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

      if (request.kind === 'transcribe') {
        const transcript = await engine.transcribe(request.samples);
        post({
          kind: 'transcript',
          id: request.id,
          transcript,
          elapsedMs: performance.now() - started,
        });
        return;
      }

      // The types stop at postMessage, so anything else is refused rather than guessed at.
      throw new AloudError('inference-failed', 'the worker was sent a request it does not know');
    } catch (error) {
      post({
        kind: 'failed',
        id: request.id,
        code: error instanceof AloudError ? error.code : 'inference-failed',
        message: unwrap(error),
      });
    }
  });
}
