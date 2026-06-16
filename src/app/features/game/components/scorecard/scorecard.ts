import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Player, ScoreCategory, ScoreCard } from '../../../../core/models';
import { PlayerAvatarComponent } from '../../../../shared/components/player-avatar/player-avatar';

interface ScoreRow {
  category: ScoreCategory;
  label: string;
  icon: string;
}

const UPPER_ROWS: ScoreRow[] = [
  { category: 'ones',   label: 'Aces',   icon: '\u2680' },
  { category: 'twos',   label: 'Deuces', icon: '\u2681' },
  { category: 'threes', label: 'Threes', icon: '\u2682' },
  { category: 'fours',  label: 'Fours',  icon: '\u2683' },
  { category: 'fives',  label: 'Fives',  icon: '\u2684' },
  { category: 'sixes',  label: 'Sixes',  icon: '\u2685' },
];

const LOWER_ROWS: ScoreRow[] = [
  { category: 'threeOfAKind',  label: '3 of a Kind',  icon: '\u{1F3B2}'  },
  { category: 'fourOfAKind',   label: '4 of a Kind',  icon: '\u{1F3B2}'  },
  { category: 'fullHouse',     label: 'Full House',   icon: '\u{1F3E0}'  },
  { category: 'smallStraight', label: 'S. Straight',  icon: '\u{1F4C8}'  },
  { category: 'largeStraight', label: 'L. Straight',  icon: '\u{1F680}'  },
  { category: 'yahtzee',       label: 'Yahtzee!',     icon: '\u2B50'     },
  { category: 'chance',        label: 'Chance',       icon: '\u{1F3AF}'  },
];

@Component({
  selector: 'app-scorecard',
  standalone: true,
  imports: [CommonModule, PlayerAvatarComponent],
  templateUrl: './scorecard.html',
  styleUrls: ['./scorecard.scss']
})
export class ScorecardComponent {
  currentPlayer    = input.required<Player>();
  otherPlayers     = input<Player[]>([]);
  previews         = input<Partial<Record<ScoreCategory, number | null>>>({});
  isMyTurn         = input<boolean>(false);
  rollsLeft        = input<number>(3);
  textSize         = input<'normal' | 'large' | 'xlarge'>('normal');
  viewMode         = input<'modern' | 'classic'>('modern');

  categorySelected  = output<ScoreCategory>();
  largeTextToggled  = output<void>();

  readonly upperRows = UPPER_ROWS;
  readonly lowerRows = LOWER_ROWS;

  isLargeToggle(): void {
    this.largeTextToggled.emit();
  }

  getScore(scoreCard: ScoreCard, category: ScoreCategory): number | null {
    return scoreCard[category];
  }

  getPreview(category: ScoreCategory): number | null {
    return this.previews()[category] ?? null;
  }

  upperTotal(scoreCard: ScoreCard): number {
    return UPPER_ROWS.reduce((sum, row) => sum + (scoreCard[row.category] ?? 0), 0);
  }

  hasBonus(scoreCard: ScoreCard): boolean {
    return this.upperTotal(scoreCard) >= 63;
  }

  grandTotal(scoreCard: ScoreCard): number {
    const upper = this.upperTotal(scoreCard);
    const bonus = this.hasBonus(scoreCard) ? 35 : 0;
    const lower = LOWER_ROWS.reduce((sum, row) => sum + (scoreCard[row.category] ?? 0), 0);
    return upper + bonus + lower;
  }

  canScore(category: ScoreCategory): boolean {
    return this.isMyTurn() &&
           this.rollsLeft() < 3 &&
           this.currentPlayer().scoreCard[category] === null;
  }

  selectCategory(category: ScoreCategory): void {
    if (this.canScore(category)) {
      this.categorySelected.emit(category);
    }
  }
}