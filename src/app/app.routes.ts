import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/lobby/lobby-page/lobby-page').then(m => m.LobbyPage)
  },
  {
    path: 'game',
    loadComponent: () =>
      import('./features/game/game/game.component').then(m => m.GameComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];