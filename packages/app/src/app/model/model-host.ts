import { inject, Injectable, signal } from '@angular/core';
import { AsrClient } from '@aloud/core/asr/worker-client';
import { VadClient } from '@aloud/core/vad/worker-client';
import type { AsrDevice, ModelProgress } from '@aloud/core/asr/protocol';
import { ModelSettings } from './model-settings';

export interface Loaded {
  readonly asr: AsrClient;
  readonly vad: VadClient;
}

/** Owns the two workers so a session does not load the same weights twice. */
@Injectable({ providedIn: 'root' })
export class ModelHost {
  private readonly settings = inject(ModelSettings);
  private readonly downloads = new Map<string, ModelProgress>();

  private asr: AsrClient | null = null;
  private vad: VadClient | null = null;
  private loadedKey: string | null = null;

  readonly loading = signal(false);
  readonly download = signal<{ loaded: number; total: number } | null>(null);
  readonly device = signal<AsrDevice | null>(null);
  readonly loadMs = signal(0);

  get isLoaded(): boolean {
    return this.loadedKey === this.settings.key();
  }

  async ready(): Promise<Loaded> {
    const key = this.settings.key();
    if (this.asr && this.vad && this.loadedKey === key) {
      return { asr: this.asr, vad: this.vad };
    }

    this.asr?.dispose();
    this.vad?.dispose();
    this.asr = null;
    this.vad = null;
    this.loadedKey = null;
    this.downloads.clear();
    this.download.set(null);
    this.loading.set(true);

    try {
      const asr = new AsrClient(
        new Worker(new URL('../asr/asr.worker', import.meta.url), { type: 'module' }),
        { onProgress: (progress) => this.track(progress) },
      );
      const vad = new VadClient(
        new Worker(new URL('../vad/vad.worker', import.meta.url), { type: 'module' }),
      );

      const [model] = await Promise.all([asr.load(this.settings.spec()), vad.load()]);

      this.asr = asr;
      this.vad = vad;
      this.loadedKey = key;
      this.device.set(model.device);
      this.loadMs.set(model.elapsedMs);
      return { asr, vad };
    } finally {
      this.loading.set(false);
      this.download.set(null);
    }
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
