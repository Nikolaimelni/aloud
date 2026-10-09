import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { clock } from '@aloud/core/stream/transcript';
import { SessionStore } from '../session/session-store';
import { Archive } from './archive';

@Component({
  selector: 'aloud-history',
  templateUrl: './history-list.html',
  styleUrl: './history-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryList implements OnInit {
  protected readonly archive = inject(Archive);
  protected readonly session = inject(SessionStore);

  protected readonly stored = computed(() => {
    const bytes = this.archive.sessions().reduce((total, item) => total + item.bytes, 0);
    if (bytes < 1_000_000) {
      return `${Math.round(bytes / 1000)} kB`;
    }
    return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  });

  ngOnInit(): void {
    this.attempt(this.archive.refresh());
  }

  protected open(id: string): void {
    this.attempt(this.session.reopen(id));
  }

  protected remove(id: string, event: Event): void {
    event.stopPropagation();
    this.attempt(this.archive.remove(id));
  }

  protected clear(): void {
    const count = this.archive.sessions().length;
    const what = count === 1 ? 'the saved session' : `all ${count} saved sessions`;
    if (confirm(`Delete ${what}, audio included? There is no undo.`)) {
      this.attempt(this.archive.clear());
    }
  }

  /** IndexedDB refuses in some private windows and on a full disk. Saying so beats doing nothing. */
  private attempt(work: Promise<void>): void {
    work.catch((cause: unknown) => {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.session.error.set(`The saved sessions could not be read or changed: ${reason}`);
    });
  }

  protected when(at: number): string {
    // The interface is English, so the date is too, whatever the browser speaks.
    return new Date(at).toLocaleString('en-GB', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected length(seconds: number): string {
    return clock(seconds);
  }

  protected preview(text: string): string {
    return text.length > 90 ? `${text.slice(0, 90)}...` : text;
  }
}
