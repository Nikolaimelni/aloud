import { AsrClient } from './asr/worker-client';
import type { AsrDevice, AsrModelSpec, ModelProgress } from './asr/protocol';
import { VadClient } from './vad/worker-client';

export type Engines = {
  readonly asr: AsrClient;
  readonly vad: VadClient;
  readonly device: AsrDevice;
  readonly elapsedMs: number;
};

export type EngineOptions = {
  /** Factories rather than Workers: a bundler only emits a worker it can see being constructed. */
  readonly asrWorker: () => Worker;
  readonly vadWorker: () => Worker;
  readonly spec: AsrModelSpec;
  /** Where the page serves onnxruntime's wasm. Left out, both workers fetch it from jsDelivr. */
  readonly runtimeUrl?: string;
  readonly onProgress?: (progress: ModelProgress) => void;
};

/**
 * Both workers, loaded side by side. If either one fails, both are terminated: a Worker nobody
 * holds a reference to keeps running, and keeps downloading, until the page goes away.
 */
export async function loadEngines(options: EngineOptions): Promise<Engines> {
  const { runtimeUrl, onProgress } = options;
  const asr = new AsrClient(options.asrWorker(), onProgress ? { onProgress } : {});
  const vad = new VadClient(options.vadWorker());

  try {
    const [model] = await Promise.all([
      asr.load(options.spec, runtimeUrl),
      vad.load(runtimeUrl ? { runtimeUrl } : {}),
    ]);
    return { asr, vad, device: model.device, elapsedMs: model.elapsedMs };
  } catch (cause) {
    asr.dispose();
    vad.dispose();
    throw cause;
  }
}
