import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LobbyPage } from './lobby-page';

describe('LobbyPage', () => {
  let component: LobbyPage;
  let fixture: ComponentFixture<LobbyPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LobbyPage],
    }).compileComponents();

    fixture = TestBed.createComponent(LobbyPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
