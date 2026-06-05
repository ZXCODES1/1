import type { PlayerState, Perks, GamePhase, GameSettings } from './types';

const HS_KEY = 'voidprotocol_highscore';

function loadHighScore(): number {
  return parseInt(localStorage.getItem(HS_KEY) ?? '0', 10) || 0;
}

export function saveHighScore(score: number): void {
  const prev = loadHighScore();
  if (score > prev) localStorage.setItem(HS_KEY, String(score));
}

export interface GameState {
  player: PlayerState;
  perks: Perks;
  phase: GamePhase;
  settings: GameSettings;
  screenShake: number;
  /** transient upward view recoil applied on top of player pitch, decays each tick */
  camKick: number;
  scoreMultiplier: number;
  killStreak: number;
  lastKillTime: number;
  damageBoostUntil: number;
  nukeStock: number;
  /** elapsed game ticks since wave cleared, used to gate next wave */
  waveIdleTimer: number;
}

export function createGameState(): GameState {
  return {
    player: {
      health: 100,
      maxHealth: 100,
      ammo: 12,
      score: 0,
      highScore: loadHighScore(),
      cash: 0,
      wave: 1,
      alive: true,
      velY: 0,
      onGround: true,
      reloading: false,
    },
    perks: {
      maxHealthLvl: 0,
      dmgReductLvl: 0,
      fireRateLvl: 0,
      magLvl: 0,
    },
    phase: 'menu',
    settings: {
      volume: 0.5,
      sensitivity: 5,
      quality: 'medium',
    },
    screenShake: 0,
    camKick: 0,
    scoreMultiplier: 1,
    killStreak: 0,
    lastKillTime: 0,
    damageBoostUntil: 0,
    nukeStock: 0,
    waveIdleTimer: 0,
  };
}
