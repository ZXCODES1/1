import * as THREE from 'three';
import type { Enemy, EnemyTypeDef, PooledEnemyBullet, PooledBullet, Powerup, PowerupKind } from './types';
import type { GameState } from './GameState';
import { SFX } from './AudioEngine';
import { ParticleSystem } from './ParticleSystem';
import { hudCrosshairHit, hudKillFeed, hudStreakAnnounce, hudNukeFlash, hudNukeBtn, hudUpdateScore } from './HUD';
import { saveHighScore } from './GameState';

export const ENEMY_TYPES: Record<string, EnemyTypeDef> = {
  GRUNT:  { color:0x5a6b4a, trim:0x2e3526, visor:0xff5522, scale:1.00, hpBase:2,  hpWave:1.0, speed:0.028, dmg:10, points:100,  ranged:false, name:'GRUNT' },
  RUNNER: { color:0xc9a23a, trim:0x4a3a1a, visor:0xffdd33, scale:0.80, hpBase:1,  hpWave:0.6, speed:0.062, dmg:8,  points:150,  ranged:false, name:'RUNNER' },
  BRUTE:  { color:0x8a4a2a, trim:0x3a1f12, visor:0xff8800, scale:1.55, hpBase:8,  hpWave:2.2, speed:0.018, dmg:25, points:300,  ranged:false, name:'BRUTE' },
  GUNNER: { color:0x3a5a7a, trim:0x1a2a3a, visor:0x33ccff, scale:1.00, hpBase:3,  hpWave:1.2, speed:0.020, dmg:12, points:250,  ranged:true,  name:'GUNNER' },
  BOSS:   { color:0x3a3a44, trim:0x16161c, visor:0xff0022, scale:3.00, hpBase:60, hpWave:12,  speed:0.022, dmg:40, points:2000, ranged:true,  name:'WARLORD' },
};

const ENEMY_BULLET_POOL = 40;
const POWERUP_KINDS: PowerupKind[] = ['health', 'ammo', 'damage', 'nuke'];
const POWERUP_COLORS: Record<PowerupKind, number> = { health:0x00ff66, ammo:0x44ccff, damage:0xff44ff, nuke:0xffaa00 };
const STREAK_NAMES: { n: number; t: string; m: number }[] = [
  { n:3,  t:'TRIPLE KILL',   m:1.5 },
  { n:5,  t:'KILLING SPREE', m:2 },
  { n:8,  t:'RAMPAGE',       m:2.5 },
  { n:12, t:'UNSTOPPABLE',   m:3 },
  { n:18, t:'GODLIKE',       m:4 },
];

export class EnemyManager {
  enemies: Enemy[] = [];
  powerups: Powerup[] = [];

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private particles: ParticleSystem;
  private raycaster = new THREE.Raycaster();
  private bulletPool: PooledEnemyBullet[] = [];

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, particles: ParticleSystem) {
    this.scene = scene;
    this.camera = camera;
    this.particles = particles;

    const geo = new THREE.SphereGeometry(0.08, 6, 6);
    for (let i = 0; i < ENEMY_BULLET_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.bulletPool.push({ mesh, vel: new THREE.Vector3(), life: 0, damage: 0, active: false });
    }
  }

  spawn(wave: number, forcedType?: EnemyTypeDef): void {
    const type = forcedType ?? this.pickType(wave);
    const grp = this.buildMesh(type);
    const ang = Math.random() * Math.PI * 2;
    const dst = 20 + Math.random() * 8;
    grp.position.set(Math.cos(ang) * dst, 0, Math.sin(ang) * dst);
    const hp = Math.ceil(type.hpBase + type.hpWave * wave);
    this.enemies.push({
      mesh: grp, type, hp, maxHp: hp,
      speed: type.speed * (1 + wave * 0.04),
      dmg: type.dmg, points: type.points, ranged: type.ranged,
      lastHit: 0, lastShot: 0, lp: Math.random() * 6.28,
      isBoss: type === ENEMY_TYPES['BOSS'],
    });
    this.scene.add(grp);
  }

  /** Check player bullets against enemies via raycasting */
  checkBulletHits(bullets: PooledBullet[], gameState: GameState, weaponSystem: { onEnemyKilled(): void }): void {
    for (const b of bullets) {
      if (!b.active) continue;
      // Build ray from previous position toward velocity direction
      const dir = b.vel.clone().normalize();
      this.raycaster.set(b.mesh.position.clone().sub(b.vel), dir);
      this.raycaster.far = b.vel.length() + 0.5;

      // Collect bounding spheres of enemies
      for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
        const en = this.enemies[ei];
        const ep = en.mesh.position.clone();
        ep.y = b.mesh.position.y;
        const hitRadius = 0.95 * en.type.scale;
        if (b.mesh.position.distanceTo(ep) >= hitRadius) continue;

        en.hp -= b.damage;
        this.particles.spawnBlood(b.mesh.position.clone(), 0xff2244);
        this.particles.spawnFloatNum(b.mesh.position.clone(), b.damage, '#ffdd44');
        SFX.hit();
        hudCrosshairHit();

        if (en.hp <= 0) {
          this.killEnemy(ei, gameState, weaponSystem);
        }

        // each bullet hits one enemy
        b.active = false;
        b.mesh.visible = false;
        break;
      }
    }
  }

  private killEnemy(idx: number, gameState: GameState, weaponSystem: { onEnemyKilled(): void }): void {
    const en = this.enemies[idx];
    const pos = en.mesh.position.clone().setY(1.2);
    this.particles.spawnBlood(pos, en.type.color, 6);
    this.particles.spawnBlood(pos, 0xff0000, 4);

    if (en.isBoss) {
      SFX.bossDie();
      for (let x = 0; x < 4; x++) {
        this.particles.spawnBlood(
          pos.clone().add(new THREE.Vector3((Math.random()-0.5)*2, Math.random()*2, (Math.random()-0.5)*2)),
          0xffaa00, 6,
        );
      }
      gameState.screenShake = 0.4;
    } else {
      SFX.enemyDie();
      gameState.screenShake = Math.max(gameState.screenShake, 0.08);
    }

    this.maybeDropPowerup(en.mesh.position.clone());
    this.scene.remove(en.mesh);
    this.enemies.splice(idx, 1);

    const pts = Math.round(en.points * (1 + (gameState.player.wave - 1) * 0.15) * gameState.scoreMultiplier);
    gameState.player.score += pts;
    gameState.player.cash += Math.round(pts * 0.5);
    if (gameState.player.score > gameState.player.highScore) {
      gameState.player.highScore = gameState.player.score;
      saveHighScore(gameState.player.score);
    }
    hudUpdateScore(gameState);
    this.registerKill(en.type.name, pts, en.isBoss, gameState);
    weaponSystem.onEnemyKilled();
  }

  private registerKill(typeName: string, pts: number, isBoss: boolean, state: GameState): void {
    const now = Date.now();
    if (now - state.lastKillTime < 4000) state.killStreak++;
    else state.killStreak = 1;
    state.lastKillTime = now;

    hudKillFeed((isBoss ? '☠ ' : '') + `<b>${typeName}</b> +${pts}`, isBoss);

    for (let i = STREAK_NAMES.length - 1; i >= 0; i--) {
      if (state.killStreak === STREAK_NAMES[i].n) {
        state.scoreMultiplier = STREAK_NAMES[i].m;
        hudStreakAnnounce(STREAK_NAMES[i].t, `x${STREAK_NAMES[i].m} SCORE`);
        state.screenShake = Math.max(state.screenShake, 0.12);
        break;
      }
    }
  }

  updateEnemies(_gameState: GameState, onPlayerHit: (dmg: number) => void): void {
    const now = Date.now();
    const camPos = this.camera.position;

    for (const en of this.enemies) {
      const toP = new THREE.Vector3().subVectors(camPos, en.mesh.position);
      toP.y = 0;
      const d = toP.length();
      toP.normalize();

      if (en.ranged) {
        if (d > 9) en.mesh.position.addScaledVector(toP, en.speed);
        else if (d < 6) en.mesh.position.addScaledVector(toP, -en.speed * 0.5);
        const shotInterval = en.isBoss ? 700 : 1500;
        if (now - en.lastShot > shotInterval && d < 22) {
          this.enemyShoot(en);
          en.lastShot = now;
        }
      } else {
        en.mesh.position.addScaledVector(toP, en.speed);
      }

      en.mesh.lookAt(camPos.x, en.mesh.position.y, camPos.z);
      en.lp += 0.12 + en.speed;
      const sc = en.type.scale;
      const legL = en.mesh.userData['legL'] as THREE.Mesh | undefined;
      const legR = en.mesh.userData['legR'] as THREE.Mesh | undefined;
      if (legL) legL.position.y = 0.6 * sc + Math.sin(en.lp) * 0.1 * sc;
      if (legR) legR.position.y = 0.6 * sc + Math.sin(en.lp + 3.14) * 0.1 * sc;

      const meleeRange = 1.2 + en.type.scale * 0.4;
      if (d < meleeRange && now - en.lastHit > 900) {
        onPlayerHit(en.dmg);
        en.lastHit = now;
      }
    }
  }

  updateEnemyBullets(onPlayerHit: (dmg: number) => void): void {
    const camPos = this.camera.position;
    for (const eb of this.bulletPool) {
      if (!eb.active) continue;
      eb.mesh.position.add(eb.vel);
      eb.life--;
      if (eb.mesh.position.distanceTo(camPos) < 0.8) {
        onPlayerHit(eb.damage);
        eb.active = false;
        eb.mesh.visible = false;
        continue;
      }
      if (eb.life <= 0) {
        eb.active = false;
        eb.mesh.visible = false;
      }
    }
  }

  updatePowerups(_state: GameState, onCollect: (kind: PowerupKind) => void): void {
    const now = Date.now();
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.mesh.rotation.y += 0.05;
      pu.mesh.position.y = 0.7 + Math.sin(now * 0.004 + i) * 0.15;
      const camFlat = this.camera.position.clone().setY(pu.mesh.position.y);
      if (pu.mesh.position.distanceTo(camFlat) < 1.6) {
        onCollect(pu.kind);
        this.scene.remove(pu.mesh);
        this.powerups.splice(i, 1);
      }
    }
  }

  nukeAll(state: GameState): void {
    SFX.nuke();
    for (const en of this.enemies) {
      this.particles.spawnBlood(en.mesh.position.clone().setY(1.2), 0xffaa00, 6);
      state.player.score += Math.round(en.points * 0.5);
      this.scene.remove(en.mesh);
    }
    this.enemies = [];
    state.screenShake = 0.6;
    hudUpdateScore(state);
    hudNukeFlash();
  }

  useNuke(state: GameState): void {
    if (state.nukeStock <= 0) return;
    state.nukeStock--;
    hudNukeBtn(state.nukeStock);
    this.nukeAll(state);
  }

  // ── enemy projectile helpers ──────────────────────────────────────────────

  private enemyShoot(en: Enemy): void {
    const slot = this.bulletPool.find(b => !b.active);
    if (!slot) return;
    const dir = new THREE.Vector3().subVectors(this.camera.position, en.mesh.position);
    dir.y += 0.3; dir.normalize();
    dir.x += (Math.random() - 0.5) * 0.08;
    dir.y += (Math.random() - 0.5) * 0.05;
    slot.mesh.position.copy(en.mesh.position).setY(1.4);
    slot.vel.copy(dir).multiplyScalar(en.isBoss ? 0.32 : 0.26);
    slot.life = 90;
    slot.damage = en.isBoss ? 18 : 8;
    slot.active = true;
    slot.mesh.visible = true;
    SFX.enemyShoot(en.isBoss);
  }

  // ── powerup drops ─────────────────────────────────────────────────────────

  private maybeDropPowerup(pos: THREE.Vector3): void {
    if (Math.random() > 0.18) return;
    const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
    const color = POWERUP_COLORS[kind];
    const geo = kind === 'nuke' ? new THREE.OctahedronGeometry(0.35) : new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    const grp = new THREE.Group();
    grp.add(mesh);
    grp.position.copy(pos).setY(0.7);
    const glow = new THREE.PointLight(color, 1.5, 6);
    grp.add(glow);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.04, 6, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    grp.add(ring);
    this.scene.add(grp);
    this.powerups.push({ mesh: grp, kind });
  }

  // ── enemy mesh builder ────────────────────────────────────────────────────

  private buildMesh(type: EnemyTypeDef): THREE.Group {
    const grp = new THREE.Group();
    const s = type.scale;
    const bodyMat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.45, metalness: 0.6 });
    const trimMat = new THREE.MeshStandardMaterial({ color: type.trim, roughness: 0.6, metalness: 0.7 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x111418, emissive: type.visor, emissiveIntensity: 1.4, roughness: 0.3 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.5, metalness: 0.8 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7*s, 0.8*s, 0.42*s), bodyMat);
    torso.position.y = 1.25*s; torso.castShadow = true; grp.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5*s, 0.5*s, 0.1*s), trimMat);
    chest.position.set(0, 1.3*s, 0.22*s); grp.add(chest);
    const shL = new THREE.Mesh(new THREE.SphereGeometry(0.2*s, 8, 6), trimMat);
    shL.position.set(-0.42*s, 1.55*s, 0); shL.castShadow = true; grp.add(shL);
    const shR = shL.clone(); shR.position.x = 0.42*s; grp.add(shR);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12*s, 0.12*s, 0.12*s, 8), jointMat);
    neck.position.y = 1.72*s; grp.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4*s, 0.4*s, 0.42*s), bodyMat);
    head.position.y = 1.92*s; head.castShadow = true; grp.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22*s, 10, 8, 0, Math.PI*2, 0, Math.PI/2), trimMat);
    helmet.position.y = 2.08*s; grp.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42*s, 0.12*s, 0.06*s), visorMat);
    visor.position.set(0, 1.93*s, -0.21*s); grp.add(visor);

    const buildLeg = (sign: number): THREE.Mesh => {
      const hip = new THREE.Mesh(new THREE.SphereGeometry(0.14*s, 8, 6), jointMat);
      hip.position.set(sign*0.19*s, 0.85*s, 0); grp.add(hip);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.24*s, 0.5*s, 0.26*s), bodyMat);
      thigh.position.set(sign*0.19*s, 0.6*s, 0); thigh.castShadow = true; grp.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.22*s, 0.5*s, 0.24*s), trimMat);
      shin.position.set(sign*0.19*s, 0.2*s, 0); grp.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24*s, 0.15*s, 0.36*s), jointMat);
      boot.position.set(sign*0.19*s, 0.05*s, 0.05*s); grp.add(boot);
      return thigh;
    };
    const legL = buildLeg(-1);
    const legR = buildLeg(1);

    const buildArm = (sign: number): void => {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.18*s, 0.45*s, 0.18*s), bodyMat);
      up.position.set(sign*0.5*s, 1.35*s, 0); up.castShadow = true; grp.add(up);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.16*s, 0.4*s, 0.16*s), trimMat);
      fore.position.set(sign*0.5*s, 0.98*s, 0.02*s); grp.add(fore);
    };
    buildArm(-1); buildArm(1);

    if (type.ranged) {
      const wpn = new THREE.Mesh(new THREE.BoxGeometry(0.1*s, 0.1*s, 0.6*s), jointMat);
      wpn.position.set(0.5*s, 0.98*s, -0.25*s); grp.add(wpn);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05*s, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff5500, emissiveIntensity: 0.6 }));
      tip.position.set(0.5*s, 0.98*s, -0.55*s); grp.add(tip);
    }

    if (type === ENEMY_TYPES['BOSS']) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.18*s, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0022, emissiveIntensity: 2.0 }));
      core.position.set(0, 1.3*s, 0.24*s); grp.add(core);
      const coreLight = new THREE.PointLight(0xff0022, 2, 12);
      coreLight.position.set(0, 1.3*s, 0.5*s); grp.add(coreLight);
      const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.6*s, 0.7*s, 0.2*s), trimMat);
      backpack.position.set(0, 1.4*s, -0.28*s); grp.add(backpack);
      for (const a of [-1, 1]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02*s, 0.02*s, 0.6*s, 6), jointMat);
        ant.position.set(a*0.2*s, 2.4*s, -0.28*s); grp.add(ant);
      }
    }

    grp.userData['legL'] = legL;
    grp.userData['legR'] = legR;
    return grp;
  }

  private pickType(wave: number): EnemyTypeDef {
    const r = Math.random();
    if (wave >= 3 && r < 0.18) return ENEMY_TYPES['RUNNER'];
    if (wave >= 4 && r < 0.32) return ENEMY_TYPES['GUNNER'];
    if (wave >= 5 && r < 0.45) return ENEMY_TYPES['BRUTE'];
    return ENEMY_TYPES['GRUNT'];
  }
}
