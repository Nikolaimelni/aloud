import { AloudError } from '../errors';
import type { Fetching } from '../fetching';
import { WorkerChannel } from '../worker-channel';
import { SILERO_VAD_URL, type VadEvent, type VadRequest, type VadTuning } from './protocol';

export type Verdict = {
  readonly speech: boolean;
  readonly probability: number;
};

export type VadLoadOptions = {
  readonly tuning?: VadTuning;
  readonly url?: string;
} & Fetching;

export class VadClient {
  private readonly channel: WorkerChannel<VadRequest, VadEvent>;

  constructor(worker: Worker) {
    this.channel = new WorkerChannel(worker, 'voice detection');
  }

  async load(options: VadLoadOptions = {}): Promise<number> {
    const { tuning = {}, url = SILERO_VAD_URL, ...fetching } = options;
    const event = await this.channel.request((id) => ({
      kind: 'load',
      id,
      url,
      tuning,
      ...fetching,
    }));
    if (event.kind !== 'loaded') {
      throw new AloudError('vad-load-failed', `worker answered load with ${event.kind}`);
    }
    return event.elapsedMs;
  }

  /** Forget the previous stream: its LSTM state, its gate, the samples it had left over. */
  async reset(): Promise<void> {
    const event = await this.channel.request((id) => ({ kind: 'reset', id }));
    if (event.kind !== 'reset') {
      throw new AloudError('vad-failed', `worker answered reset with ${event.kind}`);
    }
  }

  async classify(samples: Float32Array): Promise<Verdict> {
    const event = await this.channel.request((id) => ({ kind: 'classify', id, samples }));
    if (event.kind !== 'verdict') {
      throw new AloudError('vad-failed', `worker answered classify with ${event.kind}`);
    }
    return { speech: event.speech, probability: event.probability };
  }

  get alive(): boolean {
    return this.channel.alive;
  }

  dispose(): void {
    this.channel.dispose();
  }
}
