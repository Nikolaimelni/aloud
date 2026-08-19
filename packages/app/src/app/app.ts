import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SessionPanel } from './session/session-panel';

@Component({
  selector: 'aloud-root',
  imports: [SessionPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
