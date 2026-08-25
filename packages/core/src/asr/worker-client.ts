import { AloudError } from '../errors';
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

type Pending = {
  resolve: (event: AsrEvent) => void;
  reject: (error: Error) => void;
};

/** Main-thread half of the worker protocol. Takes a Worker rather than making one. */
export class AsrClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  private readonly worker: Worker;
  private readonly options: AsrClientOptions;

  constructor(worker: Worker, options: AsrClientOptions = {}) {
    this.worker = worker;
    this.options = options;

    worker.onmessage = (event: MessageEvent<AsrEvent>) => {
      this.receive(event.data);
    };
    worker.onerror = () => {
      this.failAll(new AloudError('inference-failed', 'the inference worker died'));
    };
  }

  async load(spec: AsrModelSpec): Promise<LoadedModel> {
    const event = await this.send({ kind: 'load', id: this.nextId++, spec });
    if (event.kind !== 'loaded') {
      throw new AloudError('model-load-failed', `worker answered load with ${event.kind}`);
    }
    return { device: event.device, elapsedMs: event.elapsedMs };
  }

  /** The samples are transferred, not copied. The array is empty once this returns. */
  async transcribe(
    samples: Float32Array,
    options: TranscribeOptions = {},
  ): Promise<TranscribeResult> {
    const buffer = samples.buffer;
    const transfer = buffer instanceof ArrayBuffer ? [buffer] : [];

    const event = await this.send(
      { kind: 'transcribe', id: this.nextId++, samples, options },
      transfer,
    );
    if (event.kind !== 'transcript') {
      throw new AloudError('inference-failed', `worker answered transcribe with ${event.kind}`);
    }
    return { transcript: event.transcript, elapsedMs: event.elapsedMs };
  }

  /** Unit vectors, one per text, for the extractive summary. */
  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const event = await this.send({ kind: 'embed', id: this.nextId++, texts });
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
    this.failAll(new AloudError('inference-failed', 'the client was disposed'));
    this.worker.terminate();
  }

  private send(request: AsrRequest, transfer: Transferable[] = []): Promise<AsrEvent> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.worker.postMessage(request, transfer);
    });
  }

  private receive(event: AsrEvent): void {
    if (event.kind === 'progress') {
      this.options.onProgress?.(event.progress);
      return;
    }

    const pending = this.pending.get(event.id);
    if (!pending) return;
    this.pending.delete(event.id);

    if (event.kind === 'failed') {
      pending.reject(new AloudError(event.code, event.message));
    } else {
      pending.resolve(event);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
