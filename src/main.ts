import { createGameState, type GameState } from './GameState';
import { initAudio, setVolume, SFX, startMusic } from './AudioEngine';
import { initRenderer } from './Renderer';
import { initPostFX } from './PostFX';
import { Input } from './Input';
import { Player } from './Player';
import { WeaponSystem } from './WeaponSystem';
import { EnemyManager } from './EnemyManager';
import { ParticleSystem } from './ParticleSystem';
import { WaveManager } from './WaveManager';
import {
  hudShow, hudShowOverlay,
  hudUpdateHealth, hudUpdateAmmo, hudUpdateScore,
  hudUpdateWave, hudUpdateCash,
  hudPowerupAnnounce,
} from './HUD';
import type { PowerupKind } from './types';

// ── Fixed-timestep constants ──────────────────────────────────────────────────
const LOGIC_HZ = 60;
const TICK_DT = 1 / LOGIC_HZ;
const MAX_DELTA = 0.1;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const state: GameState = createGameState();
const refs = initRenderer(state);
const postFX = initPostFX(refs.renderer, refs.scene, refs.camera);
const particles = new ParticleSystem(refs.scene, refs.camera);
const enemyMgr = new EnemyManager(refs.scene, refs.camera, particles);
const weaponSys = new WeaponSystem(refs.scene, refs.camera, refs.gunGrp, refs.flashMat);
const player = new Player(refs.camera);
const waveMgr = new WaveManager(refs.themeRefs, enemyMgr, weaponSys);

weaponSys.setParticles(particles);
enemyMgr.setPostFX(postFX);

const input = new Input(refs.renderer.domElement, state, {
  onShoot: () => {
    if (state.phase === 'playing') weaponSys.shoot(state);
  },
  onReload: () => {
    if (state.phase === 'playing') weaponSys.startReload(state);
  },
  onNuke: () => {
    if (state.phase === 'playing') enemyMgr.useNuke(state);
  },
  onPause: () => togglePause(),
});

// ADS right-click
refs.renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state.phase === 'playing') weaponSys.toggleADS();
});

weaponSys.updateHUD();

// ── Overlay / settings wiring ─────────────────────────────────────────────────

const startBtn = document.getElementById('startBtn')!;
const overlay  = document.getElementById('overlay')!;
const pausePanel = document.getElementById('pausePanel')!;
const settingsPanel = document.getElementById('settingsPanel')!;
const volSlider  = document.getElementById('volSlider') as HTMLInputElement;
const sensSlider = document.getElementById('sensSlider') as HTMLInputElement;
const qualSelect = document.getElementById('qualitySelect') as HTMLSelectElement;

const hsEl = document.getElementById('highScoreDisplay');
if (hsEl) hsEl.textContent = state.player.highScore > 0 ? 'HIGHSCORE: ' + state.player.highScore : '';

startBtn.addEventListener('click', () => {
  initAudio();
  overlay.style.display = 'none';
  hudShow(true);
  state.phase = 'playing';
  hudUpdateAmmo(state.player.ammo);
  hudUpdateHealth(state);
  hudUpdateScore(state);
  hudUpdateWave(state.player.wave);
  hudUpdateCash(state);
  waveMgr.startInitial(state);
  startMusic(state.player.wave);
});

document.getElementById('resumeBtn')!.addEventListener('click', () => togglePause());
document.getElementById('restartBtn')!.addEventListener('click', () => location.reload());
document.getElementById('settingsBtn')!.addEventListener('click', () => {
  pausePanel.style.display = 'none';
  settingsPanel.style.display = 'flex';
});
document.getElementById('settingsClose')!.addEventListener('click', () => {
  settingsPanel.style.display = 'none';
  if (state.player.alive) pausePanel.style.display = 'flex';
});

volSlider.addEventListener('input', () => {
  state.settings.volume = parseInt(volSlider.value, 10) / 100;
  setVolume(state);
});
sensSlider.addEventListener('input', () => {
  state.settings.sensitivity = parseInt(sensSlider.value, 10);
});
qualSelect.addEventListener('change', () => {
  state.settings.quality = qualSelect.value as 'low' | 'medium' | 'high';
  const pr = state.settings.quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1;
  refs.renderer.setPixelRatio(pr);
});

function togglePause(): void {
  if (state.phase === 'shop' || !state.player.alive) return;
  if (state.phase === 'playing') {
    state.phase = 'paused';
    pausePanel.style.display = 'flex';
    if (document.exitPointerLock) document.exitPointerLock();
  } else if (state.phase === 'paused') {
    state.phase = 'playing';
    pausePanel.style.display = 'none';
  }
}

function endGame(): void {
  state.phase = 'gameover';
  hudShow(false);
  if (document.exitPointerLock) document.exitPointerLock();
  hudShowOverlay(
    'GAME OVER',
    `SCORE: ${state.player.score}  |  WAVE: ${state.player.wave}`,
    'NEUSTART',
    () => location.reload(),
  );
}

// ── Powerup collection handler ────────────────────────────────────────────────

function collectPowerup(kind: PowerupKind): void {
  state.screenShake = Math.max(state.screenShake, 0.1);
  SFX.wave();
  if (kind === 'health') {
    state.player.health = Math.min(state.player.maxHealth, state.player.health + 50);
    hudUpdateHealth(state);
    hudPowerupAnnounce('+50 SHIELD');
  } else if (kind === 'ammo') {
    state.player.ammo = weaponSys.currentWeapon.ammo;
    hudUpdateAmmo(state.player.ammo);
    hudPowerupAnnounce('AMMO REFILL');
  } else if (kind === 'damage') {
    state.damageBoostUntil = Date.now() + 8000;
    hudPowerupAnnounce('2X DAMAGE 8s');
  } else if (kind === 'nuke') {
    enemyMgr.nukeAll(state);
    hudPowerupAnnounce('TACTICAL NUKE');
  }
}

// ── Score multiplier decay ────────────────────────────────────────────────────

function tickMultiplier(state: GameState): void {
  if (state.scoreMultiplier > 1 && Date.now() - state.lastKillTime > 4000) {
    state.scoreMultiplier = 1;
    state.killStreak = 0;
    hudUpdateCash(state);
  }
}

// ── Fixed-timestep game loop ──────────────────────────────────────────────────

let lastTime = performance.now();
let accumulator = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);

  refs.animateEnv(now * 0.001);
  postFX.update(now * 0.001);
  postFX.composer.render();

  if (state.phase !== 'playing') { lastTime = now; return; }

  const rawDelta = (now - lastTime) / 1000;
  lastTime = now;
  accumulator += Math.min(rawDelta, MAX_DELTA);

  while (accumulator >= TICK_DT) {
    tick(TICK_DT);
    accumulator -= TICK_DT;
  }

  const t = now * 0.003;
  const moving = input.state.moveX !== 0 || input.state.moveY !== 0;
  const sprinting = false;
  weaponSys.animateGun(moving, sprinting, t);
}

function tick(_dt: number): void {
  if (state.phase !== 'playing') return;

  input.readKeyboardMove();
  player.update(state, input.state);
  weaponSys.updateBullets();

  enemyMgr.checkBulletHits(
    weaponSys.activeBullets,
    state,
    { onEnemyKilled: () => weaponSys.onEnemyKilled() },
  );

  enemyMgr.updateEnemies(state, (dmg) => {
    player.takeDamage(dmg, state, endGame);
    hudUpdateCash(state);
  });

  enemyMgr.updateEnemyBullets((dmg) => {
    player.takeDamage(dmg, state, endGame);
    hudUpdateCash(state);
  });

  enemyMgr.updatePowerups(state, collectPowerup);
  particles.update();
  waveMgr.tick(state);
  tickMultiplier(state);
  hudUpdateCash(state);
}

requestAnimationFrame(frame);
