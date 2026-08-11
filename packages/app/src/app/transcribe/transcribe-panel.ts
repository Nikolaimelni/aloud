import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MODELS, ModelSettings, PRECISIONS } from '../model/model-settings';
import { TranscribeStore } from './transcribe-store';

@Component({
  selector: 'aloud-transcribe-panel',
  templateUrl: './transcribe-panel.html',
  styleUrl: './transcribe-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranscribePanel {
  protected readonly store = inject(TranscribeStore);
  protected readonly settings = inject(ModelSettings);
  protected readonly models = MODELS;
  protected readonly precisions = PRECISIONS;

  protected choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void this.store.run(file);
  }

  protected setModel(event: Event): void {
    this.settings.model.set(value(event));
  }

  protected setLanguage(event: Event): void {
    this.settings.language.set(value(event));
  }

  protected setTranslate(event: Event): void {
    this.store.translate.set((event.target as HTMLInputElement).checked);
  }

  protected setPrecision(event: Event): void {
    const chosen = value(event);
    for (const precision of PRECISIONS) {
      if (precision === chosen) this.settings.precision.set(precision);
    }
  }

  protected setDevice(event: Event): void {
    const chosen = value(event);
    if (chosen === 'auto' || chosen === 'webgpu' || chosen === 'wasm') {
      this.settings.device.set(chosen);
    }
  }

  protected shortName(model: string): string {
    return model.split('/').pop() ?? model;
  }

  protected megabytes(bytes: number): string {
    return (bytes / 1_000_000).toFixed(0);
  }

  protected seconds(value: number): string {
    return value.toFixed(1);
  }

  protected stamp(at: number): string {
    const whole = Math.floor(at);
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }

  protected factor(value: number): string {
    return `${value.toFixed(2)}x`;
  }
}

function value(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
