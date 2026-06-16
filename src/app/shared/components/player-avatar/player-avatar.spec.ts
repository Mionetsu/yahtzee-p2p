import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlayerAvatar } from './player-avatar';

describe('PlayerAvatar', () => {
  let component: PlayerAvatar;
  let fixture: ComponentFixture<PlayerAvatar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerAvatar],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerAvatar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
