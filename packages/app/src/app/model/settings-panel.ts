import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MODELS, type ModelSize } from '@aloud/core/asr/models';
import { SessionStore } from '../session/session-store';
import { ModelSettings, PRECISIONS } from './model-settings';

type ModelOption = {
  readonly size: ModelSize;
  readonly name: string;
  readonly about: string;
  readonly sizeMb: number;
};

const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    size: 'tiny',
    name: 'Fast',
    about: 'Moonshine tiny. Fine for clear speech, and light enough for a phone.',
    sizeMb: MODELS.tiny.sizeMb,
  },
  {
    size: 'base',
    name: 'Accurate',
    about: 'Moonshine base. Misses less, and does about twice the work for it.',
    sizeMb: MODELS.base.sizeMb,
  },
];

/** Seconds. A typed value gets past an input's min and max, so setStep clamps to these too. */
const STEP_RANGE = { min: 0.5, max: 10 } as const;

@Component({
  selector: 'aloud-settings',
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPanel {
  protected readonly settings = inject(ModelSettings);
  protected readonly store = inject(SessionStore);

  protected readonly models = MODEL_OPTIONS;
  protected readonly precisions = PRECISIONS;
  protected readonly stepRange = STEP_RANGE;

  protected setPrecision(event: Event): void {
    const chosen = PRECISIONS.find((precision) => precision === value(event));
    if (chosen) this.settings.precision.set(chosen);
  }

  protected setStep(event: Event): void {
    const input = event.target as HTMLInputElement;
    const step = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(step)) {
      this.store.windowStep.set(Math.min(STEP_RANGE.max, Math.max(STEP_RANGE.min, step)));
    }
    // The binding only redraws on a change, so a clamp back to the same value would not show.
    input.value = String(this.store.windowStep());
  }
}

function value(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
