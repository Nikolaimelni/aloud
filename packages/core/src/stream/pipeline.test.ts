import { describe, expect, it } from 'vitest';
import type { TranscribeResult } from '../asr/worker-client';
import { TARGET_SAMPLE_RATE, type AudioSource, type FrameHandler } from '../audio/source';
import { StreamingTranscriber, type StreamUpdate } from './pipeline';

class FakeSource implements AudioSource {
  private handler: FrameHandler | null = null;
  private done: () => void = () => {};

  readonly finished = new Promise<void>((resolve) => {
    this.done = resolve;
  });
  readonly live: boolean;

  constructor(live = false) {
    this.live = live;
  }

  async start(onFrame: FrameHandler): Promise<void> {
    this.handler = onFrame;
  }

  async stop(): Promise<void> {
    this.done();
  }

  /** Seconds of speech from `at`, and whatever the pipeline handed back for it. */
  play(at: number, seconds: number): Promise<void> {
    const samples = new Float32Array(Math.round(seconds * TARGET_SAMPLE_RATE));
    return Promise.resolve(this.handler?.({ samples, time: at }));
  }
}

class DeniedSource extends FakeSource {
  override async start(): Promise<void> {
    throw new Error('permission denied');
  }
}

/** A model whose passes finish when the test says so. */
function slowModel() {
  const passes: (() => void)[] = [];
  return {
    passes,
    transcribe: () =>
      new Promise<TranscribeResult>((resolve) => {
        passes.push(() => resolve({ transcript: { text: '', chunks: [] }, elapsedMs: 0 }));
      }),
  };
}

const vad = {
  reset: async () => {},
  classify: async () => ({ speech: true, probability: 1 }),
};

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await settle();
  return settled;
}

describe('StreamingTranscriber', () => {
  it('runs one pass at a time, and the next window gets what arrived meanwhile', async () => {
    const model = slowModel();
    const source = new FakeSource();
    const transcriber = new StreamingTranscriber(source, vad, model, {
      chunker: { stepSeconds: 1 },
      onUpdate: () => {},
    });
    await transcriber.start();

    await source.play(0, 1.2);
    await source.play(1.2, 1.2);
    expect(model.passes).toHaveLength(1);

    model.passes[0]!();
    await settle();
    expect(model.passes).toHaveLength(2);
  });

  it('waits for the last pass before finishing, and sends its audio once', async () => {
    const model = slowModel();
    const source = new FakeSource();
    const updates: StreamUpdate[] = [];
    const transcriber = new StreamingTranscriber(source, vad, model, {
      chunker: { stepSeconds: 1 },
      onUpdate: (update) => updates.push(update),
    });
    await transcriber.start();
    await source.play(0, 1.2);
    await source.play(1.2, 1.2);

    const stopped = transcriber.stop();
    model.passes[0]!();
    await settle();
    expect(model.passes).toHaveLength(2);
    expect(await settledYet(stopped)).toBe(false);

    model.passes[1]!();
    await stopped;

    expect(model.passes).toHaveLength(2);
    expect(updates.at(-1)?.passes).toBe(2);
  });

  it('settles when the source never starts, so stop() does not hang', async () => {
    const transcriber = new StreamingTranscriber(new DeniedSource(), vad, slowModel(), {
      onUpdate: () => {},
    });

    await expect(transcriber.start()).rejects.toThrow('permission denied');
    expect(await settledYet(transcriber.stop())).toBe(true);
  });

  it('holds back a source that can wait while the model is busy', async () => {
    const model = slowModel();
    const source = new FakeSource();
    const transcriber = new StreamingTranscriber(source, vad, model, {
      chunker: { stepSeconds: 1 },
      backpressureSeconds: 2,
      onUpdate: () => {},
    });
    await transcriber.start();
    await source.play(0, 1.2);

    const held = source.play(1.2, 2.5);
    expect(await settledYet(held)).toBe(false);

    model.passes[0]!();
    expect(await settledYet(held)).toBe(true);
  });

  it('never holds back a live source, so its backlog shows how far behind it is', async () => {
    const model = slowModel();
    const source = new FakeSource(true);
    const updates: StreamUpdate[] = [];
    const transcriber = new StreamingTranscriber(source, vad, model, {
      chunker: { stepSeconds: 1 },
      backpressureSeconds: 2,
      onUpdate: (update) => updates.push(update),
    });
    await transcriber.start();
    await source.play(0, 1.2);

    expect(await settledYet(source.play(1.2, 2.5))).toBe(true);
    expect(await settledYet(source.play(3.7, 2.5))).toBe(true);

    model.passes[0]!();
    await settle();
    expect(updates.at(-1)?.heardSeconds).toBeCloseTo(6.2, 4);
    expect(updates.at(-1)?.backlogSeconds).toBeCloseTo(5, 4);
  });
});
