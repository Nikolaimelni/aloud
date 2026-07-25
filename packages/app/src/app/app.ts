import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'aloud-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
