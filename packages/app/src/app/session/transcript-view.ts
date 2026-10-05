import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  clock,
  highlight,
  matcher,
  type Segment,
  type TextPart,
} from '@aloud/core/stream/transcript';

/** Close enough to the bottom that the reader clearly wants to follow along. */
const STICKY_PX = 24;

type Row = {
  readonly start: number;
  readonly stamp: string;
  readonly label: string;
  readonly parts: readonly TextPart[];
  readonly active: boolean;
};

@Component({
  selector: 'aloud-transcript',
  templateUrl: './transcript-view.html',
  styleUrl: './transcript-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranscriptView {
  readonly segments = input.required<readonly Segment[]>();
  readonly pending = input('');
  readonly query = input('');
  readonly playhead = input(0);
  readonly placeholder = input('');

  readonly seek = output<number>();

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private sticky = true;
  private announced = '';

  /**
   * Screen readers get the words that have just been confirmed and nothing else. Putting the
   * live region on the transcript itself would read the whole thing back on every pass, and
   * the guess would be read over and over as it gets rewritten.
   */
  protected readonly announcement = signal('');

  protected readonly rows = computed<Row[]>(() => {
    const needle = this.query().trim();
    const at = this.playhead();
    const matches = matcher(needle);

    return this.segments()
      .filter((segment) => matches(segment.text))
      .map((segment) => ({
        start: segment.start,
        stamp: clock(segment.start),
        label: `Play from ${clock(segment.start)}`,
        parts: highlight(segment.text, needle),
        active: at >= segment.start && at < segment.end,
      }));
  });

  constructor() {
    effect(() => {
      this.rows();
      this.pending();
      if (this.sticky) {
        queueMicrotask(() => this.toBottom());
      }
    });

    effect(() => {
      const settled = this.segments()
        .map((segment) => segment.text)
        .join(' ');
      const fresh = settled.startsWith(this.announced)
        ? settled.slice(this.announced.length).trim()
        : settled;

      this.announced = settled;
      if (fresh) {
        this.announcement.set(fresh);
      }
    });
  }

  /** Scroll up to read something and the view stops chasing the bottom until you come back. */
  protected follow(): void {
    const element = this.scroller().nativeElement;
    this.sticky = element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_PX;
  }

  private toBottom(): void {
    const element = this.scroller().nativeElement;
    element.scrollTop = element.scrollHeight;
  }
}
