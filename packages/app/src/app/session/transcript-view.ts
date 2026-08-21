import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { clock, type Segment } from '@aloud/core/stream/transcript';

/** Close enough to the bottom that the reader clearly wants to follow along. */
const STICKY_PX = 24;

interface Row {
  readonly start: number;
  readonly stamp: string;
  readonly parts: readonly { text: string; hit: boolean }[];
  readonly active: boolean;
}

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

  protected readonly rows = computed<Row[]>(() => {
    const needle = this.query().trim().toLowerCase();
    const at = this.playhead();

    return this.segments()
      .filter((segment) => !needle || segment.text.toLowerCase().includes(needle))
      .map((segment) => ({
        start: segment.start,
        stamp: clock(segment.start),
        parts: split(segment.text, needle),
        active: at >= segment.start && at < segment.end,
      }));
  });

  protected readonly filtered = computed(
    () => this.query().trim().length > 0 && this.rows().length !== this.segments().length,
  );

  constructor() {
    effect(() => {
      this.rows();
      this.pending();
      if (this.sticky) {
        queueMicrotask(() => this.toBottom());
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

function split(text: string, needle: string): { text: string; hit: boolean }[] {
  if (!needle) return [{ text, hit: false }];

  const parts: { text: string; hit: boolean }[] = [];
  const haystack = text.toLowerCase();
  let at = 0;

  for (;;) {
    const found = haystack.indexOf(needle, at);
    if (found === -1) break;
    if (found > at) parts.push({ text: text.slice(at, found), hit: false });
    parts.push({ text: text.slice(found, found + needle.length), hit: true });
    at = found + needle.length;
  }

  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
