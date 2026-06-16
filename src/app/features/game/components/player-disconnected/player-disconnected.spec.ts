import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlayerDisconnected } from './player-disconnected';

describe('PlayerDisconnected', () => {
  let component: PlayerDisconnected;
  let fixture: ComponentFixture<PlayerDisconnected>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerDisconnected],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerDisconnected);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
