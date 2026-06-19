import { Component, input, output, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-player-disconnected',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './player-disconnected.html',
  styleUrl: './player-disconnected.scss'
})
export class PlayerDisconnectedComponent implements OnDestroy {
  playerName  = input<string>('Player');
  visible     = input<boolean>(false);
  waitSeconds = input<number>(60);

  continueWaiting = output<void>();
  endGame         = output<void>();

  timeLeft    = 60;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this.visible()) {
        this.timeLeft = this.waitSeconds();
        this.startCountdown();
      } else {
        this.stopCountdown();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopCountdown();
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.timer = setInterval(() => {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.stopCountdown();
        this.endGame.emit();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onContinueWaiting(): void {
    this.timeLeft = this.waitSeconds();
    this.startCountdown();
    this.continueWaiting.emit();
  }
}