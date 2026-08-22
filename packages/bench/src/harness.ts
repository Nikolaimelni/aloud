import { AsrClient } from '@aloud/core/asr/worker-client';
import { WavSource } from '@aloud/core/audio/wav-source';
import { StreamingTranscriber } from '@aloud/core/stream/pipeline';
import { textOf } from '@aloud/core/stream/stabilize';
import { VadClient } from '@aloud/core/vad/worker-client';
import type { AsrDevice, AsrPrecision } from '@aloud/core/asr/protocol';

export type RunConfig = {
  readonly url: string;
  readonly model: string;
  readonly device: AsrDevice | 'auto';
  readonly dtype: AsrPrecision;
  readonly stepSeconds: number;
  readonly language?: string;
  /** `stream` runs the live pipeline; `oneshot` is one pass over the whole file. */
  readonly mode: 'stream' | 'oneshot';
  /** Real time is the only setting where the lag figures mean anything. */
  readonly realtime: boolean;
};

export type RunResult = {
  readonly text: string;
  readonly device: AsrDevice;
  readonly audioSeconds: number;
  readonly computeMs: number;
  readonly wallMs: number;
  readonly passes: number;
  readonly lagSeconds: readonly number[];
  readonly loadMs: number;
};

let loaded: {
  key: string;
  asr: AsrClient;
  vad: VadClient;
  device: AsrDevice;
  loadMs: number;
} | null = null;

async function engines(config: RunConfig) {
  const key = `${config.model}|${config.device}|${config.dtype}`;
  if (loaded && loaded.key === key) return loaded;

  loaded?.asr.dispose();
  loaded?.vad.dispose();

  const asr = new AsrClient(
    new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' }),
  );
  const vad = new VadClient(
    new Worker(new URL('./vad.worker.ts', import.meta.url), { type: 'module' }),
  );

  const [model] = await Promise.all([
    asr.load({ model: config.model, device: config.device, dtype: config.dtype }),
    vad.load(),
  ]);

  loaded = { key, asr, vad, device: model.device, loadMs: model.elapsedMs };
  return loaded;
}

async function run(config: RunConfig): Promise<RunResult> {
  const data = await fetchFixture(config.url);

  const { asr, vad, device, loadMs } = await engines(config);
  const started = performance.now();

  if (config.mode === 'oneshot') {
    const samples = await collect(new WavSource({ data, speed: Infinity }));
    const result = await asr.transcribe(samples.slice(), {
      timestamps: true,
      ...(config.language ? { language: config.language } : {}),
    });

    return {
      text: result.transcript.text,
      device,
      audioSeconds: samples.length / 16_000,
      computeMs: result.elapsedMs,
      wallMs: performance.now() - started,
      passes: 1,
      lagSeconds: [],
      loadMs,
    };
  }

  const source = new WavSource({ data, speed: config.realtime ? 1 : Infinity });
  const lagSeconds: number[] = [];
  let computeMs = 0;
  let passes = 0;
  let heard = 0;
  let text = '';

  const transcriber = new StreamingTranscriber(source, vad, asr, {
    chunker: { stepSeconds: config.stepSeconds },
    transcribe: {
      ...(config.language ? { language: config.language } : {}),
    },
    onUpdate: (update) => {
      computeMs += update.lastPassMs;
      passes = update.passes;
      heard = update.heardSeconds;
      text = textOf(update.confirmed);
      if (update.confirmedLagSeconds > 0) {
        lagSeconds.push(update.confirmedLagSeconds);
      }
    },
  });

  await transcriber.start();
  await transcriber.finished;

  return {
    text,
    device,
    audioSeconds: heard,
    computeMs,
    wallMs: performance.now() - started,
    passes,
    lagSeconds,
    loadMs,
  };
}

/** The CDN drops a connection now and then, and losing a row of the table to that is silly. */
async function fetchFixture(url: string, attempts = 4): Promise<ArrayBuffer> {
  let last: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fixture came back ${response.status}`);
      return await response.arrayBuffer();
    } catch (cause) {
      last = cause;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw new Error(`could not fetch ${url}: ${last instanceof Error ? last.message : String(last)}`);
}

async function collect(source: WavSource): Promise<Float32Array> {
  const blocks: Float32Array[] = [];
  await source.start((frame) => {
    blocks.push(frame.samples);
  });
  await source.finished;

  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}

Object.assign(globalThis, { aloudBench: { run } });
