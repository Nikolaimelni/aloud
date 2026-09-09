import { computed, inject, Injectable, signal } from '@angular/core';
import { WHISPER_MODELS } from '@aloud/core/asr/models';
import { microphone, tabAudio, type MediaCapture } from '@aloud/core/audio/capture';
import { levelOf } from '@aloud/core/audio/level';
import { Recorder } from '@aloud/core/audio/recorder';
import { tapFrames } from '@aloud/core/audio/tap';
import { WavSource } from '@aloud/core/audio/wav-source';
import { AloudError } from '@aloud/core/errors';
import { StreamingTranscriber } from '@aloud/core/stream/pipeline';
import { textOf } from '@aloud/core/stream/stabilize';
import { localStamp, toMarkdown, toSegments, type Segment } from '@aloud/core/stream/transcript';
import { pickKeyLines } from '@aloud/core/summary/select';
import type { AudioFrame, AudioSource } from '@aloud/core/audio/source';
import { Archive } from '../history/archive';
import { ModelSettings } from '../model/model-settings';
import { ModelHost } from '../model/model-host';

export type SourceKind = 'microphone' | 'tab' | 'file';
export type SessionPhase = 'idle' | 'loading' | 'listening' | 'error';

const WORKLET_URL = 'worklets/capture.js';
/** Seconds of unprocessed audio that mean the model is losing the race rather than breathing. */
const BEHIND_SECONDS = 3;
/** Enough level readings for about three seconds of meter. */
const LEVELS = 140;

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly settings = inject(ModelSettings);
  private readonly host = inject(ModelHost);
  private readonly archive = inject(Archive);

  private transcriber: StreamingTranscriber | null = null;
  private capture: MediaCapture | null = null;
  private recorder = new Recorder();
  private levelHistory: number[] = [];
  private startedAt = new Date();
  private sessionId: string = crypto.randomUUID();
  /** What the session on screen was made with. The controls may have moved on since. */
  private sessionLanguage = '';
  private sessionTranslated = false;
  /**
   * Bumped whenever the session on screen is stopped or replaced. Anything that awaited across
   * a bump, a model download or a summary, compares it and drops what it was about to do.
   */
  private generation = 0;
  private readonly computeMs = signal(0);

  readonly source = signal<SourceKind>('microphone');
  readonly phase = signal<SessionPhase>('idle');
  readonly error = signal<string | null>(null);

  readonly segments = signal<readonly Segment[]>([]);
  readonly pending = signal('');
  readonly query = signal('');

  readonly levels = signal<readonly number[]>([]);
  readonly passes = signal(0);
  readonly backlog = signal(0);
  readonly lag = signal(0);
  readonly heard = signal(0);

  /** The browser suspended the audio graph, which on a phone means the tab went away. */
  readonly paused = signal(false);

  readonly translate = signal(false);
  readonly windowStep = signal(1.5);
  readonly fasterThanReal = signal(true);

  /** Object URL of the recording, once there is one to play. */
  readonly recording = signal<string | null>(null);

  readonly summary = signal<readonly Segment[]>([]);
  readonly summarising = signal(false);
  /** The embedding model downloads on first use, so the button says so until it has. */
  readonly summaryLoaded = signal(false);

  /** Seconds of compute per second of audio. Over 1 and it is losing ground. */
  readonly realTimeFactor = computed(() => {
    const heard = this.heard();
    return heard > 0 ? this.computeMs() / 1000 / heard : null;
  });

  readonly listening = computed(() => this.phase() === 'listening' || this.phase() === 'loading');

  /**
   * Audio arriving faster than the model clears it. Only meaningful live: a file is throttled
   * on purpose and sits at the back-pressure limit by design, which is not the same thing.
   */
  readonly fallingBehind = computed(
    () =>
      this.phase() === 'listening' && this.source() !== 'file' && this.backlog() > BEHIND_SECONDS,
  );

  readonly matches = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return this.segments();
    return this.segments().filter((segment) => segment.text.toLowerCase().includes(needle));
  });

  constructor() {
    // Coming back to the tab should pick the graph up again rather than need a second tap.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.capture?.resume();
    });
  }

  async start(file?: File): Promise<void> {
    if (this.listening()) return;

    // Checked before anything is cleared, so a typo does not cost the transcript on screen.
    const language = this.settings.languageCode();
    if (language === null) {
      this.error.set(
        `Whisper does not know "${this.settings.language().trim()}". Leave the language empty to let it guess, or give a code such as ru or a name such as russian.`,
      );
      return;
    }

    const generation = ++this.generation;
    this.error.set(null);
    this.segments.set([]);
    this.summary.set([]);
    this.pending.set('');
    this.levelHistory = [];
    this.levels.set([]);
    this.passes.set(0);
    this.heard.set(0);
    this.computeMs.set(0);
    this.startedAt = new Date();
    this.sessionId = crypto.randomUUID();
    this.sessionLanguage = language;
    this.sessionTranslated = this.translate();
    this.recorder = new Recorder();
    this.paused.set(false);
    this.releaseRecording();

    try {
      this.phase.set('loading');
      const { asr, vad } = await this.host.ready();
      if (generation !== this.generation) return;

      const source = tapFrames(await this.open(file), (frame) => this.observe(frame));
      if (generation !== this.generation) return;

      const transcriber = new StreamingTranscriber(source, vad, asr, {
        chunker: { stepSeconds: this.windowStep() },
        transcribe: {
          task: this.sessionTranslated ? 'translate' : 'transcribe',
          ...(this.sessionLanguage ? { language: this.sessionLanguage } : {}),
        },
        onUpdate: (update) => {
          this.segments.set(toSegments(update.confirmed));
          this.pending.set(textOf(update.pending));
          this.passes.set(update.passes);
          this.backlog.set(update.backlogSeconds);
          this.lag.set(update.confirmedLagSeconds);
          this.heard.set(update.heardSeconds);
          this.computeMs.set(update.computeMs);
        },
        onError: (cause) => this.error.set(explain(cause)),
      });
      this.transcriber = transcriber;

      await transcriber.start();
      if (generation === this.generation) this.phase.set('listening');

      // Stop only ends the stream. Saving it happens here, once, whichever way it ended.
      await transcriber.finished;
      await this.finish();
    } catch (cause) {
      this.error.set(explain(cause));
      this.phase.set('error');
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    const transcriber = this.transcriber;
    this.transcriber = null;

    if (transcriber) {
      await transcriber.stop();
    } else if (this.phase() === 'loading') {
      // Still waiting for the model. start() sees the bump when the download lands.
      this.phase.set('idle');
    }
  }

  /** Bring a session back from storage, transcript and recording both. */
  async reopen(id: string): Promise<void> {
    if (this.listening()) return;

    const generation = ++this.generation;
    const saved = await this.archive.load(id);
    if (!saved || generation !== this.generation) return;

    this.releaseRecording();
    this.segments.set(saved.segments);
    this.summary.set([]);
    this.pending.set('');
    this.query.set('');
    this.startedAt = new Date(saved.startedAt);
    this.sessionId = saved.id;
    this.sessionLanguage = saved.language;
    this.sessionTranslated = saved.translated;
    this.passes.set(0);
    if (saved.audio) {
      this.recording.set(URL.createObjectURL(saved.audio));
    }
  }

  /** Pick the lines that carry the session, by sentence embedding rather than by a second model. */
  async summarise(): Promise<void> {
    const segments = this.segments();
    if (segments.length === 0 || this.summarising()) return;

    const generation = this.generation;
    this.summarising.set(true);
    try {
      // Whichever Whisper is loaded will do: the embedder only needs its worker. Going through
      // ready() after the model picker changed would download a new Whisper first.
      const { asr } = this.host.current() ?? (await this.host.ready());
      const vectors = await asr.embed(segments.map((segment) => segment.text));
      if (generation !== this.generation) return;

      const picked = pickKeyLines(
        segments.map((segment) => segment.text),
        vectors,
      );
      this.summary.set(picked.map((index) => segments[index]!));
      this.summaryLoaded.set(true);
    } catch (cause) {
      this.error.set(explain(cause));
    } finally {
      this.summarising.set(false);
    }
  }

  markdown(): string {
    return toMarkdown(this.segments(), {
      title: 'Aloud transcript',
      recordedAt: this.startedAt,
      translated: this.sessionTranslated,
      highlights: this.summary(),
      ...(this.sessionLanguage ? { language: this.sessionLanguage } : {}),
    });
  }

  filename(): string {
    const { date, time } = localStamp(this.startedAt);
    return `aloud-${date}-${time.replace(':', '-')}.md`;
  }

  private async finish(): Promise<void> {
    if (this.phase() === 'listening' || this.phase() === 'loading') {
      this.phase.set('idle');
    }
    if (this.recorder.seconds === 0) return;

    const audio = this.recorder.toWav();
    this.recording.set(URL.createObjectURL(audio));

    if (this.segments().length === 0) return;

    await this.archive.save(
      {
        id: this.sessionId,
        startedAt: this.startedAt.getTime(),
        seconds: this.recorder.seconds,
        bytes: audio.size,
        translated: this.sessionTranslated,
        language: this.sessionLanguage,
        model: WHISPER_MODELS[this.settings.model()].id,
        segments: [...this.segments()],
      },
      audio,
    );
  }

  private releaseRecording(): void {
    const url = this.recording();
    if (url) URL.revokeObjectURL(url);
    this.recording.set(null);
  }

  private async open(file?: File): Promise<AudioSource> {
    const onRunningChange = (running: boolean) => this.paused.set(!running);

    switch (this.source()) {
      case 'microphone':
        this.capture = microphone(WORKLET_URL, { onRunningChange });
        return this.capture;
      case 'tab':
        this.capture = tabAudio(WORKLET_URL, { onRunningChange });
        return this.capture;
      case 'file': {
        this.capture = null;
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

    this.levelHistory.push(levelOf(frame.samples));
    if (this.levelHistory.length > LEVELS) {
      this.levelHistory = this.levelHistory.slice(-LEVELS);
    }
    this.levels.set([...this.levelHistory]);
  }
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
