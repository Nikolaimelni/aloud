import { computed, inject, Injectable, signal } from '@angular/core';
import { microphone, tabAudio } from '@aloud/core/audio/capture';
import { Recorder } from '@aloud/core/audio/recorder';
import { tapFrames } from '@aloud/core/audio/tap';
import { WavSource } from '@aloud/core/audio/wav-source';
import { AloudError } from '@aloud/core/errors';
import { StreamingTranscriber } from '@aloud/core/stream/pipeline';
import { textOf, type Word } from '@aloud/core/stream/stabilize';
import { toMarkdown, toSegments } from '@aloud/core/stream/transcript';
import type { AudioFrame, AudioSource } from '@aloud/core/audio/source';
import { ModelSettings } from '../model/model-settings';
import { ModelHost } from '../model/model-host';

export type SourceKind = 'microphone' | 'tab' | 'file';
export type SessionPhase = 'idle' | 'loading' | 'listening' | 'error';

const WORKLET_URL = 'worklets/capture.js';
/** Enough level readings for about three seconds of meter. */
const LEVELS = 140;

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly settings = inject(ModelSettings);
  private readonly host = inject(ModelHost);

  private transcriber: StreamingTranscriber | null = null;
  private recorder = new Recorder();
  private levelHistory: number[] = [];
  private computeMs = 0;
  private startedAt = new Date();

  readonly source = signal<SourceKind>('microphone');
  readonly phase = signal<SessionPhase>('idle');
  readonly error = signal<string | null>(null);

  readonly words = signal<readonly Word[]>([]);
  readonly pending = signal('');
  readonly query = signal('');

  readonly levels = signal<readonly number[]>([]);
  readonly passes = signal(0);
  readonly lastPassMs = signal(0);
  readonly backlog = signal(0);
  readonly lag = signal(0);
  readonly heard = signal(0);

  readonly translate = signal(false);
  readonly windowStep = signal(1.5);
  readonly fasterThanReal = signal(true);

  /** Object URL of the recording, once there is one to play. */
  readonly recording = signal<string | null>(null);

  readonly segments = computed(() => toSegments(this.words()));

  /** Seconds of compute per second of audio. Over 1 and it is losing ground. */
  readonly realTimeFactor = computed(() => {
    const heard = this.heard();
    return heard > 0 ? this.computeMs / 1000 / heard : null;
  });

  readonly listening = computed(() => this.phase() === 'listening' || this.phase() === 'loading');

  readonly matches = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return this.segments();
    return this.segments().filter((segment) => segment.text.toLowerCase().includes(needle));
  });

  async start(file?: File): Promise<void> {
    if (this.listening()) return;

    this.error.set(null);
    this.words.set([]);
    this.pending.set('');
    this.levelHistory = [];
    this.levels.set([]);
    this.passes.set(0);
    this.heard.set(0);
    this.computeMs = 0;
    this.startedAt = new Date();
    this.recorder = new Recorder();
    this.releaseRecording();

    try {
      this.phase.set('loading');
      const { asr, vad } = await this.host.ready();
      const source = tapFrames(await this.open(file), (frame) => this.observe(frame));

      const language = this.settings.language().trim();
      const transcriber = new StreamingTranscriber(source, vad, asr, {
        chunker: { stepSeconds: this.windowStep() },
        transcribe: {
          task: this.translate() ? 'translate' : 'transcribe',
          ...(language ? { language } : {}),
        },
        onUpdate: (update) => {
          this.words.set(update.confirmed);
          this.pending.set(textOf(update.pending));
          this.passes.set(update.passes);
          this.lastPassMs.set(update.lastPassMs);
          this.backlog.set(update.backlogSeconds);
          this.lag.set(update.confirmedLagSeconds);
          this.heard.set(update.heardSeconds);
          this.computeMs += update.lastPassMs;
        },
        onError: (cause) => this.error.set(explain(cause)),
      });
      this.transcriber = transcriber;

      await transcriber.start();
      this.phase.set('listening');

      await transcriber.finished;
      this.finish();
    } catch (cause) {
      this.error.set(explain(cause));
      this.phase.set('error');
    }
  }

  async stop(): Promise<void> {
    const transcriber = this.transcriber;
    this.transcriber = null;
    await transcriber?.stop();
    this.finish();
  }

  markdown(): string {
    return toMarkdown(this.segments(), {
      title: 'Aloud transcript',
      recordedAt: this.startedAt,
      translated: this.translate(),
      ...(this.settings.language().trim() ? { language: this.settings.language().trim() } : {}),
    });
  }

  filename(): string {
    return `aloud-${this.startedAt.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`;
  }

  private finish(): void {
    if (this.phase() === 'listening' || this.phase() === 'loading') {
      this.phase.set('idle');
    }
    if (this.recorder.seconds > 0) {
      this.recording.set(URL.createObjectURL(this.recorder.toWav()));
    }
  }

  private releaseRecording(): void {
    const url = this.recording();
    if (url) URL.revokeObjectURL(url);
    this.recording.set(null);
  }

  private async open(file?: File): Promise<AudioSource> {
    switch (this.source()) {
      case 'microphone':
        return microphone(WORKLET_URL);
      case 'tab':
        return tabAudio(WORKLET_URL);
      case 'file': {
        if (!file) {
          throw new AloudError('capture-failed', 'pick a file first');
        }
        return new WavSource({
          data: await file.arrayBuffer(),
          speed: this.fasterThanReal() ? Infinity : 1,
        });
      }
    }
  }

  private observe(frame: AudioFrame): void {
    this.recorder.push(frame.samples);

    this.levelHistory.push(level(frame.samples));
    if (this.levelHistory.length > LEVELS) {
      this.levelHistory = this.levelHistory.slice(-LEVELS);
    }
    this.levels.set([...this.levelHistory]);
  }
}

/** RMS mapped onto -60..0 dBFS, because a linear meter reads as dead below half volume. */
function level(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  const db = 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-6));
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

function explain(cause: unknown): string {
  if (cause instanceof AloudError) {
    switch (cause.code) {
      case 'capture-denied':
        return 'The browser refused the capture. It only asks once, so you may have to reset the permission yourself.';
      case 'invalid-wav':
      case 'unsupported-wav-format':
        return 'That file is not a WAV this build can read.';
      default:
        return cause.message;
    }
  }
  return cause instanceof Error ? cause.message : 'Something failed without saying what.';
}
