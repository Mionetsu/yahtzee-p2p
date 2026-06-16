import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CategoryOverlay } from './category-overlay';

describe('CategoryOverlay', () => {
  let component: CategoryOverlay;
  let fixture: ComponentFixture<CategoryOverlay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategoryOverlay],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryOverlay);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
