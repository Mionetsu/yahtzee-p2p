import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlayersHud } from './players-hud';

describe('PlayersHud', () => {
  let component: PlayersHud;
  let fixture: ComponentFixture<PlayersHud>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayersHud],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayersHud);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
