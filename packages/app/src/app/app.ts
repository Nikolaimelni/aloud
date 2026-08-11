import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CaptureStore } from './capture/capture-store';
import { LevelMeter } from './capture/level-meter';
import { StreamPanel } from './stream/stream-panel';
import { TranscribePanel } from './transcribe/transcribe-panel';

@Component({
  selector: 'aloud-root',
  imports: [LevelMeter, StreamPanel, TranscribePanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly capture = inject(CaptureStore);
}
