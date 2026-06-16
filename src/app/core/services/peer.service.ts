import { Injectable, signal } from '@angular/core';
import Peer, { DataConnection } from 'peerjs';
import { GameState } from '../models';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface P2PMessage {
  type: 'game-state' | 'player-joined' | 'player-left' | 'chat';
  payload: unknown;
}

@Injectable({ providedIn: 'root' })
export class PeerService {

  // -- Reactive state signals -------------------------------------------
  readonly status      = signal<ConnectionStatus>('disconnected');
  readonly roomCode    = signal<string>('');
  readonly peers       = signal<string[]>([]);
  readonly lastMessage = signal<P2PMessage | null>(null);

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

  // -- Create a room (host) ---------------------------------------------
  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      const code = this.generateRoomCode();
      this.status.set('connecting');

      this.peer = new Peer(code);

      this.peer.on('open', id => {
        this.roomCode.set(id);
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

  // -- Join a room (guest) ----------------------------------------------
  joinRoom(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.status.set('connecting');

      this.peer = new Peer();

      this.peer.on('open', () => {
        const conn = this.peer!.connect(code);
        this.setupConnection(conn);

        conn.on('open', () => {
          this.roomCode.set(code);
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

  // -- Broadcast game state to all peers --------------------------------
  broadcastState(state: GameState, myId?: string): void {
    const message: P2PMessage = { type: 'game-state', payload: state };
    this.connections.forEach(conn => {
      if (conn.open) conn.send(message);
    });
    // Save for potential reconnect
    if (myId) this.saveStateForReconnect(state, myId);
  }

  // -- Send a message to a specific peer --------------------------------
  sendTo(peerId: string, message: P2PMessage): void {
    const conn = this.connections.get(peerId);
    if (conn?.open) conn.send(message);
  }

  // -- Disconnect and clean up ------------------------------------------
  disconnect(): void {
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    this.status.set('disconnected');
    this.roomCode.set('');
    this.peers.set([]);
  }

  // -- Private helpers --------------------------------------------------
  private setupConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.peers.update(list => [...list, conn.peer]);

      this.broadcastMessage({
        type: 'player-joined',
        payload: { peerId: conn.peer }
      });
    });

    conn.on('data', (data: unknown) => {
      this.lastMessage.set(data as P2PMessage);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.peers.update(list => list.filter(id => id !== conn.peer));

      this.broadcastMessage({
        type: 'player-left',
        payload: { peerId: conn.peer }
      });
    });

    conn.on('error', err => {
      console.error('[PeerService] Connection error:', err);
      this.connections.delete(conn.peer);
    });
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