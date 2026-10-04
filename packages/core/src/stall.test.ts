import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUnlessStalled } from './stall';

/** A body that sends one chunk per entry in `gaps`, each that many milliseconds after the last. */
function trickle(gaps: readonly number[]): Response {
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === gaps.length) {
          controller.close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, gaps[sent]));
        sent++;
        controller.enqueue(new Uint8Array([sent]));
      },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchUnlessStalled', () => {
  it('lets a slow download finish as long as bytes keep coming', async () => {
    vi.stubGlobal('fetch', async () => trickle([30, 30, 30, 30]));

    const response = await fetchUnlessStalled('https://example.test/weights', {}, 50);

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('fails a download whose bytes stop', async () => {
    // One chunk, then nothing, until the signal errors the body the way a real fetch does.
    vi.stubGlobal(
      'fetch',
      async (_input: string, init: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
            },
          }),
        ),
    );

    const response = await fetchUnlessStalled('https://example.test/weights', {}, 50);

    await expect(response.arrayBuffer()).rejects.toThrow('no data for 0.05 s');
  });
});
