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
  private readonly session = inject(SessionStore);

  protected readonly stored = computed(() => {
    const bytes = this.archive.sessions().reduce((total, item) => total + item.bytes, 0);
    if (bytes < 1_000_000) {
      return `${Math.round(bytes / 1000)} kB`;
    }
    return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  });

  ngOnInit(): void {
    void this.archive.refresh();
  }

  protected open(id: string): void {
    void this.session.reopen(id);
  }

  protected remove(id: string, event: Event): void {
    event.stopPropagation();
    void this.archive.remove(id);
  }

  protected when(at: number): string {
    return new Date(at).toLocaleString(undefined, {
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
