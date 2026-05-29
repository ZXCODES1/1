import * as THREE from 'three';
import type { WeaponDef, PooledBullet } from './types';
import type { GameState } from './GameState';
import { SFX } from './AudioEngine';
import { rebuildGun } from './Renderer';
import { hudUpdateAmmo, hudShowReloadBar, hudUpdateWeapon, hudUpgradeAnnounce } from './HUD';

export const WEAPONS: WeaponDef[] = [
  { name: 'PISTOL',   kills: 3,   damage: 1, fireRate: 140, ammo: 12, spread: 0.030, speed: 1.1, bullets: 1, color: 0xffff44, barrelLen: 0.35, glow: '#ffff44' },
  { name: 'SMG',      kills: 6,   damage: 1, fireRate: 90,  ammo: 25, spread: 0.040, speed: 1.3, bullets: 1, color: 0x44ffff, barrelLen: 0.40, glow: '#44ffff' },
  { name: 'SHOTGUN',  kills: 10,  damage: 1, fireRate: 400, ammo: 8,  spread: 0.120, speed: 1.0, bullets: 5, color: 0xff8844, barrelLen: 0.30, glow: '#ff8844' },
  { name: 'ASSAULT',  kills: 16,  damage: 2, fireRate: 70,  ammo: 30, spread: 0.020, speed: 1.4, bullets: 1, color: 0xff44ff, barrelLen: 0.50, glow: '#ff44ff' },
  { name: 'RAILGUN',  kills: 999, damage: 5, fireRate: 600, ammo: 5,  spread: 0.001, speed: 2.0, bullets: 1, color: 0xffffff, barrelLen: 0.60, glow: '#ffffff' },
];

const BULLET_POOL_SIZE = 80;

export class WeaponSystem {
  level = 0;
  killsOnLevel = 0;
  gunRecoil = 0;

  private lastFireTime = 0;
  private pool: PooledBullet[] = [];
  private camera: THREE.PerspectiveCamera;
  private gunGrp: THREE.Group;
  private flashMat: THREE.MeshBasicMaterial;
  private reloadTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    gunGrp: THREE.Group,
    flashMat: THREE.MeshBasicMaterial,
  ) {
    this.camera = camera;
    this.gunGrp = gunGrp;
    this.flashMat = flashMat;

    const geo = new THREE.SphereGeometry(0.04, 5, 5);
    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffff44 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), life: 0, damage: 0, active: false });
    }
  }

  get activeBullets(): PooledBullet[] { return this.pool; }
  get currentWeapon(): WeaponDef { return WEAPONS[this.level]; }

  shoot(gameState: GameState): void {
    const { player, perks } = gameState;
    if (!player.alive || player.ammo <= 0 || player.reloading) return;

    const now = Date.now();
    const w = this.currentWeapon;
    const effFireRate = w.fireRate * (1 - perks.fireRateLvl * 0.15);
    if (now - this.lastFireTime < effFireRate) return;
    this.lastFireTime = now;

    player.ammo--;
    hudUpdateAmmo(player.ammo);

    if (w.name === 'SHOTGUN') SFX.shotgun();
    else if (w.name === 'RAILGUN') SFX.rail();
    else SFX.shoot(this.level);

    const dmgMul = Date.now() < gameState.damageBoostUntil ? 2 : 1;

    for (let s = 0; s < w.bullets; s++) {
      const slot = this.pool.find(b => !b.active);
      if (!slot) continue;

      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      dir.x += (Math.random() - 0.5) * w.spread;
      dir.y += (Math.random() - 0.5) * w.spread * 0.5;
      dir.normalize();

      (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(w.color);
      slot.mesh.position.copy(this.camera.position).addScaledVector(dir, 0.6);
      slot.vel.copy(dir).multiplyScalar(w.speed);
      slot.life = 55;
      slot.damage = w.damage * dmgMul;
      slot.active = true;
      slot.mesh.visible = true;
    }

    this.flashMat.opacity = 1;
    setTimeout(() => { this.flashMat.opacity = 0; }, 60);
    this.gunRecoil = 0.05 + this.level * 0.005;

    if (player.ammo === 0) this.startReload(gameState);
  }

  startReload(gameState: GameState): void {
    const { player, perks } = gameState;
    if (player.reloading) return;
    player.reloading = true;
    SFX.reload();
    const reloadMs = Math.max(600, 1850 - this.level * 200);
    hudShowReloadBar(true, reloadMs);
    if (this.reloadTimeout) clearTimeout(this.reloadTimeout);
    this.reloadTimeout = setTimeout(() => {
      const w = this.currentWeapon;
      player.ammo = Math.round(w.ammo * (1 + perks.magLvl * 0.4));
      player.reloading = false;
      hudShowReloadBar(false);
      hudUpdateAmmo(player.ammo);
    }, reloadMs);
  }

  onEnemyKilled(): void {
    this.killsOnLevel++;
    const w = this.currentWeapon;
    if (this.level < WEAPONS.length - 1 && this.killsOnLevel >= w.kills) {
      this.upgrade();
    } else {
      this.updateHUD();
    }
  }

  private upgrade(): void {
    this.level++;
    this.killsOnLevel = 0;
    const w = this.currentWeapon;
    this.flashMat = rebuildGun(this.gunGrp, this.camera, this.level, w.color, w.barrelLen, w.bullets);
    hudUpgradeAnnounce(w.name);
    SFX.upgrade();
    this.updateHUD();
  }

  updateHUD(): void {
    const w = this.currentWeapon;
    const isMax = this.level >= WEAPONS.length - 1;
    const pct = isMax ? 100 : (this.killsOnLevel / w.kills) * 100;
    const killsText = isMax ? 'MAX LEVEL' : `${this.killsOnLevel} / ${w.kills} KILLS`;
    hudUpdateWeapon(w.name, pct, killsText, w.glow);
  }

  /** Advance bullet pool each tick; returns list of still-active bullets */
  updateBullets(): void {
    for (const b of this.pool) {
      if (!b.active) continue;
      b.mesh.position.add(b.vel);
      b.life--;
      if (b.life <= 0) this.releaseBullet(b);
    }
  }

  releaseBullet(b: PooledBullet): void {
    b.active = false;
    b.mesh.visible = false;
  }

  animateGun(moving: boolean, t: number): void {
    this.gunGrp.position.y = -0.18 + (moving ? Math.sin(t * 2.2) * 0.013 : 0);
    if (this.gunRecoil > 0) {
      this.gunGrp.position.z = -0.4 + this.gunRecoil;
      this.gunRecoil -= 0.005;
    } else {
      this.gunGrp.position.z = -0.4;
      this.gunRecoil = 0;
    }
  }
}
