import { describe, expect, it } from 'vitest';
import { createVadHandler } from './serve';
import type { VadEvent, VadRequest } from './protocol';

describe('createVadHandler', () => {
  it('refuses a request it does not know instead of classifying it', async () => {
    const events: VadEvent[] = [];
    const handle = createVadHandler((event) => events.push(event));

    const samples = new Float32Array(100);
    await handle({ kind: 'transcribe', id: 7, samples } as unknown as VadRequest);

    expect(events).toEqual([
      expect.objectContaining({ kind: 'failed', id: 7, code: 'vad-failed' }),
    ]);
  });
});
