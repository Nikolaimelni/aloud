import { computed, inject, Injectable, signal } from '@angular/core';
import type { AsrDevice, ModelProgress } from '@aloud/core/asr/protocol';
import type { AsrClient } from '@aloud/core/asr/worker-client';
import { loadEngines } from '@aloud/core/engines';
import type { VadClient } from '@aloud/core/vad/worker-client';
import { ModelSettings } from './model-settings';

export type Loaded = {
  readonly asr: AsrClient;
  readonly vad: VadClient;
};

/**
 * onnxruntime's wasm, copied out of node_modules by the build (see angular.json) so no code
 * runs from a CDN at run time. Absolute, because the workers resolve it, not the page.
 */
const RUNTIME_URL = new URL('ort/', document.baseURI).href;

/** Owns the two workers so a session does not load the same weights twice. */
@Injectable({ providedIn: 'root' })
export class ModelHost {
  private readonly settings = inject(ModelSettings);
  private readonly downloads = new Map<string, ModelProgress>();

  private loaded: Loaded | null = null;
  private pending: { readonly key: string; readonly loaded: Promise<Loaded> } | null = null;
  private readonly loadedKey = signal<string | null>(null);

  readonly loading = signal(false);
  readonly download = signal<{ loaded: number; total: number } | null>(null);
  readonly device = signal<AsrDevice | null>(null);
  readonly loadMs = signal(0);

  /** False until the weights for the current settings are in the browser. */
  readonly hasWeights = computed(() => this.loadedKey() === this.settings.key());

  /** Whatever is loaded now, without swapping in the model the settings have moved on to. */
  current(): Loaded | null {
    return this.loaded;
  }

  /**
   * The workers for the current settings, one load at a time. A second caller for the same
   * model shares the download; one for a different model waits for it, then replaces it.
   */
  async ready(): Promise<Loaded> {
    const key = this.settings.key();
    if (this.loaded && this.loadedKey() === key) {
      return this.loaded;
    }

    const pending = this.pending;
    if (pending) {
      if (pending.key === key) return pending.loaded;
      await pending.loaded.catch(() => undefined);
      return this.ready();
    }

    const loaded = this.load(key);
    this.pending = { key, loaded };
    try {
      return await loaded;
    } finally {
      this.pending = null;
    }
  }

  private async load(key: string): Promise<Loaded> {
    this.loaded?.asr.dispose();
    this.loaded?.vad.dispose();
    this.loaded = null;
    this.loadedKey.set(null);
    this.downloads.clear();
    this.download.set(null);
    this.loading.set(true);

    try {
      const engines = await loadEngines({
        asrWorker: () =>
          new Worker(new URL('../asr/asr.worker', import.meta.url), { type: 'module' }),
        vadWorker: () =>
          new Worker(new URL('../vad/vad.worker', import.meta.url), { type: 'module' }),
        spec: this.settings.spec(),
        runtimeUrl: RUNTIME_URL,
        onProgress: (progress) => this.track(progress),
      });

      this.loaded = { asr: engines.asr, vad: engines.vad };
      this.loadedKey.set(key);
      this.device.set(engines.device);
      this.loadMs.set(engines.elapsedMs);
      return this.loaded;
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
