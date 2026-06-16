import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Player, ScoreCard, ScoreCategory } from '../../../../core/models';
import { PlayerAvatarComponent } from '../../../../shared/components/player-avatar/player-avatar';

@Component({
  selector: 'app-players-hud',
  standalone: true,
  imports: [CommonModule, PlayerAvatarComponent],
  templateUrl: './players-hud.html',
  styleUrl: './players-hud.scss'
})
export class PlayersHudComponent {
  players         = input.required<Player[]>();
  currentPlayerId = input.required<string>();

  grandTotal(scoreCard: ScoreCard): number {
    const upper: ScoreCategory[] = ['ones','twos','threes','fours','fives','sixes'];
    const lower: ScoreCategory[] = ['threeOfAKind','fourOfAKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];
    const upperSum = upper.reduce((s, c) => s + (scoreCard[c] ?? 0), 0);
    const bonus    = upperSum >= 63 ? 35 : 0;
    const lowerSum = lower.reduce((s, c) => s + (scoreCard[c] ?? 0), 0);
    return upperSum + bonus + lowerSum;
  }
}