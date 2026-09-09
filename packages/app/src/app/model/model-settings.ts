import { computed, Injectable, signal } from '@angular/core';
import { whisperLanguage } from '@aloud/core/asr/languages';
import { WHISPER_MODELS, type WhisperSize } from '@aloud/core/asr/models';
import type { AsrDevice, AsrModelSpec, AsrPrecision } from '@aloud/core/asr/protocol';
import { looksLikeAPhone } from './device-class';

export const PRECISIONS = ['auto', 'fp32', 'fp16', 'q8', 'q4'] as const;

/** The controls that decide which model the worker loads. */
@Injectable({ providedIn: 'root' })
export class ModelSettings {
  /**
   * A phone gets tiny by default. iOS kills a tab that asks for too much memory without
   * saying why, and three hundred megabytes over a mobile connection is rude besides.
   */
  readonly model = signal<WhisperSize>(looksLikeAPhone() ? 'tiny' : 'base');
  readonly device = signal<AsrDevice | 'auto'>('auto');
  readonly precision = signal<AsrPrecision | 'auto'>('auto');
  readonly language = signal('');
  /** What Whisper gets: a code, '' to let it guess, or null when it would refuse the input. */
  readonly languageCode = computed(() => whisperLanguage(this.language()));

  /** Changes to this mean the worker has to load a different model. */
  key(): string {
    return `${this.model()}|${this.device()}|${this.precision()}`;
  }

  spec(): AsrModelSpec {
    const { id, revision } = WHISPER_MODELS[this.model()];
    const precision = this.precision();
    return {
      model: id,
      revision,
      device: this.device(),
      ...(precision === 'auto' ? {} : { dtype: precision }),
    };
  }
}
