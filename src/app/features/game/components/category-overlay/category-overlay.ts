import { Component, input, output, OnChanges, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { gsap } from 'gsap';
import { ScoreCategory } from '../../../../core/models';

interface CategoryConfig {
  label: string;
  emoji: string;
  color: string;
  glow: string;
}

const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  threeOfAKind:  { label: 'Three of a Kind!', emoji: '\u{1F3B2}',       color: '#378ADD', glow: 'rgba(55,138,221,0.4)'  },
  fourOfAKind:   { label: 'Four of a Kind!',  emoji: '\u{1F3B2}\u{1F3B2}', color: '#7F77DD', glow: 'rgba(127,119,221,0.4)' },
  fullHouse:     { label: 'Full House!',       emoji: '\u{1F3E0}',       color: '#1D9E75', glow: 'rgba(29,158,117,0.4)'  },
  smallStraight: { label: 'Small Straight!',   emoji: '\u{1F4C8}',       color: '#EF9F27', glow: 'rgba(239,159,39,0.4)'  },
  largeStraight: { label: 'Large Straight!',   emoji: '\u{1F680}',       color: '#D85A30', glow: 'rgba(216,90,48,0.4)'   },
  yahtzee:       { label: 'YAHTZEE!!!',        emoji: '\u2B50',          color: '#FFD700', glow: 'rgba(255,215,0,0.6)'   },
  bonus: { label: '+35 Bonus!', emoji: '\u{1F3C6}', color: '#4ade80', glow: 'rgba(74,222,128,0.5)' },
};

@Component({
  selector: 'app-category-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-overlay.html',
  styleUrl: './category-overlay.scss'
})
export class CategoryOverlayComponent implements OnChanges {
  category  = input<ScoreCategory | null>(null);
  dismissed = output<void>();

  overlayRef = viewChild<ElementRef>('overlayRef');
  contentRef = viewChild<ElementRef>('contentRef');

  config: CategoryConfig | null = null;
  visible = false;

  ngOnChanges(): void {
    const cat = this.category();
    if (!cat || !CATEGORY_CONFIG[cat]) {
      this.config = null;
      this.visible = false;
      return;
    }
    this.config = CATEGORY_CONFIG[cat];
    this.visible = true;
    this.playAnimation();
  }

  private playAnimation(): void {
    setTimeout(() => {
      const overlay = this.overlayRef()?.nativeElement;
      const content = this.contentRef()?.nativeElement;
      if (!overlay || !content) return;

      const isYahtzee = this.category() === 'yahtzee';

      gsap.timeline()
        .fromTo(overlay,
          { opacity: 0 },
          { opacity: 1, duration: 0.3, ease: 'power2.out' }
        )
        .fromTo(content,
          { scale: 0.4, opacity: 0, y: 30 },
          {
            scale: 1, opacity: 1, y: 0,
            duration: isYahtzee ? 0.6 : 0.45,
            ease: isYahtzee ? 'elastic.out(1, 0.5)' : 'back.out(2)'
          }, '-=0.1'
        )
        .to({}, { duration: isYahtzee ? 2.8 : 2.0 })
        .to(overlay, { opacity: 0, duration: 0.4, ease: 'power2.in' })
        .then(() => {
          this.visible = false;
          this.dismissed.emit();
        });
    });
  }
}