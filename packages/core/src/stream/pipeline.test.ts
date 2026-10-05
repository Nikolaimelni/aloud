import { describe, expect, it } from 'vitest';
import type { TranscribeResult } from '../asr/worker-client';
import { TARGET_SAMPLE_RATE, type AudioSource, type FrameHandler } from '../audio/source';
import { StreamingTranscriber, type StreamUpdate } from './pipeline';

const FRAME = 0.1;

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

  /** Tenth-of-a-second frames from `at`; settles when the pipeline is done with the last. */
  play(at: number, seconds: number, speech = true): Promise<void> {
    let last: void | Promise<void> = undefined;
    for (let i = 0; i < Math.round(seconds / FRAME); i++) {
      const samples = new Float32Array(FRAME * TARGET_SAMPLE_RATE).fill(speech ? 0.3 : 0);
      last = this.handler?.({ samples, time: at + i * FRAME });
    }
    return Promise.resolve(last);
  }
}

class DeniedSource extends FakeSource {
  override async start(): Promise<void> {
    throw new Error('permission denied');
  }
}

type Pass = { readonly seconds: number; finish(text?: string): void };

/** A model whose passes finish when the test says so, with whatever text it is given. */
function slowModel() {
  const passes: Pass[] = [];
  return {
    passes,
    transcribe: (samples: Float32Array) =>
      new Promise<TranscribeResult>((resolve) => {
        passes.push({
          seconds: samples.length / TARGET_SAMPLE_RATE,
          finish: (text = '') => resolve({ transcript: { text, chunks: [] }, elapsedMs: 0 }),
        });
      }),
  };
}

const vad = {
  reset: async () => {},
  classify: async (samples: Float32Array) => ({ speech: samples[0] !== 0, probability: 1 }),
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
  it('turns a pause into a line', async () => {
    const model = slowModel();
    const updates: StreamUpdate[] = [];
    const source = new FakeSource();
    const transcriber = new StreamingTranscriber(source, vad, model, {
      onUpdate: (update) => updates.push(update),
    });
    await transcriber.start();

    await source.play(0, 1);
    await source.play(1, 0.6, false);
    model.passes[0]!.finish('Hello there.');
    await settle();

    const lines = updates.at(-1)?.confirmed ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Hello there.');
    expect(lines[0]?.start).toBe(0);
    expect(lines[0]?.end).toBeCloseTo(1.2, 4);
  });

  it('shows a guess at the line being spoken, then the line in its place', async () => {
    const model = slowModel();
    const updates: StreamUpdate[] = [];
    const source = new FakeSource(true);
    const transcriber = new StreamingTranscriber(source, vad, model, {
      onUpdate: (update) => updates.push(update),
    });
    await transcriber.start();

    await source.play(0, 0.6);
    model.passes[0]!.finish('Hello');
    await settle();
    expect(updates.at(-1)?.pending).toBe('Hello');

    await source.play(0.6, 0.6, false);
    model.passes[1]!.finish('Hello there.');
    await settle();
    expect(updates.at(-1)?.pending).toBe('');
    expect(updates.at(-1)?.confirmed.map((line) => line.text)).toEqual(['Hello there.']);
  });

  it('does not guess for a file read as fast as it goes', async () => {
    const model = slowModel();
    const source = new FakeSource();
    const transcriber = new StreamingTranscriber(source, vad, model, { onUpdate: () => {} });
    await transcriber.start();

    await source.play(0, 3);

    expect(model.passes).toHaveLength(0);
  });

  it('reads a finished line before guessing again', async () => {
    const model = slowModel();
    const source = new FakeSource(true);
    const transcriber = new StreamingTranscriber(source, vad, model, { onUpdate: () => {} });
    await transcriber.start();

    await source.play(0, 0.6);
    await source.play(0.6, 0.6, false);
    await source.play(1.2, 1);
    expect(model.passes).toHaveLength(1);

    model.passes[0]!.finish();
    await settle();
    expect(model.passes[1]?.seconds).toBeCloseTo(0.8, 4);
  });

  it('waits for the last pass before finishing, and reads each line once', async () => {
    const model = slowModel();
    const updates: StreamUpdate[] = [];
    const source = new FakeSource();
    const transcriber = new StreamingTranscriber(source, vad, model, {
      onUpdate: (update) => updates.push(update),
    });
    await transcriber.start();
    await source.play(0, 1);
    await source.play(1, 0.6, false);
    await source.play(1.6, 1);

    const stopped = transcriber.stop();
    model.passes[0]!.finish('One.');
    await settle();
    expect(model.passes).toHaveLength(2);
    expect(await settledYet(stopped)).toBe(false);

    model.passes[1]!.finish('Two.');
    await stopped;
    expect(model.passes).toHaveLength(2);
    expect(updates.at(-1)?.confirmed.map((line) => line.text)).toEqual(['One.', 'Two.']);
  });

  it('settles when the source never starts, so stop() does not hang', async () => {
    const transcriber = new StreamingTranscriber(new DeniedSource(), vad, slowModel(), {
      onUpdate: () => {},
    });

    await expect(transcriber.start()).rejects.toThrow('permission denied');
    expect(await settledYet(transcriber.stop())).toBe(true);
  });

  it('holds back a source that can wait while lines pile up', async () => {
    const model = slowModel();
    const source = new FakeSource();
    const transcriber = new StreamingTranscriber(source, vad, model, {
      backpressureSeconds: 1,
      onUpdate: () => {},
    });
    await transcriber.start();
    await source.play(0, 1);

    const held = source.play(1, 0.6, false);
    expect(await settledYet(held)).toBe(false);

    model.passes[0]!.finish();
    expect(await settledYet(held)).toBe(true);
  });

  it('never holds back a live source', async () => {
    const model = slowModel();
    const source = new FakeSource(true);
    const transcriber = new StreamingTranscriber(source, vad, model, {
      backpressureSeconds: 1,
      onUpdate: () => {},
    });
    await transcriber.start();

    expect(await settledYet(source.play(0, 1))).toBe(true);
    expect(await settledYet(source.play(1, 3, false))).toBe(true);
  });
});
