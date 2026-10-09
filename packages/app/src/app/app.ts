import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HistoryList } from './history/history-list';
import { SettingsPanel } from './model/settings-panel';
import { SessionPanel } from './session/session-panel';
import { SessionStore } from './session/session-store';

@Component({
  selector: 'aloud-root',
  imports: [HistoryList, SessionPanel, SettingsPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly session = inject(SessionStore);
}
