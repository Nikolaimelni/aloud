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

export interface AsrClientOptions {
  readonly onProgress?: (progress: ModelProgress) => void;
}

export interface LoadedModel {
  readonly device: AsrDevice;
  readonly elapsedMs: number;
}

export interface TranscribeResult {
  readonly transcript: Transcript;
  readonly elapsedMs: number;
}

interface Pending {
  resolve: (event: AsrEvent) => void;
  reject: (error: Error) => void;
}

/** Main-thread half of the worker protocol. Takes a Worker rather than making one. */
export class AsrClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly worker: Worker,
    private readonly options: AsrClientOptions = {},
  ) {
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
