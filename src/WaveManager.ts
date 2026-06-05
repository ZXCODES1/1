import type { GameState } from './GameState';
import { EnemyManager, ENEMY_TYPES } from './EnemyManager';
import { openShop } from './Shop';
import { applyTheme, LEVEL_THEMES } from './LevelThemes';
import type { ThemeRefs } from './LevelThemes';
import { SFX } from './AudioEngine';
import { hudAnnounceWave, hudUpdateWave, hudGrenadeCount } from './HUD';
import type { WeaponSystem } from './WeaponSystem';

// Ticks at 60Hz before the next wave auto-starts after enemies clear
const WAVE_IDLE_TICKS = 90;

export class WaveManager {
  private currentTheme = 0;
  private themeRefs: ThemeRefs;
  private enemyMgr: EnemyManager;
  private weaponSystem: WeaponSystem;

  constructor(themeRefs: ThemeRefs, enemyMgr: EnemyManager, weaponSystem: WeaponSystem) {
    this.themeRefs = themeRefs;
    this.enemyMgr = enemyMgr;
    this.weaponSystem = weaponSystem;
  }

  /** Start the very first wave */
  startInitial(state: GameState): void {
    applyTheme(0, this.themeRefs);
    this.spawnWave(state);
  }

  /** Call every logic tick; handles auto-advance when arena is cleared */
  tick(state: GameState): void {
    if (state.phase !== 'playing') return;
    if (this.enemyMgr.enemies.length === 0) {
      state.waveIdleTimer++;
      if (state.waveIdleTimer >= WAVE_IDLE_TICKS) {
        state.waveIdleTimer = 0;
        this.advance(state);
      }
    } else {
      state.waveIdleTimer = 0;
    }
  }

  private advance(state: GameState): void {
    state.player.wave++;
    hudUpdateWave(state.player.wave);

    // Resupply grenades each new wave (capped)
    state.grenadeStock = Math.min(5, state.grenadeStock + 2);
    hudGrenadeCount(state.grenadeStock);

    // Every 5th completed wave: new zone
    if ((state.player.wave - 1) % 5 === 0 && state.player.wave > 1) {
      this.currentTheme++;
      applyTheme(this.currentTheme, this.themeRefs);
      const th = LEVEL_THEMES[this.currentTheme % LEVEL_THEMES.length];
      hudAnnounceWave('NEUE ZONE', th.name);
    }

    // Shop every 3 waves (wave 4, 7, 10, …)
    if ((state.player.wave - 1) % 3 === 0 && state.player.wave > 1) {
      openShop(state, this.weaponSystem.currentWeapon.ammo, () => {
        state.phase = 'playing';
        SFX.wave();
        this.spawnWave(state);
      });
    } else {
      SFX.wave();
      this.spawnWave(state);
    }
  }

  private spawnWave(state: GameState): void {
    const wave = state.player.wave;
    const isBossWave = wave % 5 === 0;

    if (isBossWave) {
      hudAnnounceWave('WAVE ' + wave, '⚠ BOSS INCOMING ⚠');
      this.enemyMgr.spawn(wave, ENEMY_TYPES['BOSS']);
      const support = 3 + Math.floor(wave / 2);
      for (let i = 0; i < support; i++) {
        setTimeout(() => this.enemyMgr.spawn(wave), 800 + i * 500);
      }
    } else {
      hudAnnounceWave('WAVE ' + wave);
      const count = 3 + wave * 2;
      for (let i = 0; i < count; i++) {
        setTimeout(() => this.enemyMgr.spawn(wave), i * 300);
      }
    }
  }
}
