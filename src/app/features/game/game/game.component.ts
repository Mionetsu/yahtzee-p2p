import { Component, OnInit, OnDestroy, inject, signal, viewChild } from '@angular/core';
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
import { Router } from '@angular/router';
import { PlayerDisconnectedComponent } from '../components/player-disconnected/player-disconnected';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, DiceComponent, ScorecardComponent, CategoryOverlayComponent, OptionsMenuComponent, PlayersHudComponent, GameOverComponent, PlayerDisconnectedComponent],
  templateUrl: './game.html',
  styleUrl: './game.scss'
})
export class GameComponent implements OnInit, OnDestroy {
  private yahtzee  = inject(YahtzeeService);
  private peer     = inject(PeerService);
  private diceRef  = viewChild(DiceComponent);
  private audioCtx: AudioContext | null = null;
  private router   = inject(Router);
  private pollIntervals: ReturnType<typeof setInterval>[] = [];

  showDisconnected   = signal<boolean>(false);
  disconnectedPlayer = signal<string>('');

  readonly state     = this.yahtzee.state;
  readonly dice      = this.yahtzee.dice;
  readonly rollsLeft = this.yahtzee.rollsLeft;

  activeOverlay     = signal<ScoreCategory | null>(null);
  myPlayerId        = signal<string>('');
  isOverlayBlocking = signal<boolean>(false);
  gameOptions       = signal<GameOptions>({
    scorecardView: 'modern',
    soundEnabled: true,
    textSize: 'normal',
  });
  showGameOver  = signal<boolean>(false);
  scoreToast    = signal<string | null>(null);
  turnBanner    = signal<string | null>(null);

  get isMyTurn(): boolean {
    return this.state().currentPlayer === this.myPlayerId();
  }

  get currentPlayerObj(): Player | undefined {
    return this.state().players.find((p: Player) => p.id === this.state().currentPlayer);
  }

  get myPlayerObj(): Player | undefined {
    return this.state().players.find(p => p.id === this.myPlayerId());
  }

  get otherPlayersExcludeMe(): Player[] {
    return this.state().players.filter(p => p.id !== this.myPlayerId());
  }

  get otherPlayers(): Player[] {
    return this.state().players.filter((p: Player) => p.id !== this.state().currentPlayer);
  }

  get allPlayers(): Player[] {
    return this.state().players;
  }

  getPlayerTotal(player: Player): number {
    return this.yahtzee.grandTotal(player.scoreCard);
  }

  get canRoll(): boolean {
    return this.isMyTurn && this.rollsLeft() > 0 && !this.isOverlayBlocking();
  }

  get previews(): Partial<Record<ScoreCategory, number | null>> {
    if (!this.isMyTurn || this.rollsLeft() === 3) return {};
    const categories: ScoreCategory[] = [
      'ones','twos','threes','fours','fives','sixes',
      'threeOfAKind','fourOfAKind','fullHouse',
      'smallStraight','largeStraight','yahtzee','chance'
    ];
    return Object.fromEntries(
      categories.map(cat => [cat, this.yahtzee.previewScore(cat)])
    );
  }

  updateOptions(changes: Partial<GameOptions>): void {
    if (changes.exitGame) {
      this.peer.disconnect();
      this.audioCtx?.close();
      window.location.href = '/';
      return;
    }
    this.gameOptions.update(opts => ({ ...opts, ...changes }));
  }

  ngOnInit(): void {
    const myId = this.peer.myPeerId();

    if (this.state().phase === 'lobby' || !myId) {
      this.startDemoGame();
    } else {
      this.myPlayerId.set(myId);
    }

    this.watchPeerMessages();
    this.watchDisconnections();
    this.watchTurnChange();

    let bonusAlreadyShown = false;
    const bonusInterval = setInterval(() => {
      if (!this.isMyTurn) return;
      const player = this.state().players.find(p => p.id === this.myPlayerId());
      if (!player) return;
      const upper = ['ones','twos','threes','fours','fives','sixes']
        .reduce((sum, cat) => sum + (player.scoreCard[cat as ScoreCategory] ?? 0), 0);
      if (upper >= 63 && !bonusAlreadyShown && !this.isOverlayBlocking()) {
        bonusAlreadyShown = true;
        this.showBonusAnimation();
      }
    }, 500);
    this.pollIntervals.push(bonusInterval);
  }

  ngOnDestroy(): void {
    this.pollIntervals.forEach(id => clearInterval(id));
    this.peer.disconnect();
    this.audioCtx?.close();
  }

  rollDice(): void {
    if (!this.canRoll) return;
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
      if (this.isMyTurn) {
        this.checkForAchievedCategory();
      }
    }, 100);
  }

  toggleHold(dieId: number): void {
    if (!this.isMyTurn || this.rollsLeft() === 3 || this.isOverlayBlocking()) return;
    this.yahtzee.toggleHold(dieId);
    this.peer.broadcastState(this.state(), this.myPlayerId());
  }

  scoreCategory(category: ScoreCategory): void {
    if (!this.isMyTurn || this.isOverlayBlocking()) return;

    const playerName = this.myPlayerObj?.name ?? 'Player';

    this.isOverlayBlocking.set(false);
    this.activeOverlay.set(null);

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
    this.isOverlayBlocking.set(false);
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

  private watchPeerMessages(): void {
    let lastMessage = this.peer.lastMessage();
    const interval = setInterval(() => {
      const msg = this.peer.lastMessage();
      if (msg && msg !== lastMessage) {
        lastMessage = msg;

        if (msg.type === 'game-state') {
          const incoming = msg.payload as GameState;
          const prevRolls = this.state().rollsLeft;
          const newRolls  = incoming.rollsLeft;

          if (newRolls < prevRolls && !this.isMyTurn) {
            this.yahtzee.applyRemoteState(incoming);
            incoming.dice.forEach((die, i) => {
              if (!die.held) {
                setTimeout(() => this.diceRef()?.animateRoll(i), i * 80);
              }
            });
          } else {
            this.yahtzee.applyRemoteState(incoming);
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
          const newState = msg.payload as GameState;
          this.yahtzee.applyRemoteState(newState);
          this.showGameOver.set(false);
        }
      }
    }, 100);
    this.pollIntervals.push(interval);
  }

  private watchDisconnections(): void {
    let lastMsg = this.peer.lastMessage();
    const interval = setInterval(() => {
      const msg = this.peer.lastMessage();
      if (msg && msg !== lastMsg) {
        lastMsg = msg;
        if (msg.type === 'player-left') {
          const peerId = (msg.payload as any)?.peerId;
          const player = this.state().players.find(p => p.id === peerId);
          this.disconnectedPlayer.set(player?.name ?? 'A player');
          this.showDisconnected.set(true);
        }
      }
    }, 200);
    this.pollIntervals.push(interval);
  }

  private watchTurnChange(): void {
    let lastPlayer = this.state().currentPlayer;
    const interval = setInterval(() => {
      const current = this.state().currentPlayer;
      if (current !== lastPlayer) {
        lastPlayer = current;
        this.isOverlayBlocking.set(false);
        this.activeOverlay.set(null);
        const player = this.state().players.find(p => p.id === current);
        const label = current === this.myPlayerId() ? 'Your Turn!' : `${player?.name}'s Turn`;
        this.turnBanner.set(label);
        setTimeout(() => this.turnBanner.set(null), 2200);
      }
    }, 200);
    this.pollIntervals.push(interval);
  }

  private startDemoGame(): void {
    const me = this.yahtzee.createPlayer('player-1', 'You', true);
    this.myPlayerId.set('player-1');
    this.yahtzee.startGame([me], 'DEMO');
  }

  private showBonusAnimation(): void {
    setTimeout(() => {
      if (!this.isMyTurn) return;
      this.isOverlayBlocking.set(true);
      this.activeOverlay.set('bonus' as ScoreCategory);
      this.playBonusSound();
    }, 400);
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

  private checkForAchievedCategory(): void {
    if (!this.isMyTurn) return;
    const specialCategories: ScoreCategory[] = [
      'yahtzee', 'largeStraight', 'smallStraight',
      'fullHouse', 'fourOfAKind', 'threeOfAKind'
    ];
    for (const cat of specialCategories) {
      const alreadyScored = this.currentPlayerObj?.scoreCard[cat] !== null;
      if (alreadyScored) continue;
      const score = this.yahtzee.previewScore(cat);
      if (score !== null && score > 0) {
        setTimeout(() => {
          if (!this.isMyTurn) return;
          this.isOverlayBlocking.set(true);
          this.activeOverlay.set(cat);
          this.playAchievementSound(cat);
        }, 750);
        return;
      }
    }
  }

  private playScoreSound(category: ScoreCategory): void {
    if (!this.gameOptions().soundEnabled) return;
    const ctx  = this.getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type   = 'sine';
    osc.frequency.value = category === 'yahtzee' ? 880 : 660;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
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