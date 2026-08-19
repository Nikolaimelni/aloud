import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  input,
  viewChild,
} from '@angular/core';

/** Close enough to the bottom that the reader clearly wants to follow along. */
const STICKY_PX = 24;

@Component({
  selector: 'aloud-transcript',
  template: `
    <div #scroller class="scroller" (scroll)="follow()">
      @if (confirmed() || pending()) {
        <p class="body">
          <span class="confirmed" aria-live="polite">{{ confirmed() }}</span>
          <!-- The guess is rewritten every pass; announcing it would make a screen reader
               read the same sentence over and over. -->
          <span class="guess" aria-hidden="true">{{ pending() }}</span>
        </p>
      } @else {
        <p class="empty">{{ placeholder() }}</p>
      }
    </div>
  `,
  styles: `
    .scroller {
      max-height: 340px;
      overflow-y: auto;
      padding: 2px 0;
    }
    .body {
      margin: 0;
      font-size: 17px;
      line-height: 1.72;
    }
    .confirmed {
      color: var(--ink);
    }
    .guess {
      color: var(--partial);
      background: var(--partial-soft);
    }
    .empty {
      margin: 0;
      color: var(--ink-3);
      font-size: 15px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranscriptView {
  readonly confirmed = input.required<string>();
  readonly pending = input.required<string>();
  readonly placeholder = input('');

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private sticky = true;

  constructor() {
    effect(() => {
      this.confirmed();
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
