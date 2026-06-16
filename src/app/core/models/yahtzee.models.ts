export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export interface Die {
  id: number;
  value: DieValue;
  held: boolean;
  rolling: boolean;
}

export type ScoreCategory =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'
  | 'threeOfAKind' | 'fourOfAKind' | 'fullHouse'
  | 'smallStraight' | 'largeStraight' | 'yahtzee' | 'chance';

export interface ScoreCard {
  ones:          number | null;
  twos:          number | null;
  threes:        number | null;
  fours:         number | null;
  fives:         number | null;
  sixes:         number | null;
  threeOfAKind:  number | null;
  fourOfAKind:   number | null;
  fullHouse:     number | null;
  smallStraight: number | null;
  largeStraight: number | null;
  yahtzee:       number | null;
  chance:        number | null;
}

export type AvatarColor =
  | '#FF9AA2' | '#FFB347' | '#FDFD96' | '#B5EAD7'
  | '#9DE0F6' | '#AEC6FF' | '#C3B1E1' | '#F7C5E0';

export interface Player {
  id: string;
  name: string;
  scoreCard: ScoreCard;
  isHost: boolean;
  isConnected: boolean;
  avatarColor: AvatarColor;
  avatarImage?: string; // base64
}

export type GamePhase = 'lobby' | 'playing' | 'finished';

export interface GameState {
  players:       Player[];
  currentPlayer: string;   // player id
  dice:          Die[];
  rollsLeft:     number;   // 3 rolls per turn
  turn:          number;
  phase:         GamePhase;
  roomCode:      string;
}