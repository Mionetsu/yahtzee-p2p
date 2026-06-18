import { Component, input, output, ElementRef, viewChildren, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { gsap } from 'gsap';
import { Die } from '../../../../core/models';

@Component({
  selector: 'app-dice',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dice.html',
  styleUrl: './dice.scss'
})
export class DiceComponent implements OnChanges {
  dice       = input.required<Die[]>();
  canHold    = input<boolean>(false);
  dieToggled = output<number>();
  isBlocked  = input<boolean>(false);
  rollsLeft  = input<number>(3);

  private cubeEls    = viewChildren<ElementRef>('cubeRef');
  private wrapperEls = viewChildren<ElementRef>('wrapperRef');

  ngOnChanges(changes: SimpleChanges): void {
    // When a new turn starts rollsLeft resets to 3 — snap all wrappers down immediately.
    if (changes['rollsLeft'] && this.rollsLeft() === 3) {
      this.wrapperEls().forEach(w => {
        gsap.killTweensOf(w.nativeElement);
        gsap.set(w.nativeElement, { y: 0 });
      });
    }
  }

  onDieClick(dieId: number): void {
    if (!this.canHold() || this.isBlocked()) return;
    this.dieToggled.emit(dieId);

    const wrapper = this.wrapperEls()[dieId]?.nativeElement;
    if (!wrapper) return;

    // Read held state AFTER emitting so the parent has already toggled it
    const die = this.dice()[dieId];
    gsap.to(wrapper, {
      y: !die.held ? -24 : 0,
      duration: 0.25,
      ease: 'back.out(2)'
    });
  }

  animateRoll(dieIndex: number): void {
    const cube = this.cubeEls()[dieIndex]?.nativeElement;
    if (!cube) return;

    gsap.timeline()
      .to(cube, { rotateZ: -15, duration: 0.08, ease: 'power1.out' })
      .to(cube, { rotateZ: 15,  duration: 0.08, ease: 'power1.inOut' })
      .to(cube, { rotateZ: -10, duration: 0.07, ease: 'power1.inOut' })
      .to(cube, { rotateZ: 10,  duration: 0.07, ease: 'power1.inOut' })
      .to(cube, { rotateZ: -5,  duration: 0.06, ease: 'power1.inOut' })
      .to(cube, { rotateZ: 0,   duration: 0.06, ease: 'power1.out' })
      .to(cube, { scale: 1.08,  duration: 0.08, ease: 'power1.out' }, 0)
      .to(cube, { scale: 1,     duration: 0.15, ease: 'bounce.out' }, 0.3);
  }

  resetAllWrappers(): void {
    this.wrapperEls().forEach(w => {
      gsap.killTweensOf(w.nativeElement);
      gsap.set(w.nativeElement, { y: 0 });
    });
  }

  getDieFace(value: number): string[][] {
    const faces: Record<number, string[][]> = {
      1: [['','',''],['','●',''],['','','']],
      2: [['●','',''],['','',''],['','','●']],
      3: [['●','',''],['','●',''],['','','●']],
      4: [['●','','●'],['','',''],['●','','●']],
      5: [['●','','●'],['','●',''],['●','','●']],
      6: [['●','','●'],['●','','●'],['●','','●']],
    };
    return faces[value] ?? faces[1];
  }
}