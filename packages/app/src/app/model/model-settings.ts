import { Injectable, signal } from '@angular/core';
import { MODELS, type ModelSize } from '@aloud/core/asr/models';
import type { AsrModelSpec, AsrPrecision } from '@aloud/core/asr/protocol';

export const PRECISIONS = ['auto', 'fp32', 'fp16', 'q8', 'q4'] as const;

/** The controls that decide which model the worker loads. */
@Injectable({ providedIn: 'root' })
export class ModelSettings {
  /** tiny for everyone. At 32 MB a phone does not need to wait for wi-fi. */
  readonly model = signal<ModelSize>('tiny');
  readonly precision = signal<AsrPrecision | 'auto'>('auto');

  /** Changes to this mean the worker has to load a different model. */
  key(): string {
    return `${this.model()}|${this.precision()}`;
  }

  spec(): AsrModelSpec {
    const { id, revision } = MODELS[this.model()];
    const precision = this.precision();
    return {
      model: id,
      revision,
      // WASM only. The WebGPU builds of onnxruntime need eval and outgrow the host's file limit,
      // and q8 tiny runs at a fourteenth of real time on the CPU anyway.
      device: 'wasm',
      ...(precision === 'auto' ? {} : { dtype: precision }),
    };
  }
}
