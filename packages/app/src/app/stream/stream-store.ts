import { Injectable, inject, signal } from '@angular/core';
import { AsrClient } from '@aloud/core/asr/worker-client';
import { WavSource } from '@aloud/core/audio/wav-source';
import { StreamingTranscriber } from '@aloud/core/stream/pipeline';
import { textOf } from '@aloud/core/stream/stabilize';
import { VadClient } from '@aloud/core/vad/worker-client';
import type { ModelProgress } from '@aloud/core/asr/protocol';
import { ModelSettings } from '../model/model-settings';

export type StreamPhase = 'idle' | 'loading' | 'running' | 'done' | 'error';

@Injectable({ providedIn: 'root' })
export class StreamStore {
  private readonly settings = inject(ModelSettings);

  private asr: AsrClient | null = null;
  private vad: VadClient | null = null;
  private transcriber: StreamingTranscriber | null = null;
  private loadedKey: string | null = null;
  private readonly downloads = new Map<string, ModelProgress>();

  readonly phase = signal<StreamPhase>('idle');
  readonly confirmed = signal('');
  readonly pending = signal('');
  readonly backlog = signal(0);
  readonly passes = signal(0);
  readonly lastPassMs = signal(0);
  readonly error = signal<string | null>(null);
  readonly download = signal<{ loaded: number; total: number } | null>(null);

  readonly fasterThanReal = signal(true);
  readonly stepSeconds = signal(1.5);

  async run(file: File): Promise<void> {
    this.error.set(null);
    this.confirmed.set('');
    this.pending.set('');
    this.passes.set(0);
    this.backlog.set(0);

    try {
      this.phase.set('loading');
      const { asr, vad } = await this.ready();

      const data = await file.arrayBuffer();
      const source = new WavSource({
        data,
        speed: this.fasterThanReal() ? Infinity : 1,
      });

      const language = this.settings.language().trim();
      const transcriber = new StreamingTranscriber(source, vad, asr, {
        chunker: { stepSeconds: this.stepSeconds() },
        transcribe: language ? { language } : {},
        onUpdate: (update) => {
          this.confirmed.set(textOf(update.confirmed));
          this.pending.set(textOf(update.pending));
          this.backlog.set(update.backlogSeconds);
          this.passes.set(update.passes);
          this.lastPassMs.set(update.lastPassMs);
        },
        onError: (cause) => this.error.set(message(cause)),
      });
      this.transcriber = transcriber;

      this.phase.set('running');
      await transcriber.start();
      await transcriber.finished;
      this.phase.set('done');
    } catch (cause) {
      this.error.set(message(cause));
      this.phase.set('error');
    }
  }

  async stop(): Promise<void> {
    await this.transcriber?.stop();
    this.transcriber = null;
    this.phase.set('idle');
  }

  private async ready(): Promise<{ asr: AsrClient; vad: VadClient }> {
    const key = this.settings.key();
    if (this.asr && this.vad && this.loadedKey === key) {
      return { asr: this.asr, vad: this.vad };
    }

    this.asr?.dispose();
    this.vad?.dispose();
    this.downloads.clear();

    const asr = new AsrClient(
      new Worker(new URL('../asr/asr.worker', import.meta.url), { type: 'module' }),
      { onProgress: (progress) => this.track(progress) },
    );
    const vad = new VadClient(
      new Worker(new URL('../vad/vad.worker', import.meta.url), { type: 'module' }),
    );

    await Promise.all([asr.load(this.settings.spec()), vad.load()]);

    this.asr = asr;
    this.vad = vad;
    this.loadedKey = key;
    this.download.set(null);
    return { asr, vad };
  }

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

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Something failed without saying what.';
}
