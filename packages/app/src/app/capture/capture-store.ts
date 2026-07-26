import { Injectable, signal } from '@angular/core';
import { MicSource } from '@aloud/core/audio/mic-source';
import { AloudError } from '@aloud/core/errors';
import { TARGET_SAMPLE_RATE, type AudioFrame } from '@aloud/core/audio/source';

export type CaptureState = 'idle' | 'starting' | 'running' | 'error';

/** How many level readings the meter keeps. At ~47 frames a second, about three. */
const HISTORY = 140;

@Injectable({ providedIn: 'root' })
export class CaptureStore {
  private source: MicSource | null = null;
  private levels: number[] = [];

  readonly state = signal<CaptureState>('idle');
  readonly error = signal<string | null>(null);
  readonly history = signal<readonly number[]>([]);
  readonly elapsed = signal(0);
  readonly deviceRate = signal<number | null>(null);

  async toggle(): Promise<void> {
    if (this.state() === 'running') {
      await this.stop();
    } else {
      await this.start();
    }
  }

  status(): string {
    const rate = this.deviceRate();
    if (this.state() !== 'running' || rate === null) {
      return 'idle';
    }
    return `${khz(rate)} → ${khz(TARGET_SAMPLE_RATE)} · ${clock(this.elapsed())}`;
  }

  private async start(): Promise<void> {
    this.state.set('starting');
    this.error.set(null);
    this.levels = [];
    this.history.set([]);

    const source = new MicSource({ workletUrl: 'worklets/capture.js' });
    try {
      await source.start((frame) => this.onFrame(frame));
    } catch (cause) {
      this.state.set('error');
      this.error.set(describe(cause));
      return;
    }

    this.source = source;
    this.deviceRate.set(source.deviceSampleRate);
    this.state.set('running');
  }

  private async stop(): Promise<void> {
    const source = this.source;
    this.source = null;
    this.state.set('idle');
    await source?.stop();
  }

  private onFrame(frame: AudioFrame): void {
    this.levels.push(level(frame.samples));
    if (this.levels.length > HISTORY) {
      this.levels = this.levels.slice(-HISTORY);
    }
    this.history.set([...this.levels]);
    this.elapsed.set(frame.time);
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

function khz(rate: number): string {
  return `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz`;
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function describe(cause: unknown): string {
  if (cause instanceof AloudError && cause.code === 'capture-denied') {
    return 'Microphone access was refused. The browser has to ask you, and it only asks once.';
  }
  return cause instanceof Error ? cause.message : 'Capture failed for an unknown reason.';
}
