import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-player-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './player-avatar.html',
  styleUrl: './player-avatar.scss'
})
export class PlayerAvatarComponent {
  name        = input<string>('?');
  avatarColor = input<string>('#B8A4FF');
  avatarImage = input<string | undefined>(undefined);
  size        = input<'sm' | 'md' | 'lg'>('md');
}