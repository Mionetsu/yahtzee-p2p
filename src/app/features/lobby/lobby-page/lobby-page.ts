import { Component, signal, inject, viewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PeerService } from '../../../core/services/peer.service';
import { YahtzeeService } from '../../../core/services/yahtzee.service';
import { AvatarColor } from '../../../core/models';

type LobbyView = 'home' | 'create' | 'join' | 'waiting';

@Component({
  selector: 'app-lobby-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lobby-page.html',
  styleUrl: './lobby-page.scss'
})
export class LobbyPage implements OnInit {
  private peer    = inject(PeerService);
  private yahtzee = inject(YahtzeeService);
  private router  = inject(Router);

  private fileInput = viewChild<ElementRef>('fileInput');

  view           = signal<LobbyView>('home');
  nickname       = signal<string>('');
  joinCode       = signal<string>('');
  roomCode       = signal<string>('');
  errorMsg       = signal<string>('');
  isLoading      = signal<boolean>(false);
  connectedPeers = signal<string[]>([]);
  guestNames     = signal<Record<string, string>>({});

  // Reconnect
  hasReconnectData  = signal<boolean>(false);
  reconnectRoomCode = signal<string>('');

  // Avatar
  selectedColor = signal<AvatarColor>('#AEC6FF');
  selectedImage = signal<string | undefined>(undefined);

  readonly avatarColors: AvatarColor[] = [
    '#FF9AA2',
    '#FFB347',
    '#FDFD96',
    '#B5EAD7',
    '#9DE0F6',
    '#AEC6FF',
    '#C3B1E1',
    '#F7C5E0',
  ];

  ngOnInit(): void {
    const saved = this.peer.getSavedReconnectData();
    if (saved) {
      this.hasReconnectData.set(true);
      this.reconnectRoomCode.set(saved.roomCode);
    }
  }

  get canProceed(): boolean {
    return this.nickname().trim().length >= 2;
  }

  selectColor(color: AvatarColor): void {
    this.selectedColor.set(color);
    this.selectedImage.set(undefined);
  }

  clearImage(): void {
    this.selectedImage.set(undefined);
  }

  onImageSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.selectedImage.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  triggerImageUpload(): void {
    this.fileInput()?.nativeElement.click();
  }

  async createRoom(): Promise<void> {
    if (!this.canProceed) return;
    this.isLoading.set(true);
    this.errorMsg.set('');
    try {
      const code = await this.peer.createRoom();
      this.roomCode.set(code);
      this.view.set('waiting');
      this.watchPeers();
    } catch {
      this.errorMsg.set('Could not create room. Try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async joinRoom(): Promise<void> {
    if (!this.canProceed || !this.joinCode().trim()) return;
    this.isLoading.set(true);
    this.errorMsg.set('');
    try {
      await this.peer.joinRoom(this.joinCode().trim().toUpperCase());
      this.peer.broadcastMessage({
        type: 'player-joined',
        payload: {
          peerId: this.peer.roomCode(),
          nickname: this.nickname().trim(),
          avatarColor: this.selectedColor(),
          avatarImage: this.selectedImage()
        }
      });
      this.startGame();
    } catch {
      this.errorMsg.set('Could not connect. Check the room code and try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  startGame(): void {
    const me = this.yahtzee.createPlayer(
      this.peer.roomCode() || 'player-1',
      this.nickname().trim() || 'Player',
      true,
      this.selectedColor(),
      this.selectedImage()
    );
    this.yahtzee.startGame([me], this.peer.roomCode());
    this.router.navigate(['/game']);
  }

  async reconnectToGame(): Promise<void> {
    const saved = this.peer.getSavedReconnectData();
    if (!saved) return;
    this.isLoading.set(true);
    this.errorMsg.set('');
    try {
      await this.peer.joinRoom(saved.roomCode);
      this.yahtzee.applyRemoteState(saved.state);
      this.router.navigate(['/game']);
    } catch {
      this.peer.clearReconnectData();
      this.hasReconnectData.set(false);
      this.errorMsg.set('Could not reconnect. The room may no longer exist.');
    } finally {
      this.isLoading.set(false);
    }
  }

  dismissReconnect(): void {
    this.peer.clearReconnectData();
    this.hasReconnectData.set(false);
  }

  copyCode(): void {
    navigator.clipboard.writeText(this.roomCode());
  }

  playSolo(): void {
    const me = this.yahtzee.createPlayer(
      'player-1',
      this.nickname().trim() || 'Player',
      true,
      this.selectedColor(),
      this.selectedImage()
    );
    this.yahtzee.startGame([me], 'SOLO');
    this.router.navigate(['/game']);
  }

  private watchPeers(): void {
    const interval = setInterval(() => {
      this.connectedPeers.set(this.peer.peers());
    }, 500);

    let lastMsg = this.peer.lastMessage();
    const msgInterval = setInterval(() => {
      const msg = this.peer.lastMessage();
      if (msg && msg !== lastMsg) {
        lastMsg = msg;
        if (msg.type === 'player-joined' && (msg.payload as any)?.nickname) {
          const p = msg.payload as any;
          this.guestNames.update(names => ({ ...names, [p.peerId]: p.nickname }));
        }
      }
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      clearInterval(msgInterval);
    }, 300_000);
  }
}