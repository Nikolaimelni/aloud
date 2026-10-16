import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MODELS } from '@aloud/core/asr/models';
import { clock } from '@aloud/core/stream/transcript';
import { EMBEDDING_SIZE_MB } from '@aloud/core/summary/model';
import { LevelMeter } from '../capture/level-meter';
import { ModelHost } from '../model/model-host';
import { ModelSettings } from '../model/model-settings';
import { ModelStorage } from '../model/model-storage';
import { RecordingPlayer } from './recording-player';
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
    about:
      'Whatever this device hears. Talk, pause, and each line settles a moment after you stop.',
  },
  {
    kind: 'tab',
    label: 'Another tab',
    about:
      'A call or a video playing in another tab. Pick that tab in the share dialog and leave "Share tab audio" on.',
  },
  {
    kind: 'file',
    label: 'A file',
    about: 'A WAV recording up to 500 MB, read through the same steps as live audio.',
  },
];

@Component({
  selector: 'aloud-session',
  imports: [LevelMeter, RecordingPlayer, TranscriptView],
  templateUrl: './session-panel.html',
  styleUrl: './session-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionPanel {
  protected readonly store = inject(SessionStore);
  protected readonly host = inject(ModelHost);
  private readonly settings = inject(ModelSettings);
  private readonly storage = inject(ModelStorage);

  protected readonly sources = SOURCES;
  protected readonly clock = clock;
  protected readonly playhead = signal(0);

  private readonly player = viewChild(RecordingPlayer);

  protected readonly about = computed(
    () => SOURCES.find((source) => source.kind === this.store.source())?.about ?? '',
  );

  protected readonly headline = computed(() => {
    if (this.host.loading()) {
      return this.host.download() ? 'Downloading the model' : 'Starting the model';
    }
    if (this.store.paused()) return 'Paused';
    if (this.store.listening()) {
      if (this.store.source() !== 'file') return 'Listening';
      return this.store.fasterThanReal() ? 'Reading the file' : 'Playing the file';
    }
    return this.store.source() === 'file' ? 'Choose a recording' : 'Start listening';
  });

  protected readonly subline = computed(() => {
    const keep = this.settings.keepModels();
    const progress = this.host.download();
    if (progress) {
      const after = keep
        ? 'This happens once; the browser keeps it.'
        : 'Nothing is kept after this visit.';
      return `${megabytes(progress.loaded)} of ${megabytes(progress.total)} MB. ${after}`;
    }
    if (this.store.listening()) return `${clock(this.store.heard())} heard`;
    if (this.store.source() === 'file') return '';
    if (this.host.hasWeights()) return 'The model is loaded.';

    // Nothing rather than the wrong thing, for the moment it takes to look in the cache.
    const stored = this.storage.stored();
    if (!stored) return '';
    const { id, sizeMb } = MODELS[this.settings.model()];
    if (stored.repos.has(id)) return 'The model is on this device already.';
    return keep
      ? `The first start downloads ${sizeMb} MB, once.`
      : `Starting downloads ${sizeMb} MB, and nothing is kept after this visit.`;
  });

  /** One sentence on how it is coping. The four numbers behind it are a click away. */
  protected readonly pace = computed(() => {
    const store = this.store;
    if (store.passes() === 0) return '';
    if (store.fallingBehind()) {
      return `Falling behind: ${seconds(store.backlog())} s of speech is waiting to be read. The fast model keeps up more easily.`;
    }
    if (store.listening()) {
      return store.source() === 'file' && store.fasterThanReal()
        ? 'Reading as fast as this machine goes.'
        : `Keeping up. The last line settled ${seconds(store.lag())} s after it ended.`;
    }
    const lines = store.segments().length;
    return `${lines} ${lines === 1 ? 'line' : 'lines'} from ${clock(store.heard())} of audio.`;
  });

  protected readonly placeholder = computed(() => {
    if (this.store.listening()) return 'Listening. Lines appear here as they are said.';
    return this.store.source() === 'file'
      ? 'Lines from the recording will appear here.'
      : 'Press the red button and say something.';
  });

  protected readonly summariseLabel = computed(() =>
    this.store.summaryLoaded() ? 'Summarise' : `Summarise (${EMBEDDING_SIZE_MB} MB)`,
  );

  protected readonly done = computed(
    () => !this.store.listening() && this.store.segments().length > 0,
  );

  protected choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared so that picking the same file again still counts as a change.
    input.value = '';
    if (file) void this.store.start(file);
  }

  protected pickSource(kind: SourceKind): void {
    this.store.source.set(kind);
  }

  protected seekTo(seconds: number): void {
    this.player()?.seek(seconds);
  }

  protected download(): void {
    const blob = new Blob([this.store.markdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.store.filename();
    link.click();
    // Revoked on the next task: some browsers start reading the blob only after click() returns.
    setTimeout(() => URL.revokeObjectURL(url));
  }

  protected setQuery(event: Event): void {
    this.store.query.set((event.target as HTMLInputElement).value);
  }

  protected setSpeed(event: Event): void {
    this.store.fasterThanReal.set((event.target as HTMLInputElement).checked);
  }

  protected seconds(value: number): string {
    return seconds(value);
  }

  protected factor(value: number | null): string {
    return value === null ? '-' : `${value.toFixed(2)}x`;
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(0);
}

function seconds(value: number): string {
  return value.toFixed(1);
}
