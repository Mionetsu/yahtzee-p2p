import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GameOver } from './game-over';

describe('GameOver', () => {
  let component: GameOver;
  let fixture: ComponentFixture<GameOver>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameOver],
    }).compileComponents();

    fixture = TestBed.createComponent(GameOver);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
