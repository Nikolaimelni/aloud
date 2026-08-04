import { computed, Injectable, signal } from '@angular/core';
import { AloudError } from '@aloud/core/errors';
import { AsrClient } from '@aloud/core/asr/worker-client';
import type {
  AsrDevice,
  AsrPrecision,
  ModelProgress,
  Transcript,
  TranscribeOptions,
} from '@aloud/core/asr/protocol';
import { decodeToMono16k, secondsOf } from './decode';

export const MODELS = [
  'onnx-community/whisper-tiny',
  'onnx-community/whisper-base',
  'onnx-community/whisper-small',
] as const;

export const PRECISIONS = ['auto', 'fp32', 'fp16', 'q8', 'q4'] as const;

export type Phase = 'idle' | 'decoding' | 'loading' | 'running' | 'done' | 'error';

export interface RunStats {
  readonly device: AsrDevice;
  readonly audioSeconds: number;
  readonly inferenceMs: number;
  readonly loadMs: number;
}

@Injectable({ providedIn: 'root' })
export class TranscribeStore {
  private client: AsrClient | null = null;
  private loadedKey: string | null = null;
  private loadMs = 0;
  private readonly downloads = new Map<string, ModelProgress>();

  private readonly active = signal<AsrDevice | null>(null);

  readonly model = signal<string>('onnx-community/whisper-base');
  readonly device = signal<AsrDevice | 'auto'>('auto');
  readonly precision = signal<AsrPrecision | 'auto'>('auto');
  readonly language = signal('');
  readonly translate = signal(false);

  readonly phase = signal<Phase>('idle');
  readonly download = signal<{ loaded: number; total: number } | null>(null);
  readonly error = signal<string | null>(null);
  readonly transcript = signal<Transcript | null>(null);
  readonly stats = signal<RunStats | null>(null);

  /** Seconds of compute per second of audio. Under 1 means it could keep up with speech. */
  readonly realTimeFactor = computed(() => {
    const stats = this.stats();
    return stats ? stats.inferenceMs / 1000 / stats.audioSeconds : null;
  });

  readonly busy = computed(() => {
    const phase = this.phase();
    return phase === 'decoding' || phase === 'loading' || phase === 'running';
  });

  async run(file: File): Promise<void> {
    this.error.set(null);
    this.transcript.set(null);
    this.stats.set(null);

    try {
      this.phase.set('decoding');
      const samples = await decodeToMono16k(file);
      const audioSeconds = secondsOf(samples);

      const client = await this.ready();

      this.phase.set('running');
      const result = await client.transcribe(samples, this.transcribeOptions());

      this.transcript.set(result.transcript);
      this.stats.set({
        device: this.resolvedDevice(),
        audioSeconds,
        inferenceMs: result.elapsedMs,
        loadMs: this.loadMs,
      });
      this.phase.set('done');
    } catch (cause) {
      this.error.set(explain(cause));
      this.phase.set('error');
    }
  }

  private async ready(): Promise<AsrClient> {
    const key = `${this.model()}|${this.device()}|${this.precision()}`;
    const existing = this.client;
    if (existing && this.loadedKey === key) {
      return existing;
    }

    existing?.dispose();
    this.downloads.clear();
    this.download.set(null);

    const client = new AsrClient(
      new Worker(new URL('../asr/asr.worker', import.meta.url), { type: 'module' }),
      { onProgress: (progress) => this.track(progress) },
    );
    this.client = client;

    this.phase.set('loading');
    const precision = this.precision();
    const loaded = await client.load({
      model: this.model(),
      device: this.device(),
      ...(precision === 'auto' ? {} : { dtype: precision }),
    });

    this.loadedKey = key;
    this.loadMs = loaded.elapsedMs;
    this.active.set(loaded.device);
    this.download.set(null);
    return client;
  }

  resolvedDevice(): AsrDevice {
    return this.active() ?? 'wasm';
  }

  private transcribeOptions(): TranscribeOptions {
    const language = this.language().trim();
    return {
      task: this.translate() ? 'translate' : 'transcribe',
      timestamps: true,
      ...(language ? { language } : {}),
    };
  }

  /** Weights arrive as several files at once, so the bar tracks the sum, not the last one. */
  private track(progress: ModelProgress): void {
    this.downloads.set(progress.file, progress);

    let loaded = 0;
    let total = 0;
    for (const file of this.downloads.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    this.download.set({ loaded, total });
  }
}

function explain(cause: unknown): string {
  if (cause instanceof AloudError) {
    switch (cause.code) {
      case 'invalid-wav':
      case 'unsupported-wav-format':
        return 'That file is not audio this build can read.';
      case 'model-load-failed':
        return `The model did not load. ${cause.message}`;
      default:
        return cause.message;
    }
  }
  return cause instanceof Error ? cause.message : 'Something failed without saying what.';
}
