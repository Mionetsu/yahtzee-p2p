import { Component, input, output, ElementRef, viewChildren } from '@angular/core';
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
export class DiceComponent {
  dice       = input.required<Die[]>();
  canHold    = input<boolean>(false);
  dieToggled = output<number>();

  private cubeEls    = viewChildren<ElementRef>('cubeRef');
  private wrapperEls = viewChildren<ElementRef>('wrapperRef');

  onDieClick(dieId: number): void {
    if (!this.canHold() || this.isBlocked()) return;
    this.dieToggled.emit(dieId);

    const wrapper = this.wrapperEls()[dieId]?.nativeElement;
    if (!wrapper) return;

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

    // Quick shake animation — no rotation needed since front face always shows correct value
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
      gsap.to(w.nativeElement, { y: 0, duration: 0.2, ease: 'power2.out' });
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

  isBlocked = input<boolean>(false);

  rollsLeft = input<number>(3);
}