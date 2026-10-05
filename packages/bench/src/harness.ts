import { MODELS, type ModelSize } from '@aloud/core/asr/models';
import type { AsrDevice, AsrPrecision } from '@aloud/core/asr/protocol';
import type { AsrClient } from '@aloud/core/asr/worker-client';
import { WavSource } from '@aloud/core/audio/wav-source';
import { loadEngines } from '@aloud/core/engines';
import { unwrap } from '@aloud/core/errors';
import { retry } from '@aloud/core/retry';
import { StreamingTranscriber } from '@aloud/core/stream/pipeline';
import type { VadClient } from '@aloud/core/vad/worker-client';

export type RunConfig = {
  readonly url: string;
  readonly model: ModelSize;
  readonly device: AsrDevice;
  readonly dtype: AsrPrecision;
  readonly stepSeconds: number;
  /**
   * `file` is the app reading a file as fast as it goes, finals only. `live` plays it at real
   * speed, guesses and all, which is the only setting where the lag figures mean anything.
   */
  readonly mode: 'file' | 'live';
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
  loaded = null;

  const { id, revision } = MODELS[config.model];
  const engines = await loadEngines({
    asrWorker: () => new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' }),
    vadWorker: () => new Worker(new URL('./vad.worker.ts', import.meta.url), { type: 'module' }),
    spec: { model: id, revision, device: config.device, dtype: config.dtype },
  });

  loaded = { key, ...engines, loadMs: engines.elapsedMs };
  return loaded;
}

async function run(config: RunConfig): Promise<RunResult> {
  const data = await fetchFixture(config.url);

  const { asr, vad, device, loadMs } = await engines(config);
  const started = performance.now();

  const source = new WavSource({ data, speed: config.mode === 'live' ? 1 : Infinity });
  const lagSeconds: number[] = [];
  const errors: string[] = [];
  let computeMs = 0;
  let passes = 0;
  let heard = 0;
  let text = '';

  let lines = 0;

  const transcriber = new StreamingTranscriber(source, vad, asr, {
    segmenter: { stepSeconds: config.stepSeconds },
    onUpdate: (update) => {
      computeMs = update.computeMs;
      passes = update.passes;
      heard = update.heardSeconds;
      text = update.confirmed.map((line) => line.text).join(' ');
      // One lag per line, taken when it lands: a guess repeats the figure without adding one.
      if (update.confirmed.length > lines) {
        lines = update.confirmed.length;
        // A file read flat out is ahead of itself, so its lag is not a lag.
        if (config.mode === 'live') lagSeconds.push(update.confirmedLagSeconds);
      }
    },
    onError: (error) => errors.push(unwrap(error)),
  });

  await transcriber.start();
  await transcriber.finished;

  // A pass that fails is otherwise just a pass that never happened, and a run where every pass
  // failed comes back as zero passes and a minute of lag that looks like a measurement.
  if (errors.length > 0) {
    throw new Error(`${errors.length} passes failed, first: ${errors[0]}`);
  }

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
async function fetchFixture(url: string): Promise<ArrayBuffer> {
  try {
    return await retry(
      async () => {
        // A stalled connection never throws on its own, and would eat the whole run timeout.
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`fixture came back ${response.status}`);
        return response.arrayBuffer();
      },
      { attempts: 4, backoffMs: 500 },
    );
  } catch (cause) {
    throw new Error(`could not fetch ${url}: ${unwrap(cause)}`, { cause });
  }
}

Object.assign(globalThis, { aloudBench: { run } });
