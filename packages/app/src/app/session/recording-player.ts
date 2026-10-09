import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { clock } from '@aloud/core/stream/transcript';

/** The browser's own audio controls, redrawn to sit on the page instead of on top of it. */
@Component({
  selector: 'aloud-player',
  templateUrl: './recording-player.html',
  styleUrl: './recording-player.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingPlayer {
  readonly src = input.required<string>();
  readonly position = output<number>();

  protected readonly playing = signal(false);
  protected readonly at = signal(0);
  protected readonly length = signal(0);
  protected readonly clock = clock;

  private readonly audio = viewChild.required<ElementRef<HTMLAudioElement>>('audio');

  /** Jump there and play, which is what clicking a time in the transcript means. */
  seek(seconds: number): void {
    const audio = this.audio().nativeElement;
    audio.currentTime = seconds;
    void audio.play();
  }

  protected toggle(): void {
    const audio = this.audio().nativeElement;
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  protected scrub(event: Event): void {
    this.audio().nativeElement.currentTime = Number((event.target as HTMLInputElement).value);
  }

  protected tick(): void {
    const at = this.audio().nativeElement.currentTime;
    this.at.set(at);
    this.position.emit(at);
  }

  protected loaded(): void {
    this.length.set(this.audio().nativeElement.duration || 0);
  }
}
