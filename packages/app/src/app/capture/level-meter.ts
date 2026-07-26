import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  input,
  viewChild,
} from '@angular/core';

const BAR = 4;
const GAP = 2;

@Component({
  selector: 'aloud-level-meter',
  template: '<canvas #surface aria-hidden="true"></canvas>',
  styles: `
    :host {
      display: block;
    }
    canvas {
      display: block;
      width: 100%;
      height: 72px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LevelMeter {
  readonly history = input.required<readonly number[]>();

  private readonly surface = viewChild.required<ElementRef<HTMLCanvasElement>>('surface');

  constructor() {
    effect(() => this.draw(this.history()));
  }

  private draw(levels: readonly number[]): void {
    const canvas = this.surface().nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = getComputedStyle(canvas).getPropertyValue('--accent');

    // Newest bar sits at the right edge and the rest scroll off to the left.
    const visible = Math.floor(width / (BAR + GAP));
    const shown = levels.slice(-visible);
    let x = width - shown.length * (BAR + GAP);

    for (const level of shown) {
      const bar = Math.max(2, level * height);
      context.fillRect(x, (height - bar) / 2, BAR, bar);
      x += BAR + GAP;
    }
  }
}
