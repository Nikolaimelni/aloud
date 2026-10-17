import { effect, inject, Injectable, signal } from '@angular/core';
import { MODEL_CACHE } from '@aloud/core/fetching';
import { SessionStore } from '../session/session-store';
import { ModelHost } from './model-host';
import { ModelSettings } from './model-settings';

export type Stored = {
  readonly bytes: number;
  /** URL paths of the cached files, `/<repo>/resolve/<commit>/<file>`. */
  readonly paths: ReadonlySet<string>;
};

const NOTHING: Stored = { bytes: 0, paths: new Set() };

/** What the downloaded models take up on this device, and the way to give it back. */
@Injectable({ providedIn: 'root' })
export class ModelStorage {
  private readonly host = inject(ModelHost);
  private readonly settings = inject(ModelSettings);
  private readonly session = inject(SessionStore);
  private measuring = 0;

  /** Null until the first measurement is in. */
  readonly stored = signal<Stored | null>(null);

  constructor() {
    // With keep off nothing is written, but a download that started before it was switched off
    // still finishes into the cache. This is where that copy goes.
    if (!this.settings.keepModels()) void this.empty().catch(() => undefined);

    // A model landing and a summary finishing can both add files.
    effect(() => {
      if (!this.host.loading() && !this.session.summarising()) void this.measure();
    });
  }

  /**
   * Whether all of these files from that commit are cached. A download cut short stores
   * nothing for the file it was on, so a file that is there is whole.
   */
  holds(repo: string, revision: string, files: readonly string[]): boolean {
    const paths = this.stored()?.paths;
    return !!paths && files.every((file) => paths.has(`/${repo}/resolve/${revision}/${file}`));
  }

  async remove(): Promise<void> {
    this.host.forget();
    this.session.summaryLoaded.set(false);
    await this.empty();
  }

  async setKeep(keep: boolean): Promise<void> {
    this.settings.setKeepModels(keep);
    if (!keep) await this.empty();
  }

  private async empty(): Promise<void> {
    if (!('caches' in globalThis)) return;
    await caches.delete(MODEL_CACHE);
    await this.measure();
  }

  private async measure(): Promise<void> {
    // Measurements overlap when a removal lands mid-count, and only the newest may be shown.
    const run = ++this.measuring;

    try {
      // open() would create the cache just to find it empty.
      if (!('caches' in globalThis) || !(await caches.has(MODEL_CACHE))) {
        if (run === this.measuring) this.stored.set(NOTHING);
        return;
      }

      const cache = await caches.open(MODEL_CACHE);
      let bytes = 0;
      const paths = new Set<string>();
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        bytes += Number(response.headers.get('content-length')) || (await response.blob()).size;
        paths.add(new URL(request.url).pathname);
      }
      if (run === this.measuring) this.stored.set({ bytes, paths });
    } catch {
      // Some private windows refuse Cache Storage outright, and then nothing can be in it.
      if (run === this.measuring) this.stored.set(NOTHING);
    }
  }
}
