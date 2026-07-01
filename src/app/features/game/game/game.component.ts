import { Component, OnInit, OnDestroy, inject, signal, viewChild, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { YahtzeeService } from '../../../core/services/yahtzee.service';
import { PeerService } from '../../../core/services/peer.service';
import { ScoreCategory, Player, GameState } from '../../../core/models';
import { DiceComponent } from '../components/dice/dice';
import { ScorecardComponent } from '../components/scorecard/scorecard';
import { CategoryOverlayComponent } from '../components/category-overlay/category-overlay';
import { OptionsMenuComponent, GameOptions } from '../components/options-menu/options-menu';
import { PlayersHudComponent } from '../components/players-hud/players-hud';
import { GameOverComponent } from '../components/game-over/game-over';
import { PlayerDisconnectedComponent } from '../components/player-disconnected/player-disconnected';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [
    CommonModule, DiceComponent, ScorecardComponent, CategoryOverlayComponent,
    OptionsMenuComponent, PlayersHudComponent, GameOverComponent, PlayerDisconnectedComponent
  ],
  templateUrl: './game.html',
  styleUrl: './game.scss'
})
export class GameComponent implements OnInit, OnDestroy {
  private yahtzee = inject(YahtzeeService);
  private peer    = inject(PeerService);
  private diceRef = viewChild(DiceComponent);
  private audioCtx: AudioContext | null = null;
  private pollIntervals: ReturnType<typeof setInterval>[] = [];

  showDisconnected   = signal<boolean>(false);
  disconnectedPlayer = signal<string>('');

  // Host migration: shown instead of the generic disconnect overlay when
  // the player who left was the host, since that case needs an automatic
  // recovery flow rather than a "wait for them" timer.
  showHostMigration  = signal<boolean>(false);
  migrationMessage   = signal<string>('');

  // Set once after this client becomes the new host, so we can show the
  // "share this code" banner. null hides it.
  newHostCode    = signal<string | null>(null);
  roomCodeCopied = signal<boolean>(false);
  private copyResetTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly state     = this.yahtzee.state;
  readonly dice      = this.yahtzee.dice;
  readonly rollsLeft = this.yahtzee.rollsLeft;

  myPlayerId    = signal<string>('');
  activeOverlay = signal<ScoreCategory | null>(null);
  showGameOver  = signal<boolean>(false);
  scoreToast    = signal<string | null>(null);
  turnBanner    = signal<string | null>(null);

  readonly isOverlayBlocking = computed(() => this.activeOverlay() !== null);

  gameOptions = signal<GameOptions>({
    scorecardView: 'modern',
    soundEnabled: true,
    textSize: 'normal',
  });

  // ── Computed signals ───────────────────────────────────────────────────────

  readonly isMyTurn = computed(() =>
    this.state().currentPlayer === this.myPlayerId()
  );

  readonly currentPlayerObj = computed(() =>
    this.state().players.find(p => p.id === this.state().currentPlayer)
  );

  readonly myPlayerObj = computed(() =>
    this.state().players.find(p => p.id === this.myPlayerId())
  );

  readonly otherPlayersExcludeMe = computed(() =>
    this.state().players.filter(p => p.id !== this.myPlayerId())
  );

  readonly canRoll = computed(() =>
    this.isMyTurn() && this.rollsLeft() > 0 && !this.isOverlayBlocking()
  );

  readonly previews = computed((): Partial<Record<ScoreCategory, number | null>> => {
    if (!this.isMyTurn() || this.rollsLeft() === 3) return {};
    const categories: ScoreCategory[] = [
      'ones','twos','threes','fours','fives','sixes',
      'threeOfAKind','fourOfAKind','fullHouse',
      'smallStraight','largeStraight','yahtzee','chance'
    ];
    return Object.fromEntries(
      categories.map(cat => [cat, this.yahtzee.previewScore(cat)])
    );
  });

  // ── Options ────────────────────────────────────────────────────────────────

  updateOptions(changes: Partial<GameOptions>): void {
    if (changes.exitGame) {
      this.peer.disconnect();
      this.audioCtx?.close();
      window.location.href = '/';
      return;
    }
    this.gameOptions.update(opts => ({ ...opts, ...changes }));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.initMyPlayer();

    this.watchPeerMessages();
    this.watchDisconnections();
    this.watchTurnChange();

    let bonusAlreadyShown = false;
    const bonusInterval = setInterval(() => {
      if (!this.isMyTurn()) return;
      const player = this.state().players.find(p => p.id === this.myPlayerId());
      if (!player) return;
      const upper = (['ones','twos','threes','fours','fives','sixes'] as ScoreCategory[])
        .reduce((sum, cat) => sum + (player.scoreCard[cat] ?? 0), 0);
      if (upper >= 63 && !bonusAlreadyShown && !this.isOverlayBlocking()) {
        bonusAlreadyShown = true;
        this.showBonusAnimation();
      }
    }, 500);
    this.pollIntervals.push(bonusInterval);
  }

  ngOnDestroy(): void {
    this.pollIntervals.forEach(id => clearInterval(id));
    if (this.copyResetTimeout) clearTimeout(this.copyResetTimeout);
    this.peer.disconnect();
    this.audioCtx?.close();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  rollDice(): void {
    if (!this.canRoll()) return;
    const isLastRoll = this.rollsLeft() === 1;

    if (this.gameOptions().soundEnabled) {
      isLastRoll ? this.playLastRollSound() : this.playRollSound();
    }

    this.dice().forEach((die, i) => {
      if (!die.held) {
        setTimeout(() => this.diceRef()?.animateRoll(i), i * 80);
      }
    });

    setTimeout(() => {
      this.yahtzee.rollDice();
      this.peer.broadcastState(this.state(), this.myPlayerId());
      this.checkForAchievedCategory();
    }, 100);
  }

  toggleHold(dieId: number): void {
    if (!this.isMyTurn() || this.rollsLeft() === 3 || this.isOverlayBlocking()) return;
    this.yahtzee.toggleHold(dieId);
    this.peer.broadcastState(this.state(), this.myPlayerId());
  }

  scoreCategory(category: ScoreCategory): void {
    if (!this.isMyTurn()) return;
    this.activeOverlay.set(null);

    const playerName = this.myPlayerObj()?.name ?? 'Player';

    this.yahtzee.scoreCategory(this.myPlayerId(), category);

    const finalState = this.yahtzee.state();
    const isFinished = finalState.phase === 'finished';

    this.peer.broadcastState(finalState, this.myPlayerId());

    this.peer.broadcastMessage({
      type: 'score-event' as any,
      payload: { category, playerName }
    });

    this.diceRef()?.resetAllWrappers();
    this.showScoreToast(category, playerName);
    this.playScoreSound(category);

    if (isFinished) {
      this.peer.clearReconnectData();
      this.peer.broadcastMessage({
        type: 'game-over' as any,
        payload: finalState
      });
      setTimeout(() => {
        this.showGameOver.set(true);
        this.playGameOverSound();
      }, 400);
    }
  }

  onOverlayDismissed(): void {
    this.activeOverlay.set(null);
  }

  onContinueWaiting(): void {}

  onEndGameAfterDisconnect(): void {
    this.showDisconnected.set(false);
    this.showGameOver.set(true);
    this.playGameOverSound();
  }

  onPlayAgain(): void {
    const currentPlayers = this.state().players;
    const resetPlayers = currentPlayers.map(p =>
      this.yahtzee.createPlayer(p.id, p.name, p.isHost, p.avatarColor, p.avatarImage)
    );
    this.yahtzee.startGame(resetPlayers, this.state().roomCode);
    this.showGameOver.set(false);

    this.peer.broadcastMessage({
      type: 'play-again' as any,
      payload: this.yahtzee.state()
    });
  }

  onExitToLobby(): void {
    this.showGameOver.set(false);
    this.peer.clearReconnectData();
    this.peer.disconnect();
    window.location.href = '/';
  }

  // ── P2P watchers ───────────────────────────────────────────────────────────

  private watchPeerMessages(): void {
    const interval = setInterval(() => {
      // Drain the full queue every tick — never miss a message even if
      // multiple arrive within the same 100ms poll window
      const messages = this.peer.messageQueue.dequeueAll();
      for (const msg of messages) {
        this.handlePeerMessage(msg);
      }
    }, 100);
    this.pollIntervals.push(interval);
  }

  private handlePeerMessage(msg: any): void {
    if (msg.type === 'game-state') {
      const incoming     = msg.payload as GameState;
      const prevRolls     = this.state().rollsLeft;
      const prevTurn       = this.state().turn;
      const prevPlayer     = this.state().currentPlayer;
      const newRolls       = incoming.rollsLeft;
      const newTurn         = incoming.turn;
      const newPlayer       = incoming.currentPlayer;

      const samePlayerTurn = newPlayer === prevPlayer;

      const wasRemoteRoll = newRolls < prevRolls && samePlayerTurn && !this.isMyTurn();
      // A "player change" happened if either the round advanced OR the
      // active player id changed (covers same-round player-to-player handoff).
      const wasPlayerChange = newTurn > prevTurn || newPlayer !== prevPlayer;

      // Accept if the round is newer, OR same round but it's a fresh turn for
      // a different player (rollsLeft reset to 3), OR same round/player with
      // rollsLeft that didn't increase (a normal roll).
      const shouldAccept =
        newTurn > prevTurn ||
        (newTurn === prevTurn && newPlayer !== prevPlayer) ||
        (newTurn === prevTurn && newPlayer === prevPlayer && newRolls <= prevRolls);

      if (shouldAccept) {
        this.yahtzee.applyRemoteState(incoming);
      }

      if (wasRemoteRoll) {
        incoming.dice.forEach((die, i) => {
          if (!die.held) {
            setTimeout(() => this.diceRef()?.animateRoll(i), i * 80);
          }
        });
      }

      if (wasPlayerChange) {
        this.diceRef()?.resetAllWrappers();
      }
    }

    if ((msg.type as string) === 'score-event') {
      const { category, playerName } = msg.payload as any;
      this.showScoreToast(category, playerName);
      if (this.gameOptions().soundEnabled) {
        this.playScoreSound(category);
      }
    }

    if ((msg.type as string) === 'game-over') {
      this.yahtzee.applyRemoteState(msg.payload as GameState);
      setTimeout(() => {
        this.showGameOver.set(true);
        this.playGameOverSound();
      }, 400);
    }

    if ((msg.type as string) === 'play-again') {
      this.yahtzee.applyRemoteState(msg.payload as GameState);
      this.showGameOver.set(false);
    }

    // The mid-game rejoin handshake (matching a returning player to their seat) now happens entirely in PeerService.handleMidGameJoin, whichreplies with 'rejoin-accepted' — handled below arrives while we (the host) are already mounted on /game, and the case where WE are the one rejoining and this message reaches us after GameComponent has already initialized (e.g. via the automatic reconnect banner, which navigates to /game before the host replies).
    if ((msg.type as string) === 'rejoin-accepted') {
      const { state, playerId } = msg.payload as { state: GameState; playerId: string };
      this.yahtzee.applyRemoteState(state);
      if (playerId) this.myPlayerId.set(playerId);
      this.showHostMigration.set(false);
    }

    if ((msg.type as string) === 'player-rejoined') {
      const { name } = msg.payload as { playerId: string; name: string };
      if (this.showDisconnected() && this.disconnectedPlayer() === name) {
        this.showDisconnected.set(false);
      }
    }

    if (msg.type === 'player-left') {
      const peerId = (msg.payload as any)?.peerId;
      const player = this.state().players.find((p: any) => p.id === peerId);

      if (player?.isHost) {
        this.beginHostMigration();
        return;
      }

      this.disconnectedPlayer.set(player?.name ?? 'A player');
      this.showDisconnected.set(true);
    }
  }

  // ── Host migration ─────────────────────────────────────────────────────────
  // Star topology: guests only connect to the host, never to each other. So
  // when the host disappears, every remaining player loses their only
  // connection at the same instant and has no channel left to negotiate who
  // takes over. We avoid needing one: the heir is always "the first
  // non-host player in state.players", which every client already agrees on
  // because it comes from the synced game state. The new room code is
  // derived deterministically from the heir's player id (peer.deriveMigrationCode),
  // so every client computes the identical "YTZ-XXXX" code independently —
  // same short format as a normal room, no manual sharing required — and
  // everyone else just reconnects to that code, reusing the exact
  // rejoin-accepted handshake from the normal reconnect flow.

  private beginHostMigration(): void {
    if (this.showHostMigration()) return;

    this.showDisconnected.set(false);
    this.showHostMigration.set(true);

    const heir = this.state().players.find(p => !p.isHost);

    if (!heir) {
      this.migrationMessage.set('El host se desconectó y no queda nadie más para tomar su lugar.');
      return;
    }

    const migrationCode = this.peer.deriveMigrationCode(heir.id);

    if (this.myPlayerId() === heir.id) {
      this.becomeNewHost(heir.id, migrationCode);
    } else {
      this.migrationMessage.set(`El host se desconectó. Reconectando a través de ${heir.name}…`);
      // Give the heir a moment to finish standing up their new room
      // before we try to connect to it.
      setTimeout(() => this.reconnectThroughNewHost(migrationCode), 1500);
    }
  }

  private async becomeNewHost(myId: string, migrationCode: string): Promise<void> {
    this.migrationMessage.set('El host se desconectó. Tomando el control de la partida…');
    try {
      // Update isHost locally before anyone reconnects, so the state we hand
      // out via rejoin-accepted already reflects who's in charge now. Note:
      // myId (the player's identity in state.players) and migrationCode
      // (the new PeerJS room address) are deliberately different values —
      // decoupling them is what lets the room code stay in the short
      // YTZ-XXXX format instead of exposing the player's raw peer id.
      const updated: GameState = {
        ...this.state(),
        players: this.state().players.map(p => ({ ...p, isHost: p.id === myId })),
        roomCode: migrationCode
      };
      this.yahtzee.applyRemoteState(updated);

      await this.peer.createRoom(migrationCode);
      this.showHostMigration.set(false);
      this.newHostCode.set(migrationCode);
    } catch {
      this.migrationMessage.set('No se pudo tomar el control de la partida. Intenta recargar la página.');
    }
  }

  copyRoomCode(): void {
    navigator.clipboard.writeText(this.state().roomCode).then(() => {
      this.roomCodeCopied.set(true);
      if (this.copyResetTimeout) clearTimeout(this.copyResetTimeout);
      this.copyResetTimeout = setTimeout(() => this.roomCodeCopied.set(false), 2000);
    }).catch(() => {});
  }

  dismissNewHostBanner(): void {
    this.newHostCode.set(null);
  }

  private async reconnectThroughNewHost(newHostRoomCode: string, attempt = 1): Promise<void> {
    try {
      await this.peer.joinRoom(newHostRoomCode);
      this.peer.broadcastMessage({
        type: 'player-joined',
        payload: {
          peerId:      this.peer.myPeerId(),
          nickname:    this.myPlayerObj()?.name ?? 'Player',
          avatarColor: this.myPlayerObj()?.avatarColor ?? '#AEC6FF',
          avatarImage: this.myPlayerObj()?.avatarImage,
          originalId:  this.myPlayerId()
        }
      });
      // showHostMigration clears once 'rejoin-accepted' arrives, above.
    } catch {
      if (attempt < 5) {
        setTimeout(() => this.reconnectThroughNewHost(newHostRoomCode, attempt + 1), 1500);
      } else {
        this.migrationMessage.set('No se pudo reconectar con el nuevo host.');
      }
    }
  }

  onEndGameAfterMigration(): void {
    this.showHostMigration.set(false);
    this.showGameOver.set(true);
    this.playGameOverSound();
  }


  private watchDisconnections(): void {
    // player-left is now handled inside handlePeerMessage via the message queue
  }

  private watchTurnChange(): void {
    let lastPlayer = this.state().currentPlayer;
    const interval = setInterval(() => {
      const current = this.state().currentPlayer;
      if (current !== lastPlayer) {
        lastPlayer = current;
        this.activeOverlay.set(null);
        const player = this.state().players.find(p => p.id === current);
        const label = current === this.myPlayerId() ? 'Your Turn!' : `${player?.name}'s Turn`;
        this.turnBanner.set(label);
        setTimeout(() => this.turnBanner.set(null), 2200);
      }
    }, 200);
    this.pollIntervals.push(interval);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private initMyPlayer(): void {
    // Check if we're coming back from a reconnect — use the original player ID
    const reconnectOriginalId = sessionStorage.getItem('yahtzee_reconnect_original_id');
    if (reconnectOriginalId) {
      sessionStorage.removeItem('yahtzee_reconnect_original_id');
      if (this.state().players.some(p => p.id === reconnectOriginalId)) {
        this.myPlayerId.set(reconnectOriginalId);
        return;
      }
    }

    const myId = this.peer.myPeerId();

    if (myId && this.state().phase !== 'lobby' &&
        this.state().players.some(p => p.id === myId)) {
      this.myPlayerId.set(myId);
    } else if (myId && this.state().phase !== 'lobby') {
      const retryInterval = setInterval(() => {
        const id = this.peer.myPeerId();
        if (id && this.state().players.some(p => p.id === id)) {
          this.myPlayerId.set(id);
          clearInterval(retryInterval);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(retryInterval);
        if (!this.myPlayerId()) this.startDemoGame();
      }, 3000);
    } else {
      this.startDemoGame();
    }
  }

  private startDemoGame(): void {
    const me = this.yahtzee.createPlayer('player-1', 'You', true);
    this.myPlayerId.set('player-1');
    this.yahtzee.startGame([me], 'DEMO');
  }

  private showBonusAnimation(): void {
    setTimeout(() => {
      if (!this.isMyTurn()) return;
      this.activeOverlay.set('bonus' as ScoreCategory);
      this.playBonusSound();
    }, 400);
  }

  private checkForAchievedCategory(): void {
    if (!this.isMyTurn()) return;
    const specialCategories: ScoreCategory[] = [
      'yahtzee', 'largeStraight', 'smallStraight',
      'fullHouse', 'fourOfAKind', 'threeOfAKind'
    ];
    for (const cat of specialCategories) {
      const alreadyScored = this.currentPlayerObj()?.scoreCard[cat] !== null;
      if (alreadyScored) continue;
      const score = this.yahtzee.previewScore(cat);
      if (score !== null && score > 0) {
        setTimeout(() => {
          if (!this.isMyTurn() || this.activeOverlay() !== null) return;
          this.activeOverlay.set(cat);
          this.playAchievementSound(cat);
        }, 750);
        return;
      }
    }
  }

  private showScoreToast(category: ScoreCategory, playerName: string): void {
    const labels: Partial<Record<ScoreCategory, string>> = {
      ones: 'Aces', twos: 'Deuces', threes: 'Threes',
      fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
      threeOfAKind: '3 of a Kind', fourOfAKind: '4 of a Kind',
      fullHouse: 'Full House', smallStraight: 'S. Straight',
      largeStraight: 'L. Straight', yahtzee: 'Yahtzee!', chance: 'Chance',
    };
    this.scoreToast.set(`${playerName}: ${labels[category] ?? category}`);
    setTimeout(() => this.scoreToast.set(null), 2500);
  }

  // ── Audio ──────────────────────────────────────────────────────────────────

  private playScoreSound(category: ScoreCategory): void {
    if (!this.gameOptions().soundEnabled) return;
    const ctx  = this.getAudioCtx();
    const notes = category === 'yahtzee' ? [523, 659, 784, 1047] : [523, 659];
    notes.forEach((freq, i) => {
      setTimeout(() => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type   = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }, i * 100);
    });
  }

  private playRollSound(): void {
    const ctx   = this.getAudioCtx();
    const count = 6;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const buf  = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * 0.3;
        const src    = ctx.createBufferSource();
        src.buffer   = buf;
        const filter       = ctx.createBiquadFilter();
        filter.type        = 'bandpass';
        filter.frequency.value = 800 + Math.random() * 400;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start();
      }, i * 90);
    }
  }

  private playLastRollSound(): void {
    const ctx = this.getAudioCtx();
    this.playRollSound();
    setTimeout(() => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type   = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }, 550);
  }

  private playAchievementSound(category: ScoreCategory): void {
    if (!this.gameOptions().soundEnabled) return;
    const ctx = this.getAudioCtx();
    if (category === 'yahtzee') {
      [523, 784, 1047, 1319, 1047, 784, 1047, 1319].forEach((freq, i) => {
        setTimeout(() => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type   = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.6);
        }, i * 100);
      });
      setTimeout(() => {
        [523, 659, 784].forEach(freq => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type   = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 1.2);
        });
      }, 800);
      return;
    }
    const freqMap: Partial<Record<ScoreCategory, number[]>> = {
      largeStraight: [659, 880], smallStraight: [587, 740],
      fullHouse: [523, 659], fourOfAKind: [494, 622], threeOfAKind: [440, 554],
    };
    const freqs = freqMap[category] ?? [523, 659];
    freqs.forEach((freq, i) => {
      setTimeout(() => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type   = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }, i * 150);
    });
  }

  private playBonusSound(): void {
    if (!this.gameOptions().soundEnabled) return;
    const ctx = this.getAudioCtx();
    const notes = [523, 659, 784, 659, 1047];
    notes.forEach((freq, i) => {
      setTimeout(() => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type   = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }, i * 100);
    });
  }

  private playGameOverSound(): void {
    if (!this.gameOptions().soundEnabled) return;
    const ctx = this.getAudioCtx();
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((freq, i) => {
      setTimeout(() => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type   = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }, i * 150);
    });
  }

  private getAudioCtx(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }
}