import { Component, input, output, OnChanges, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { gsap } from 'gsap';
import { Player, ScoreCard, ScoreCategory } from '../../../../core/models';

@Component({
  selector: 'app-game-over',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './game-over.html',
  styleUrl: './game-over.scss'
})
export class GameOverComponent implements OnChanges {
  players     = input<Player[]>([]);
  visible     = input<boolean>(false);
  playAgain   = output<void>();
  exitToLobby = output<void>();

  overlayRef    = viewChild<ElementRef>('overlayRef');
  contentRef    = viewChild<ElementRef>('contentRef');
  screenshotRef = viewChild<ElementRef>('screenshotRef');

  sortedPlayers: (Player & { total: number })[] = [];

  readonly upperRows = [
    { category: 'ones' as ScoreCategory,   label: 'Aces'   },
    { category: 'twos' as ScoreCategory,   label: 'Deuces' },
    { category: 'threes' as ScoreCategory, label: 'Threes' },
    { category: 'fours' as ScoreCategory,  label: 'Fours'  },
    { category: 'fives' as ScoreCategory,  label: 'Fives'  },
    { category: 'sixes' as ScoreCategory,  label: 'Sixes'  },
  ];

  readonly lowerRows = [
    { category: 'threeOfAKind' as ScoreCategory,  label: '3 of a Kind'  },
    { category: 'fourOfAKind' as ScoreCategory,   label: '4 of a Kind'  },
    { category: 'fullHouse' as ScoreCategory,     label: 'Full House'   },
    { category: 'smallStraight' as ScoreCategory, label: 'S. Straight'  },
    { category: 'largeStraight' as ScoreCategory, label: 'L. Straight'  },
    { category: 'yahtzee' as ScoreCategory,       label: 'Yahtzee!'     },
    { category: 'chance' as ScoreCategory,        label: 'Chance'       },
  ];

  ngOnChanges(): void {
    if (!this.visible()) return;
    this.sortedPlayers = [...this.players()]
      .map(p => ({ ...p, total: this.grandTotal(p.scoreCard) }))
      .sort((a, b) => b.total - a.total);
    setTimeout(() => this.animate(), 50);
  }

  private animate(): void {
    const overlay = this.overlayRef()?.nativeElement;
    const content = this.contentRef()?.nativeElement;
    if (!overlay || !content) return;
    this.spawnConfetti();
    gsap.timeline()
      .fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.4 })
      .fromTo(content,
        { scale: 0.5, opacity: 0, y: 40 },
        { scale: 1, opacity: 1, y: 0, duration: 0.6, ease: 'back.out(1.5)' },
        '-=0.2'
      );
  }

  private spawnConfetti(): void {
    const overlay = this.overlayRef()?.nativeElement;
    if (!overlay) return;
    const colors = ['#FFD700','#FF6B6B','#4ade80','#60a5fa','#f472b6','#a78bfa'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.style.cssText = `
        position:absolute; width:${6 + Math.random()*8}px;
        height:${6 + Math.random()*8}px;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
        left:${Math.random()*100}%; top:-20px; pointer-events:none;
      `;
      overlay.appendChild(el);
      gsap.to(el, {
        y: window.innerHeight + 40,
        x: (Math.random() - 0.5) * 300,
        rotation: Math.random() * 720,
        duration: 2 + Math.random() * 2,
        delay: Math.random() * 1.5,
        ease: 'power1.in',
        onComplete: () => el.remove()
      });
    }
  }

  upperTotal(scoreCard: ScoreCard): number {
    return this.upperRows.reduce((s, r) => s + (scoreCard[r.category] ?? 0), 0);
  }

  hasBonus(scoreCard: ScoreCard): boolean {
    return this.upperTotal(scoreCard) >= 63;
  }

  grandTotal(scoreCard: ScoreCard): number {
    const upper = this.upperTotal(scoreCard);
    const bonus = this.hasBonus(scoreCard) ? 35 : 0;
    const lower = this.lowerRows.reduce((s, r) => s + (scoreCard[r.category] ?? 0), 0);
    return upper + bonus + lower;
  }

  medalFor(index: number): string {
    return ['\u{1F947}', '\u{1F948}', '\u{1F949}'][index] ?? '';
  }

  async takeScreenshot(): Promise<void> {
    const el = this.screenshotRef()?.nativeElement;
    if (!el) return;
    el.style.display = 'block';
    await new Promise(r => setTimeout(r, 100));
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(el, {
      backgroundColor: '#0f0f1a',
      scale: 2,
      useCORS: true
    });
    el.style.display = 'none';
    const link = document.createElement('a');
    link.download = 'yahtzee-results.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }
}