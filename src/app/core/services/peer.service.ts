import { Injectable, inject, signal } from '@angular/core';
import Peer, { DataConnection } from 'peerjs';
import { GameState } from '../models';
import { YahtzeeService } from './yahtzee.service';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface P2PMessage {
  type: 'game-state' | 'player-joined' | 'player-left' | 'chat' | 'start-game'
      | 'score-event' | 'game-over' | 'play-again'
      | 'rejoin-accepted' | 'rejoin-rejected' | 'player-rejoined';
  payload: unknown;
}

@Injectable({ providedIn: 'root' })
export class PeerService {

  private yahtzee = inject(YahtzeeService);

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

  // NOTE: localStorage is shared across every tab of the same browser origin.
  // If we used flat keys here, opening 2-3 tabs to test (host + guests) means
  // EVERY player's broadcastState() call (roll/hold/score) overwrites the same
  // 3 keys with whoever acted last — so a disconnected player reading this data
  // back gets someone else's myId/state, and the host rejects them or matches
  // them to the wrong seat. We namespace by a per-tab session id (sessionStorage
  // is NOT shared across tabs, only persists within the same tab) so each tab's
  // reconnect data stays isolated, while still surviving a page reload (F5) of
  // that same tab.
  private readonly TAB_SESSION_KEY = 'yahtzee_tab_session_id';

  private get STATE_KEY(): string { return `yahtzee_last_state::${this.getTabSessionId()}`; }
  private get ROOM_KEY():  string { return `yahtzee_last_room::${this.getTabSessionId()}`; }
  private get ID_KEY():    string { return `yahtzee_peer_id::${this.getTabSessionId()}`; }

  private getTabSessionId(): string {
    let id = sessionStorage.getItem(this.TAB_SESSION_KEY);
    if (!id) {
      id = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(this.TAB_SESSION_KEY, id);
    }
    return id;
  }

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

  // forceId lets a promoted player become host using their own original
  // player id as the room code (used for host migration — see promoteAndOpenRoom
  // below). Without it, behaves exactly as before: a fresh random code.
  createRoom(forceId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // A migrating heir already has a (now-dead) Peer instance from being a
      // guest. Tear it down first so we don't leak the old WS connection or
      // collide with stale connection entries.
      this.teardownPeerForMigration();

      const code = forceId ?? this.generateRoomCode();
      this.status.set('connecting');
      this.isHost.set(true);

      // DEV: comment out for production
      this.peer = new Peer(code, { host: 'localhost', port: 9000, path: '/' });
      // PROD: uncomment for production
      //this.peer = new Peer(code);

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
      // Same cleanup as above — relevant when a surviving guest is
      // reconnecting to a newly-promoted host after the original host died.
      this.teardownPeerForMigration();

      this.status.set('connecting');
      this.isHost.set(false);

      // DEV: comment out for production
      this.peer = new Peer('', { host: 'localhost', port: 9000, path: '/' });
      // PROD: uncomment for production
      //this.peer = new Peer();

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

        if (msg.type === 'player-joined') {
          this.handleMidGameJoin(conn, msg.payload);
        }
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

  // Tears down whatever Peer/connections we currently hold without touching
  // status/roomCode/etc — used right before createRoom()/joinRoom() build a
  // fresh Peer during host migration, so we don't leak the dead one.
  private teardownPeerForMigration(): void {
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    this.peers.set([]);
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

  // Used for host migration. Unlike generateRoomCode() (random, only the
  // creator knows it until they share it), this is DETERMINISTIC: every
  // client independently computes the exact same "YTZ-XXXX" code from the
  // heir's player id, which is already present in the synced game state.
  // That's what lets everyone reconnect automatically after a host
  // disconnects, with no channel available to broadcast a fresh code —
  // while still keeping the familiar short format instead of exposing the
  // heir's raw (UUID-shaped) PeerJS id as the room code.
  deriveMigrationCode(seed: string): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    let code = '';
    for (let i = 0; i < 4; i++) {
      hash = Math.imul(hash ^ (hash >>> 15), 0x2545f491) ^ i;
      code += chars[Math.abs(hash) % chars.length];
    }
    return 'YTZ-' + code;
  }

  // Called whenever a peer sends 'player-joined', host-side only.
  // If a game is already in progress, this is the ONLY place that decides whether the joining peer is someone reclaiming an existing seat (matched by originalId, then by nickname) or a stranger trying to join a game that's already underway. This runs regardless of which route/component the host currently has mounted, so it works whether the disconnected player comes back through the automatic reconnect banner or through a manual "Join Room".
  private handleMidGameJoin(conn: DataConnection, payload: unknown): void {
    const state = this.yahtzee.state();
    if (state.phase === 'lobby') return;

    const p = payload as { originalId?: string; nickname?: string } | null;
    const originalId = p?.originalId;
    const nickname   = p?.nickname?.trim().toLowerCase();

    let match = originalId
      ? state.players.find(pl => pl.id === originalId)
      : undefined;

    if (!match && nickname) {
      match = state.players.find(pl => pl.name.trim().toLowerCase() === nickname);
    }

    if (match) {
      conn.send({
        type: 'rejoin-accepted',
        payload: { state, playerId: match.id }
      } as P2PMessage);

      const rejoinedMsg: P2PMessage = {
        type: 'player-rejoined',
        payload: { playerId: match.id, name: match.name }
      };

      // Let everyone else know this player is back, so any
      // "waiting for player to reconnect" overlay can clear.
      this.connections.forEach((c, peerId) => {
        if (peerId !== conn.peer && c.open) {
          c.send(rejoinedMsg);
        }
      });

      // c.send() only reaches remote peers — the host never gets its own
      // outbound messages echoed back to it. Without this, the host's own
      // GameComponent never learns the player came back (this is especially
      // visible in 2-player games, where the forEach above has nobody left
      // to send to once the rejoining peer is excluded), so its "Connection
      // Lost" overlay stays stuck even though everyone else is already
      // playing normally.
      this.lastMessage.set(rejoinedMsg);
      this._messageQueue.push(rejoinedMsg);
    } else {
      conn.send({
        type: 'rejoin-rejected',
        payload: { reason: 'La partida ya está en curso y no hay un lugar para ti.' }
      } as P2PMessage);
    }
  }

  
}