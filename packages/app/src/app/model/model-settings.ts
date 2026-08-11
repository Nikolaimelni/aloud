import { Injectable, signal } from '@angular/core';
import type { AsrDevice, AsrModelSpec, AsrPrecision } from '@aloud/core/asr/protocol';

export const MODELS = [
  'onnx-community/whisper-tiny',
  'onnx-community/whisper-base',
  'onnx-community/whisper-small',
] as const;

export const PRECISIONS = ['auto', 'fp32', 'fp16', 'q8', 'q4'] as const;

/** Shared by both panels, so the controls sit in one place and mean one thing. */
@Injectable({ providedIn: 'root' })
export class ModelSettings {
  readonly model = signal<string>('onnx-community/whisper-base');
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
