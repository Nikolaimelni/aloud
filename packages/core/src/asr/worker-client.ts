import { AloudError } from '../errors';
import { WorkerChannel } from '../worker-channel';
import type {
  AsrDevice,
  AsrEvent,
  AsrModelSpec,
  AsrRequest,
  ModelProgress,
  Transcript,
  TranscribeOptions,
} from './protocol';

export type AsrClientOptions = {
  readonly onProgress?: (progress: ModelProgress) => void;
};

export type LoadedModel = {
  readonly device: AsrDevice;
  readonly elapsedMs: number;
};

export type TranscribeResult = {
  readonly transcript: Transcript;
  readonly elapsedMs: number;
};

/** Main-thread half of the worker protocol. Takes a Worker rather than making one. */
export class AsrClient {
  private readonly channel: WorkerChannel<AsrRequest, AsrEvent>;

  constructor(worker: Worker, options: AsrClientOptions = {}) {
    this.channel = new WorkerChannel(worker, 'inference-failed', (event) => {
      if (event.kind === 'progress') options.onProgress?.(event.progress);
    });
  }

  /** `runtimeUrl` is where the page serves onnxruntime's wasm; left out, it comes from jsDelivr. */
  async load(spec: AsrModelSpec, runtimeUrl?: string): Promise<LoadedModel> {
    const event = await this.channel.request((id) => ({
      kind: 'load',
      id,
      spec,
      ...(runtimeUrl ? { runtimeUrl } : {}),
    }));
    if (event.kind !== 'loaded') {
      throw new AloudError('model-load-failed', `worker answered load with ${event.kind}`);
    }
    return { device: event.device, elapsedMs: event.elapsedMs };
  }

  /** The samples are transferred, not copied: the array is empty as soon as this is called. */
  async transcribe(
    samples: Float32Array,
    options: TranscribeOptions = {},
  ): Promise<TranscribeResult> {
    const buffer = samples.buffer;
    const transfer = buffer instanceof ArrayBuffer ? [buffer] : [];

    const event = await this.channel.request(
      (id) => ({ kind: 'transcribe', id, samples, options }),
      transfer,
    );
    if (event.kind !== 'transcript') {
      throw new AloudError('inference-failed', `worker answered transcribe with ${event.kind}`);
    }
    return { transcript: event.transcript, elapsedMs: event.elapsedMs };
  }

  /** Unit vectors, one per text, for the extractive summary. Whisper need not be loaded. */
  async embed(texts: readonly string[], runtimeUrl?: string): Promise<Float32Array[]> {
    const event = await this.channel.request((id) => ({
      kind: 'embed',
      id,
      texts,
      ...(runtimeUrl ? { runtimeUrl } : {}),
    }));
    if (event.kind !== 'vectors') {
      throw new AloudError('inference-failed', `worker answered embed with ${event.kind}`);
    }

    const [rows, width] = event.dims;
    const vectors: Float32Array[] = [];
    for (let row = 0; row < rows; row++) {
      vectors.push(event.data.subarray(row * width, (row + 1) * width));
    }
    return vectors;
  }

  dispose(): void {
    this.channel.dispose('inference-failed');
  }
}
