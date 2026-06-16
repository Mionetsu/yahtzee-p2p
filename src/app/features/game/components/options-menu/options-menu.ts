import { Component, output, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface GameOptions {
  scorecardView: 'modern' | 'classic';
  soundEnabled: boolean;
  textSize: 'normal' | 'large' | 'xlarge';
  exitGame?: boolean;
}

@Component({
  selector: 'app-options-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './options-menu.html',
  styleUrl: './options-menu.scss'
})
export class OptionsMenuComponent {
  options        = input.required<GameOptions>();
  optionsChanged = output<Partial<GameOptions>>();

  isOpen = false;

  toggle(): void { this.isOpen = !this.isOpen; }
  close():  void { this.isOpen = false; }

  set(changes: Partial<GameOptions>): void {
    this.optionsChanged.emit(changes);
    this.close();
  }

  cycleTextSize(): void {
    const next: Record<string, GameOptions['textSize']> = {
      normal: 'large',
      large:  'xlarge',
      xlarge: 'normal'
    };
    this.optionsChanged.emit({ textSize: next[this.options().textSize] });
  }

  textSizeLabel(): string {
    return { normal: '1x', large: '2x', xlarge: '4x' }[this.options().textSize] ?? '1x';
  }

  soundIcon(): string {
    return this.options().soundEnabled ? '🔊' : '🔇';
  }
}