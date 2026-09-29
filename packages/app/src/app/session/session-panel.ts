import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LANGUAGE_NAMES } from '@aloud/core/asr/languages';
import {
  isWhisperSize,
  WHISPER_MODELS,
  WHISPER_SIZES,
  type WhisperSize,
} from '@aloud/core/asr/models';
import { clock } from '@aloud/core/stream/transcript';
import { EMBEDDING_SIZE_MB } from '@aloud/core/summary/model';
import { LevelMeter } from '../capture/level-meter';
import { ModelSettings, PRECISIONS } from '../model/model-settings';
import { ModelHost } from '../model/model-host';
import { SessionStore, type SourceKind } from './session-store';
import { TranscriptView } from './transcript-view';

type SourceOption = {
  readonly kind: SourceKind;
  readonly label: string;
  readonly about: string;
};

const SOURCES: readonly SourceOption[] = [
  {
    kind: 'microphone',
    label: 'Microphone',
    about: 'Whatever the browser hears. Speak and the text follows a few seconds behind.',
  },
  {
    kind: 'tab',
    label: 'Another tab',
    about:
      'Pick a tab in the share dialog and tick "share tab audio". This is the one that works on a real call.',
  },
  {
    kind: 'file',
    label: 'A file',
    about: 'A WAV pushed through the same pipeline, optionally faster than it was recorded.',
  },
];

/** Seconds. A typed value gets past an input's min and max, so setStep clamps to these too. */
const STEP_RANGE = { min: 0.5, max: 10 } as const;

@Component({
  selector: 'aloud-session',
  imports: [LevelMeter, TranscriptView],
  templateUrl: './session-panel.html',
  styleUrl: './session-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionPanel {
  protected readonly store = inject(SessionStore);
  protected readonly host = inject(ModelHost);
  protected readonly settings = inject(ModelSettings);

  protected readonly sources = SOURCES;
  protected readonly sizes = WHISPER_SIZES;
  protected readonly precisions = PRECISIONS;
  protected readonly stepRange = STEP_RANGE;
  protected readonly languageNames = LANGUAGE_NAMES;
  protected readonly playhead = signal(0);

  private readonly player = viewChild<ElementRef<HTMLAudioElement>>('player');

  protected readonly about = computed(
    () => SOURCES.find((source) => source.kind === this.store.source())?.about ?? '',
  );

  protected readonly sizeMb = computed(() => this.sizeOf(this.settings.model()));

  protected readonly startLabel = computed(() =>
    this.host.hasWeights() ? 'Start listening' : `Download ${this.sizeMb()} MB and start`,
  );

  protected sizeOf(size: WhisperSize): number {
    return WHISPER_MODELS[size].sizeMb;
  }

  protected readonly placeholder = computed(() =>
    this.store.listening() ? 'Listening.' : 'Nothing yet.',
  );

  protected readonly summariseLabel = computed(() =>
    this.store.summaryLoaded() ? 'Summarise' : `Summarise (${EMBEDDING_SIZE_MB} MB)`,
  );

  protected readonly done = computed(
    () => !this.store.listening() && this.store.segments().length > 0,
  );

  protected choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void this.store.start(file);
  }

  protected pickSource(kind: SourceKind): void {
    this.store.source.set(kind);
  }

  protected seekTo(seconds: number): void {
    const audio = this.player()?.nativeElement;
    if (!audio) return;
    audio.currentTime = seconds;
    void audio.play();
  }

  protected trackPlayhead(): void {
    this.playhead.set(this.player()?.nativeElement.currentTime ?? 0);
  }

  protected download(): void {
    const blob = new Blob([this.store.markdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.store.filename();
    link.click();
    URL.revokeObjectURL(url);
  }

  protected setQuery(event: Event): void {
    this.store.query.set(value(event));
  }

  protected setTranslate(event: Event): void {
    this.store.translate.set((event.target as HTMLInputElement).checked);
  }

  protected setModel(event: Event): void {
    const chosen = value(event);
    if (isWhisperSize(chosen)) this.settings.model.set(chosen);
  }

  protected setLanguage(event: Event): void {
    this.settings.language.set(value(event));
  }

  protected setDevice(event: Event): void {
    const chosen = value(event);
    if (chosen === 'auto' || chosen === 'webgpu' || chosen === 'wasm') {
      this.settings.device.set(chosen);
    }
  }

  protected setPrecision(event: Event): void {
    for (const precision of PRECISIONS) {
      if (precision === value(event)) this.settings.precision.set(precision);
    }
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

  protected setSpeed(event: Event): void {
    this.store.fasterThanReal.set((event.target as HTMLInputElement).checked);
  }

  protected stamp(at: number): string {
    return clock(at);
  }

  protected megabytes(bytes: number): string {
    return (bytes / 1_000_000).toFixed(0);
  }

  protected seconds(value: number): string {
    return value.toFixed(1);
  }

  protected factor(value: number | null): string {
    return value === null ? '-' : `${value.toFixed(2)}x`;
  }
}

function value(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
