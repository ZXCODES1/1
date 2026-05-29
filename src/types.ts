import * as THREE from 'three';

export interface PlayerState {
  health: number;
  maxHealth: number;
  ammo: number;
  score: number;
  highScore: number;
  cash: number;
  wave: number;
  alive: boolean;
  velY: number;
  onGround: boolean;
  reloading: boolean;
}

export interface WeaponDef {
  name: string;
  /** kills required to reach next weapon level */
  kills: number;
  damage: number;
  fireRate: number;
  ammo: number;
  spread: number;
  speed: number;
  bullets: number;
  color: number;
  barrelLen: number;
  glow: string;
}

export interface EnemyTypeDef {
  color: number;
  trim: number;
  visor: number;
  scale: number;
  hpBase: number;
  hpWave: number;
  speed: number;
  dmg: number;
  points: number;
  ranged: boolean;
  name: string;
}

export interface Enemy {
  mesh: THREE.Group;
  type: EnemyTypeDef;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  points: number;
  ranged: boolean;
  lastHit: number;
  lastShot: number;
  /** walk-cycle phase accumulator */
  lp: number;
  isBoss: boolean;
}

export interface PooledBullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  active: boolean;
}

export interface PooledEnemyBullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  active: boolean;
}

export interface PooledParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

export interface FloatNum {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  life: number;
}

export interface Powerup {
  mesh: THREE.Group;
  kind: PowerupKind;
}

export type PowerupKind = 'health' | 'ammo' | 'damage' | 'nuke';

export interface Perks {
  maxHealthLvl: number;
  dmgReductLvl: number;
  fireRateLvl: number;
  magLvl: number;
}

export interface LevelTheme {
  name: string;
  skyTop: number;
  skyBot: number;
  fog: number;
  ground: number;
  sun: number;
  sunI: number;
  hemi: number;
  fogNear: number;
  fogFar: number;
}

export interface GameSettings {
  volume: number;
  /** multiplier applied to mouse/touch delta */
  sensitivity: number;
  quality: 'low' | 'medium' | 'high';
}

export type GamePhase = 'menu' | 'playing' | 'paused' | 'shop' | 'gameover';
