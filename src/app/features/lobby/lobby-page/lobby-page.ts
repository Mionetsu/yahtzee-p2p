import { Component, signal, inject, viewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PeerService } from '../../../core/services/peer.service';
import { YahtzeeService } from '../../../core/services/yahtzee.service';
import { AvatarColor, Player } from '../../../core/models';

type LobbyView = 'home' | 'create' | 'join' | 'waiting';

@Component({
  selector: 'app-lobby-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lobby-page.html',
  styleUrl: './lobby-page.scss'
})
export class LobbyPage implements OnInit, OnDestroy {
  peer = inject(PeerService);
  private yahtzee = inject(YahtzeeService);
  private router  = inject(Router);

  private fileInput    = viewChild<ElementRef>('fileInput');
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  view           = signal<LobbyView>('home');
  nickname       = signal<string>('');
  joinCode       = signal<string>('');
  roomCode       = signal<string>('');
  errorMsg       = signal<string>('');
  isLoading      = signal<boolean>(false);
  connectedPeers = signal<string[]>([]);
  guestPlayers   = signal<Record<string, { nickname: string; avatarColor: AvatarColor; avatarImage?: string }>>({});
  hostInfo       = signal<{ nickname: string; avatarColor: AvatarColor; avatarImage?: string } | null>(null);

  hasReconnectData  = signal<boolean>(false);
  reconnectRoomCode = signal<string>('');

  selectedColor = signal<AvatarColor>('#AEC6FF');
  selectedImage = signal<string | undefined>(undefined);

  readonly avatarColors: AvatarColor[] = [
    '#FF9AA2', '#FFB347', '#FDFD96', '#B5EAD7',
    '#9DE0F6', '#AEC6FF', '#C3B1E1', '#F7C5E0',
  ];

  ngOnInit(): void {
    const saved = this.peer.getSavedReconnectData();
    if (saved) {
      this.hasReconnectData.set(true);
      this.reconnectRoomCode.set(saved.roomCode);
    }
  }

  ngOnDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  get canProceed(): boolean {
    return this.nickname().trim().length >= 2;
  }

  get totalPlayers(): number {
    return 1 + Object.keys(this.guestPlayers()).length;
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
          peerId:      this.peer.myPeerId(),
          nickname:    this.nickname().trim(),
          avatarColor: this.selectedColor(),
          avatarImage: this.selectedImage()
        }
      });
      this.view.set('waiting');
      this.watchForStartGame();
    } catch {
      this.errorMsg.set('Could not connect. Check the room code and try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  startGame(): void {
    if (!this.peer.isHost()) return;

    const hostPlayer = this.yahtzee.createPlayer(
      this.peer.myPeerId(),
      this.nickname().trim() || 'Host',
      true,
      this.selectedColor(),
      this.selectedImage()
    );

    const guestPlayers: Player[] = Object.entries(this.guestPlayers()).map(([peerId, data]) =>
      this.yahtzee.createPlayer(peerId, data.nickname, false, data.avatarColor, data.avatarImage)
    );

    const allPlayers = [hostPlayer, ...guestPlayers];
    this.yahtzee.startGame(allPlayers, this.peer.roomCode());

    this.peer.broadcastMessage({
      type: 'start-game',
      payload: this.yahtzee.state()
    });

    this.router.navigate(['/game']);
  }

  // Kick a guest from the lobby (host only)
  kickPlayer(peerId: string): void {
    if (!this.peer.isHost()) return;

    // Notify the kicked player specifically
    this.peer.sendTo(peerId, {
      type: 'player-left' as any,
      payload: { peerId, kicked: true }
    });

    // Remove from local list
    this.guestPlayers.update(g => {
      const updated = { ...g };
      delete updated[peerId];
      return updated;
    });

    // Broadcast updated room state so other guests see the change
    this.peer.broadcastMessage({
      type: 'room-state' as any,
      payload: {
        host: {
          peerId:      this.peer.myPeerId(),
          nickname:    this.nickname().trim(),
          avatarColor: this.selectedColor(),
          avatarImage: this.selectedImage()
        },
        guests: this.guestPlayers()
      }
    });
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

  private handleHostLeft(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.peer.disconnect();
    this.errorMsg.set('The host left the room. Please create or join a new room.');
    this.guestPlayers.set({});
    this.hostInfo.set(null);
    this.view.set('home');
  }

  private handleKicked(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.peer.disconnect();
    this.errorMsg.set('You were removed from the room by the host.');
    this.guestPlayers.set({});
    this.hostInfo.set(null);
    this.view.set('home');
  }

  private watchPeers(): void {
    this.pollInterval = setInterval(() => {
      this.connectedPeers.set(this.peer.peers());

      const messages = this.peer.messageQueue.dequeueAll();
      console.log('[LobbyPage] messages dequeued:', messages);
      for (const msg of messages) {
        if (msg.type === 'player-joined') {
          const p = msg.payload as any;
          if (p?.peerId && p?.nickname) {
            // Replace any previous entry with the same nickname to avoid
            // duplicates when a player leaves and rejoins with a new peerId.
            this.guestPlayers.update(guests => {
              const cleaned: typeof guests = {};
              for (const [id, data] of Object.entries(guests)) {
                if (data.nickname !== p.nickname) cleaned[id] = data;
              }
              cleaned[p.peerId] = {
                nickname:    p.nickname,
                avatarColor: p.avatarColor ?? '#AEC6FF',
                avatarImage: p.avatarImage
              };
              return cleaned;
            });

            this.peer.broadcastMessage({
              type: 'room-state' as any,
              payload: {
                host: {
                  peerId:      this.peer.myPeerId(),
                  nickname:    this.nickname().trim(),
                  avatarColor: this.selectedColor(),
                  avatarImage: this.selectedImage()
                },
                guests: this.guestPlayers()
              }
            });
          }
        }

        if (msg.type === 'player-left') {
          const leftId = (msg.payload as any)?.peerId;
          this.guestPlayers.update(g => {
            const updated = { ...g };
            delete updated[leftId];
            return updated;
          });
        }
      }
    }, 200);
  }

  private watchForStartGame(): void {
    const hostPeerId = this.joinCode().trim().toUpperCase();
    let hostAliveChecks = 0;

    this.pollInterval = setInterval(() => {
      // Detect host disconnection: no open connections for 2 consecutive ticks
      const peerList = this.peer.peers();
      if (peerList.length === 0 && this.view() === 'waiting') {
        hostAliveChecks++;
        if (hostAliveChecks >= 2) {
          this.handleHostLeft();
          return;
        }
      } else {
        hostAliveChecks = 0;
      }

      const messages = this.peer.messageQueue.dequeueAll();
      for (const msg of messages) {
        if ((msg.type as string) === 'room-state') {
          const rs = msg.payload as any;
          if (rs?.host) {
            this.hostInfo.set({
              nickname:    rs.host.nickname,
              avatarColor: rs.host.avatarColor ?? '#AEC6FF',
              avatarImage: rs.host.avatarImage
            });
          }
          if (rs?.guests) {
            const myId = this.peer.myPeerId();
            const others: Record<string, any> = {};
            for (const [peerId, data] of Object.entries(rs.guests as Record<string, any>)) {
              if (peerId !== myId) others[peerId] = data;
            }
            this.guestPlayers.set(others);
          }
        }

        if (msg.type === 'player-left') {
          const p = msg.payload as any;
          const leftPeerId = p?.peerId;

          // Kicked by host
          if (p?.kicked && leftPeerId === this.peer.myPeerId()) {
            this.handleKicked();
            return;
          }

          // Host disconnected
          if (leftPeerId === hostPeerId) {
            this.handleHostLeft();
            return;
          }

          // Another guest left
          this.guestPlayers.update(g => {
            const updated = { ...g };
            delete updated[leftPeerId];
            return updated;
          });
        }

        if (msg.type === 'start-game') {
          this.yahtzee.applyRemoteState(msg.payload as any);
          if (this.pollInterval) clearInterval(this.pollInterval);
          this.router.navigate(['/game']);
        }
      }
    }, 200);
  }

  cancelWaiting(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.peer.disconnect();
    this.guestPlayers.set({});
    this.hostInfo.set(null);
    this.view.set('home');
  }
}