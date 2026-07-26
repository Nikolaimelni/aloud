import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CaptureStore } from './capture/capture-store';
import { LevelMeter } from './capture/level-meter';

@Component({
  selector: 'aloud-root',
  imports: [LevelMeter],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly capture = inject(CaptureStore);
}
