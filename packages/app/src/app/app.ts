import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HistoryList } from './history/history-list';
import { SessionPanel } from './session/session-panel';

@Component({
  selector: 'aloud-root',
  imports: [HistoryList, SessionPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
