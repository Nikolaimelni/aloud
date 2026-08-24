import { Injectable, signal } from '@angular/core';
import type { AsrDevice, AsrModelSpec, AsrPrecision } from '@aloud/core/asr/protocol';
import { looksLikeAPhone } from './device-class';

/**
 * The `_timestamped` exports carry cross-attentions, which is the only way to get a time per
 * word rather than per phrase. The streaming stabiliser needs word times to know how much
 * audio it can stop carrying, so both panels use the same variant.
 */
export const MODELS = [
  'onnx-community/whisper-tiny_timestamped',
  'onnx-community/whisper-base_timestamped',
  'onnx-community/whisper-small_timestamped',
] as const;

export const PRECISIONS = ['auto', 'fp32', 'fp16', 'q8', 'q4'] as const;

/** Megabytes at q4, measured from the repos. The quantised decoder is most of it, which is
 * why tiny is not the saving it sounds like. */
export const MODEL_SIZE_MB: Record<string, number> = {
  'onnx-community/whisper-tiny_timestamped': 96,
  'onnx-community/whisper-base_timestamped': 143,
  'onnx-community/whisper-small_timestamped': 300,
};

/** Shared by both panels, so the controls sit in one place and mean one thing. */
@Injectable({ providedIn: 'root' })
export class ModelSettings {
  /**
   * A phone gets the small model by default. iOS kills a tab that asks for too much memory
   * without saying why, and three hundred megabytes over a mobile connection is rude besides.
   */
  readonly model = signal<string>(
    looksLikeAPhone()
      ? 'onnx-community/whisper-tiny_timestamped'
      : 'onnx-community/whisper-base_timestamped',
  );
  readonly device = signal<AsrDevice | 'auto'>('auto');
  readonly precision = signal<AsrPrecision | 'auto'>('auto');
  readonly language = signal('');

  /** Changes to this mean the worker has to load a different model. */
  key(): string {
    return `${this.model()}|${this.device()}|${this.precision()}`;
  }

  spec(): AsrModelSpec {
    const precision = this.precision();
    return {
      model: this.model(),
      device: this.device(),
      ...(precision === 'auto' ? {} : { dtype: precision }),
    };
  }
}
