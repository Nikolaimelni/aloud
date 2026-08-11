import { AloudError } from '../errors';
import { SpeechGate } from './gate';
import { SileroVad, VAD_BLOCK, VAD_BLOCK_MS } from './silero';
import type { VadEvent, VadRequest } from './protocol';

/**
 * Worker side of the detector. Audio frames do not arrive in multiples of 512, so whatever
 * is left over waits here for the next frame.
 */
export function createVadHandler(
  post: (event: VadEvent) => void,
): (request: VadRequest) => Promise<void> {
  const detector = new SileroVad();
  let gate = new SpeechGate();
  let leftover = new Float32Array(0);

  return async (request) => {
    try {
      if (request.kind === 'load') {
        const started = performance.now();
        await detector.load(request.url);
        gate = new SpeechGate(request.tuning);
        post({ kind: 'loaded', id: request.id, elapsedMs: performance.now() - started });
        return;
      }

      const pending = new Float32Array(leftover.length + request.samples.length);
      pending.set(leftover);
      pending.set(request.samples, leftover.length);

      let at = 0;
      let speech = false;
      let probability = 0;

      while (at + VAD_BLOCK <= pending.length) {
        probability = await detector.probability(pending.subarray(at, at + VAD_BLOCK));
        speech = gate.update(probability, VAD_BLOCK_MS) || speech;
        at += VAD_BLOCK;
      }

      leftover = pending.slice(at);
      post({
        kind: 'verdict',
        id: request.id,
        speech: speech || gate.speaking,
        probability,
      });
    } catch (error) {
      post({
        kind: 'failed',
        id: request.id,
        message: error instanceof AloudError ? error.message : String(error),
      });
    }
  };
}
