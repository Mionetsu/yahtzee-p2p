
import { Injectable, signal, computed } from '@angular/core';
import { Die, DieValue, GameState, GamePhase, Player, ScoreCard, ScoreCategory, AvatarColor } from '../models';

const EMPTY_SCORECARD: ScoreCard = {
  ones: null, twos: null, threes: null,
  fours: null, fives: null, sixes: null,
  threeOfAKind: null, fourOfAKind: null,
  fullHouse: null, smallStraight: null,
  largeStraight: null, yahtzee: null, chance: null
};

@Injectable({ providedIn: 'root' })
export class YahtzeeService {

  // ── Reactive state with signals ──────────────────────────────────────
  private _state = signal<GameState>({
    players: [],
    currentPlayer: '',
    dice: this.createDice(),
    rollsLeft: 3,
    turn: 1,
    phase: 'lobby',
    roomCode: ''
  });

  readonly state    = this._state.asReadonly();
  readonly dice     = computed(() => this._state().dice);
  readonly rollsLeft = computed(() => this._state().rollsLeft);
  readonly currentPlayer = computed(() =>
    this._state().players.find(p => p.id === this._state().currentPlayer)
  );
  readonly isMyTurn = (myId: string) =>
    computed(() => this._state().currentPlayer === myId);
  readonly upperSectionTotal = (scoreCard: ScoreCard) =>
    (['ones','twos','threes','fours','fives','sixes'] as ScoreCategory[])
      .reduce((sum, cat) => sum + (scoreCard[cat] ?? 0), 0);
  readonly bonus = (scoreCard: ScoreCard) =>
    this.upperSectionTotal(scoreCard) >= 63 ? 35 : 0;
  readonly grandTotal = (scoreCard: ScoreCard) => {
    const upper = this.upperSectionTotal(scoreCard);
    const lower = (['threeOfAKind','fourOfAKind','fullHouse',
                    'smallStraight','largeStraight','yahtzee','chance'] as ScoreCategory[])
      .reduce((sum, cat) => sum + (scoreCard[cat] ?? 0), 0);
    return upper + this.bonus(scoreCard) + lower;
  };

  // ── Create player ────────────────────────────────────────────────────
  createPlayer(
    id: string,
    name: string,
    isHost = false,
    avatarColor: AvatarColor = '#AEC6FF',
    avatarImage?: string
  ): Player {
    return {
      id, name, isHost, isConnected: true,
      scoreCard: { ...EMPTY_SCORECARD },
      avatarColor,
      avatarImage
    };
  }

  // ── Start game ──────────────────────────────────────────────────────
  startGame(players: Player[], roomCode: string): void {
    this._state.set({
      players,
      currentPlayer: players[0].id,
      dice: this.createDice(),
      rollsLeft: 3,
      turn: 1,
      phase: 'playing',
      roomCode
    });
  }

  // ── Roll dice ──────────────────────────────────────────────────────
  rollDice(): void {
    const { rollsLeft, dice } = this._state();
    if (rollsLeft <= 0) return;

    this._state.update(s => ({
      ...s,
      rollsLeft: s.rollsLeft - 1,
      dice: s.dice.map(d =>
        d.held ? d : { ...d, value: this.randomDie(), rolling: true }
      )
    }));

    // Turn off rolling animation after 600ms
    setTimeout(() => {
      this._state.update(s => ({
        ...s,
        dice: s.dice.map(d => ({ ...d, rolling: false }))
      }));
    }, 600);
  }

  // ── Hold / Throw a dice ─────────────────────────────────────────
  toggleHold(dieId: number): void {
    const { rollsLeft } = this._state();
    if (rollsLeft === 3) return; // no se puede retener antes de tirar
    this._state.update(s => ({
      ...s,
      dice: s.dice.map(d =>
        d.id === dieId ? { ...d, held: !d.held } : d
      )
    }));
  }

  // ── Score a category ───────────────────────────────────────────────────
  scoreCategory(playerId: string, category: ScoreCategory): void {
    const { dice, rollsLeft } = this._state();
    if (rollsLeft === 3) return; // debe tirar al menos una vez

    const values = dice.map(d => d.value);
    const score  = this.calculateScore(category, values);

    this._state.update(s => ({
      ...s,
      players: s.players.map(p =>
        p.id !== playerId ? p : {
          ...p,
          scoreCard: { ...p.scoreCard, [category]: score }
        }
      )
    }));

    this.nextTurn();
  }

  // ── Calculate score for a category ───────────────────────────────────
  calculateScore(category: ScoreCategory, values: DieValue[]): number {
    const sum  = (vals: number[]) => vals.reduce((a, b) => a + b, 0);
    const freq = (v: number)      => values.filter(x => x === v).length;
    const counts = [1,2,3,4,5,6].map(freq);
    const hasN   = (n: number)    => counts.some(c => c >= n);

    switch (category) {
      case 'ones':   return freq(1) * 1;
      case 'twos':   return freq(2) * 2;
      case 'threes': return freq(3) * 3;
      case 'fours':  return freq(4) * 4;
      case 'fives':  return freq(5) * 5;
      case 'sixes':  return freq(6) * 6;

      case 'threeOfAKind': return hasN(3) ? sum(values) : 0;
      case 'fourOfAKind':  return hasN(4) ? sum(values) : 0;
      case 'fullHouse':
        return (counts.includes(3) && counts.includes(2)) ? 25 : 0;

      case 'smallStraight': {
        const unique = [...new Set(values)].sort().join('');
        return ['1234','2345','3456','12345','23456','123456']
          .some(s => unique.includes(s)) ? 30 : 0;
      }
      case 'largeStraight': {
        const unique = [...new Set(values)].sort().join('');
        return unique === '12345' || unique === '23456' ? 40 : 0;
      }
      case 'yahtzee': return hasN(5) ? 50 : 0;
      case 'chance':  return sum(values);

      default: return 0;
    }
  }

  // ── Preview Score (To show before scoring) ─
  previewScore(category: ScoreCategory): number | null {
    const { rollsLeft, dice } = this._state();
    if (rollsLeft === 3) return null;
    return this.calculateScore(category, dice.map(d => d.value));
  }

  // ── Apply remote state (comes from P2P) ────────────────────────────
  applyRemoteState(remoteState: GameState): void {
    this._state.set(remoteState);
  }

  // ── Helpers private ─────────────────────────────────────────────────
  private createDice(): Die[] {
    return Array.from({ length: 5 }, (_, i) => ({
      id: i,
      value: this.randomDie(),
      held: false,
      rolling: false
    }));
  }

  private randomDie(): DieValue {
    return (Math.floor(Math.random() * 6) + 1) as DieValue;
  }

  private nextTurn(): void {
    this._state.update(s => {
      const idx     = s.players.findIndex(p => p.id === s.currentPlayer);
      const nextIdx = (idx + 1) % s.players.length;
      const nextId  = s.players[nextIdx].id;

      // Verificar si el juego terminó (todos tienen scorecard lleno)
      const gameOver = s.players.every(p =>
        Object.values(p.scoreCard).every(v => v !== null)
      );

      return {
        ...s,
        currentPlayer: gameOver ? s.currentPlayer : nextId,
        dice: this.createDice(),
        rollsLeft: 3,
        turn: s.turn + 1,
        phase: gameOver ? 'finished' : 'playing'
      };
    });
  }
}