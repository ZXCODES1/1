import * as THREE from 'three';
import type { WeaponDef, PooledBullet } from './types';
import type { GameState } from './GameState';
import { SFX } from './AudioEngine';
import { rebuildGun } from './Renderer';
import { hudUpdateAmmo, hudShowReloadBar, hudUpdateWeapon, hudUpgradeAnnounce } from './HUD';
import type { ParticleSystem } from './ParticleSystem';

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
  gunRecoilRot = 0;
  ads = false;

  private lastFireTime = 0;
  private pool: PooledBullet[] = [];
  private camera: THREE.PerspectiveCamera;
  private gunGrp: THREE.Group;
  private flashMat: THREE.MeshBasicMaterial;
  private muzzleLight: THREE.PointLight;
  private reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  private particles: ParticleSystem | null = null;
  // ADS interpolation
  private adsFov = 72;
  private adsProgress = 0; // 0=hip, 1=ads

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    gunGrp: THREE.Group,
    flashMat: THREE.MeshBasicMaterial,
  ) {
    this.camera = camera;
    this.gunGrp = gunGrp;
    this.flashMat = flashMat;

    // Dynamic muzzle light — hidden until shot
    this.muzzleLight = new THREE.PointLight(0xffff44, 0, 8);
    scene.add(this.muzzleLight);

    const geo = new THREE.SphereGeometry(0.05, 6, 6);
    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffff44, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), life: 0, damage: 0, active: false });
    }
  }

  setParticles(p: ParticleSystem): void { this.particles = p; }

  get activeBullets(): PooledBullet[] { return this.pool; }
  get currentWeapon(): WeaponDef { return WEAPONS[this.level]; }

  toggleADS(): void {
    this.ads = !this.ads;
  }

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

    const spreadMul = this.ads ? 0.4 : 1.0;
    const dmgMul = Date.now() < gameState.damageBoostUntil ? 2 : 1;

    // Muzzle world position (approx gun tip)
    const muzzlePos = this.camera.position.clone();
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    muzzlePos.addScaledVector(fwd, 0.7);

    for (let s = 0; s < w.bullets; s++) {
      const slot = this.pool.find(b => !b.active);
      if (!slot) continue;

      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      dir.x += (Math.random() - 0.5) * w.spread * spreadMul;
      dir.y += (Math.random() - 0.5) * w.spread * 0.5 * spreadMul;
      dir.normalize();

      (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(w.color);
      slot.mesh.position.copy(this.camera.position).addScaledVector(dir, 0.6);
      slot.vel.copy(dir).multiplyScalar(w.speed);
      // stretch the bullet into a glowing tracer bolt aligned to travel direction
      slot.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone());
      slot.mesh.scale.set(1, 1, 5 + w.speed * 2);
      slot.life = 55;
      slot.damage = w.damage * dmgMul;
      slot.active = true;
      slot.mesh.visible = true;
    }

    // Muzzle flash light burst
    this.muzzleLight.color.setHex(w.color);
    this.muzzleLight.intensity = 8 + this.level * 2;
    this.muzzleLight.position.copy(muzzlePos);
    setTimeout(() => { this.muzzleLight.intensity = 0; }, 80);

    // Muzzle sparks + smoke + ejected brass shells
    if (this.particles) {
      this.particles.spawnMuzzleSparks(muzzlePos, fwd, w.color);
      this.particles.spawnSmoke(muzzlePos, 2);
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      this.particles.spawnShells(this.camera.position.clone().addScaledVector(fwd, 0.3).addScaledVector(right, 0.15).setY(this.camera.position.y - 0.1), right);
    }

    this.flashMat.opacity = 1;
    setTimeout(() => { this.flashMat.opacity = 0; }, 60);
    this.gunRecoil = 0.06 + this.level * 0.008;
    this.gunRecoilRot = 0.04 + this.level * 0.005;

    // Camera recoil kick — stronger weapons kick harder, ADS reduces it
    const kick = (0.012 + this.level * 0.004) * (this.ads ? 0.5 : 1);
    gameState.camKick = Math.min(0.12, gameState.camKick + kick);

    if (player.ammo === 0) this.startReload(gameState);
  }

  startReload(gameState: GameState): void {
    const { player, perks } = gameState;
    if (player.reloading) return;
    player.reloading = true;
    this.ads = false;
    this.adsProgress = 0;
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
    // Update muzzle light back into scene (rebuildGun re-adds gunGrp to camera)
    this.muzzleLight.color.setHex(w.color);
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

  animateGun(moving: boolean, sprinting: boolean, t: number): void {
    // Sprinting cancels aim-down-sights
    if (sprinting && this.ads) this.ads = false;
    // ADS lerp
    const adsTarget = this.ads ? 1 : 0;
    this.adsProgress += (adsTarget - this.adsProgress) * 0.12;

    // FOV lerp (ads=52, hip=72, sprint=82 for a sense of speed)
    const targetFov = this.ads ? 52 : sprinting ? 82 : 72;
    this.adsFov += (targetFov - this.adsFov) * 0.1;
    this.camera.fov = this.adsFov;
    this.camera.updateProjectionMatrix();

    // ADS position (center screen when in ADS)
    const hipX = 0.22, adsX = 0.0;
    const hipZ = -0.4, adsZ = -0.28;
    this.gunGrp.position.x = hipX + (adsX - hipX) * this.adsProgress;
    const baseZ = hipZ + (adsZ - hipZ) * this.adsProgress;

    // Recoil kick
    if (this.gunRecoil > 0) {
      this.gunGrp.position.z = baseZ + this.gunRecoil;
      this.gunGrp.rotation.x = -this.gunRecoilRot;
      this.gunRecoil -= 0.006;
      this.gunRecoilRot -= 0.003;
    } else {
      this.gunGrp.position.z = baseZ;
      this.gunGrp.rotation.x = 0;
      this.gunRecoil = 0;
      this.gunRecoilRot = 0;
    }

    // Lissajous idle sway (figure-8)
    const swayAmt = this.ads ? 0.002 : 0.006;
    const swayBase = moving ? 0.0 : swayAmt;
    this.gunGrp.position.x += Math.sin(t * 0.9) * swayBase;
    this.gunGrp.position.y = -0.18 + Math.sin(t * 1.8) * swayBase * 0.5;

    // Walk bob
    if (moving && !sprinting) {
      this.gunGrp.position.y += Math.sin(t * 4.4) * 0.012;
      this.gunGrp.position.x += Math.cos(t * 2.2) * 0.006;
    }
    // Sprint tilt
    if (sprinting) {
      this.gunGrp.position.y += Math.sin(t * 6) * 0.018;
      this.gunGrp.rotation.z = THREE.MathUtils.lerp(this.gunGrp.rotation.z, -0.35, 0.1);
    } else {
      this.gunGrp.rotation.z = THREE.MathUtils.lerp(this.gunGrp.rotation.z, 0, 0.1);
    }
  }
}
