import { Injectable, signal } from '@angular/core';
import Peer, { DataConnection } from 'peerjs';
import { GameState } from '../models';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface P2PMessage {
  type: 'game-state' | 'player-joined' | 'player-left' | 'chat' | 'start-game' | 'score-event' | 'game-over' | 'play-again';
  payload: unknown;
}

@Injectable({ providedIn: 'root' })
export class PeerService {

  readonly status      = signal<ConnectionStatus>('disconnected');
  readonly roomCode    = signal<string>('');
  readonly peers       = signal<string[]>([]);
  readonly lastMessage = signal<P2PMessage | null>(null);
  private _messageQueue: P2PMessage[] = [];
  readonly messageQueue = { dequeueAll: () => { const q = [...this._messageQueue]; this._messageQueue = []; return q; } };
  readonly myPeerId    = signal<string>('');
  readonly isHost      = signal<boolean>(false);

  private peer:        Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();

  private readonly STATE_KEY = 'yahtzee_last_state';
  private readonly ROOM_KEY  = 'yahtzee_last_room';
  private readonly ID_KEY    = 'yahtzee_peer_id';

  saveStateForReconnect(state: GameState, myId: string): void {
    localStorage.setItem(this.STATE_KEY, JSON.stringify(state));
    localStorage.setItem(this.ROOM_KEY,  this.roomCode());
    localStorage.setItem(this.ID_KEY,    myId);
  }

  getSavedReconnectData(): { state: GameState; roomCode: string; myId: string } | null {
    try {
      const state    = localStorage.getItem(this.STATE_KEY);
      const roomCode = localStorage.getItem(this.ROOM_KEY);
      const myId     = localStorage.getItem(this.ID_KEY);
      if (!state || !roomCode || !myId) return null;
      return { state: JSON.parse(state), roomCode, myId };
    } catch { return null; }
  }

  clearReconnectData(): void {
    localStorage.removeItem(this.STATE_KEY);
    localStorage.removeItem(this.ROOM_KEY);
    localStorage.removeItem(this.ID_KEY);
  }

  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      const code = this.generateRoomCode();
      this.status.set('connecting');
      this.isHost.set(true);

      // DEV: comment out for production
      this.peer = new Peer(code, { host: 'localhost', port: 9000, path: '/' });
      // PROD: uncomment for production
      // this.peer = new Peer(code);

      this.peer.on('open', id => {
        this.roomCode.set(id);
        this.myPeerId.set(id);
        this.status.set('connected');
        resolve(id);
      });

      this.peer.on('connection', conn => {
        this.setupConnection(conn);
      });

      this.peer.on('error', err => {
        this.status.set('error');
        reject(err);
      });
    });
  }

  joinRoom(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.status.set('connecting');
      this.isHost.set(false);

      // DEV: comment out for production
      this.peer = new Peer('', { host: 'localhost', port: 9000, path: '/' });
      // PROD: uncomment for production
      // this.peer = new Peer();

      this.peer.on('open', (myId) => {
        this.myPeerId.set(myId);
        this.roomCode.set(code);

        const conn = this.peer!.connect(code);
        this.setupConnection(conn);

        conn.on('open', () => {
          this.status.set('connected');
          resolve();
        });

        conn.on('error', err => {
          this.status.set('error');
          reject(err);
        });
      });

      this.peer.on('error', err => {
        this.status.set('error');
        reject(err);
      });
    });
  }

  broadcastState(state: GameState, myId?: string): void {
    const message: P2PMessage = { type: 'game-state', payload: state };
    this.connections.forEach(conn => {
      if (conn.open) conn.send(message);
    });
    if (myId) this.saveStateForReconnect(state, myId);
  }

  sendTo(peerId: string, message: P2PMessage): void {
    const conn = this.connections.get(peerId);
    if (conn?.open) conn.send(message);
  }

  disconnect(): void {
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    this.status.set('disconnected');
    this.roomCode.set('');
    this.myPeerId.set('');
    this.peers.set([]);
    this.isHost.set(false);
  }

  private setupConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.peers.update(list => [...list, conn.peer]);
    });

    conn.on('data', (data: unknown) => {
      const msg = data as P2PMessage;
      this.lastMessage.set(msg);
      this._messageQueue.push(msg);

      if (this.isHost()) {
        this.connections.forEach((c, peerId) => {
          if (peerId !== conn.peer && c.open) {
            c.send(msg);
          }
        });
      }
    });

    conn.on('close', () => {
      console.log('[PeerService] conn closed for peer:', conn.peer);
      this.connections.delete(conn.peer);
      this.peers.update(list => list.filter(id => id !== conn.peer));

      const leftMsg: P2PMessage = { type: 'player-left', payload: { peerId: conn.peer } };
      console.log('[PeerService] pushing player-left to queue:', leftMsg);
      this._messageQueue.push(leftMsg);
      this.broadcastMessage(leftMsg);
    });

    conn.on('error', err => {
      console.error('[PeerService] Connection error:', err);
      this.connections.delete(conn.peer);
    });
  }

  promoteToHost(newRoomCode: string): void {
    this.isHost.set(true);
    this.roomCode.set(newRoomCode);
    // Start accepting incoming connections
    if (this.peer) {
      this.peer.on('connection', conn => {
        this.setupConnection(conn);
      });
    }
  }

  broadcastMessage(message: P2PMessage): void {
    this.connections.forEach(conn => {
      if (conn.open) conn.send(message);
    });
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return 'YTZ-' + Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  
}