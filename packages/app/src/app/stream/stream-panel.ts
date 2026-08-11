import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { StreamStore } from './stream-store';

@Component({
  selector: 'aloud-stream-panel',
  templateUrl: './stream-panel.html',
  styleUrl: './stream-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamPanel {
  protected readonly store = inject(StreamStore);

  protected choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void this.store.run(file);
  }

  protected setSpeed(event: Event): void {
    this.store.fasterThanReal.set((event.target as HTMLSelectElement).value === 'fast');
  }

  protected setStep(event: Event): void {
    const step = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(step) && step > 0) this.store.stepSeconds.set(step);
  }

  protected running(): boolean {
    const phase = this.store.phase();
    return phase === 'loading' || phase === 'running';
  }

  protected seconds(value: number): string {
    return value.toFixed(1);
  }

  protected megabytes(bytes: number): string {
    return (bytes / 1_000_000).toFixed(0);
  }
}
