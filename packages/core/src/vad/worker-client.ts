import { AloudError } from '../errors';
import { SILERO_VAD_URL, type VadEvent, type VadRequest, type VadTuning } from './protocol';

export interface Verdict {
  readonly speech: boolean;
  readonly probability: number;
}

interface Pending {
  resolve: (event: VadEvent) => void;
  reject: (error: Error) => void;
}

export class VadClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<VadEvent>) => {
      this.settle(event.data);
    };
    worker.onerror = () => {
      this.failAll(new AloudError('vad-failed', 'the detector worker died'));
    };
  }

  async load(tuning: VadTuning = {}, url: string = SILERO_VAD_URL): Promise<number> {
    const event = await this.send({ kind: 'load', id: this.nextId++, url, tuning });
    if (event.kind !== 'loaded') {
      throw new AloudError('vad-load-failed', `worker answered load with ${event.kind}`);
    }
    return event.elapsedMs;
  }

  async classify(samples: Float32Array): Promise<Verdict> {
    const event = await this.send({ kind: 'classify', id: this.nextId++, samples });
    if (event.kind !== 'verdict') {
      throw new AloudError('vad-failed', `worker answered classify with ${event.kind}`);
    }
    return { speech: event.speech, probability: event.probability };
  }

  dispose(): void {
    this.failAll(new AloudError('vad-failed', 'the client was disposed'));
    this.worker.terminate();
  }

  private send(request: VadRequest): Promise<VadEvent> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private settle(event: VadEvent): void {
    const pending = this.pending.get(event.id);
    if (!pending) return;
    this.pending.delete(event.id);

    if (event.kind === 'failed') {
      pending.reject(new AloudError('vad-failed', event.message));
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
