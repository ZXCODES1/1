import * as THREE from 'three';
import type { Enemy, EnemyTypeDef, PooledEnemyBullet, PooledBullet, Powerup, PowerupKind } from './types';
import type { GameState } from './GameState';
import { SFX } from './AudioEngine';
import { ParticleSystem } from './ParticleSystem';
import { hudCrosshairHit, hudKillFeed, hudStreakAnnounce, hudNukeFlash, hudNukeBtn, hudUpdateScore, hudBossBar, hudShowBossBar } from './HUD';
import { saveHighScore } from './GameState';
import type { PostFX } from './PostFX';

export const ENEMY_TYPES: Record<string, EnemyTypeDef> = {
  GRUNT:  { color:0x5a6b4a, trim:0x2e3526, visor:0xff5522, scale:1.00, hpBase:2,  hpWave:1.0, speed:0.028, dmg:10, points:100,  ranged:false, name:'GRUNT' },
  RUNNER: { color:0xc9a23a, trim:0x4a3a1a, visor:0xffdd33, scale:0.80, hpBase:1,  hpWave:0.6, speed:0.062, dmg:8,  points:150,  ranged:false, name:'RUNNER' },
  BRUTE:  { color:0x8a4a2a, trim:0x3a1f12, visor:0xff8800, scale:1.55, hpBase:8,  hpWave:2.2, speed:0.018, dmg:25, points:300,  ranged:false, name:'BRUTE' },
  GUNNER: { color:0x3a5a7a, trim:0x1a2a3a, visor:0x33ccff, scale:1.00, hpBase:3,  hpWave:1.2, speed:0.020, dmg:12, points:250,  ranged:true,  name:'GUNNER' },
  BOSS:   { color:0x3a3a44, trim:0x16161c, visor:0xff0022, scale:3.00, hpBase:60, hpWave:12,  speed:0.022, dmg:40, points:2000, ranged:true,  name:'WARLORD' },
};

const ENEMY_BULLET_POOL = 60;
const POWERUP_KINDS: PowerupKind[] = ['health', 'ammo', 'damage', 'nuke'];
const POWERUP_COLORS: Record<PowerupKind, number> = { health:0x00ff66, ammo:0x44ccff, damage:0xff44ff, nuke:0xffaa00 };
const STREAK_NAMES: { n: number; t: string; m: number }[] = [
  { n:3,  t:'TRIPLE KILL',   m:1.5 },
  { n:5,  t:'KILLING SPREE', m:2 },
  { n:8,  t:'RAMPAGE',       m:2.5 },
  { n:12, t:'UNSTOPPABLE',   m:3 },
  { n:18, t:'GODLIKE',       m:4 },
];

interface EnemyExtra {
  visorMat: THREE.MeshStandardMaterial;
  healthBarFill: THREE.Mesh;
  deathLight?: THREE.PointLight;
  phase2Triggered?: boolean;
  bossRings?: THREE.Mesh[];
  enraged?: boolean;
}

export class EnemyManager {
  enemies: Enemy[] = [];
  powerups: Powerup[] = [];
  private extras = new Map<Enemy, EnemyExtra>();

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private particles: ParticleSystem;
  private postFX: PostFX | null = null;
  private bulletPool: PooledEnemyBullet[] = [];
  private tick = 0;
  private slowMoUntil = 0;
  private airstrikeActive = false;

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

  setPostFX(pfx: PostFX): void { this.postFX = pfx; }

  get slowMoActive(): boolean { return Date.now() < this.slowMoUntil; }

  spawn(wave: number, forcedType?: EnemyTypeDef): void {
    const type = forcedType ?? this.pickType(wave);
    const { grp, visorMat, healthBarFill } = this.buildMesh(type);
    const ang = Math.random() * Math.PI * 2;
    const dst = 20 + Math.random() * 8;
    grp.position.set(Math.cos(ang) * dst, 0, Math.sin(ang) * dst);
    const hp = Math.ceil(type.hpBase + type.hpWave * wave);
    const en: Enemy = {
      mesh: grp, type, hp, maxHp: hp,
      speed: type.speed * (1 + wave * 0.04),
      dmg: type.dmg, points: type.points, ranged: type.ranged,
      lastHit: 0, lastShot: 0, lp: Math.random() * 6.28,
      isBoss: type === ENEMY_TYPES['BOSS'],
    };
    this.enemies.push(en);
    this.extras.set(en, { visorMat, healthBarFill });
    this.scene.add(grp);

    if (en.isBoss) {
      hudShowBossBar(true, 'WARLORD');
      // Add rotating rings to boss
      const rings: THREE.Mesh[] = [];
      const axes = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)];
      for (let r = 0; r < 3; r++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.4 + r * 0.5, 0.08, 6, 32),
          new THREE.MeshStandardMaterial({ color: 0xff0022, emissive: 0xff0022, emissiveIntensity: 2.0, transparent: true, opacity: 0.85 }),
        );
        ring.userData['axis'] = axes[r];
        ring.userData['speed'] = 0.015 + r * 0.01;
        grp.add(ring);
        rings.push(ring);
      }
      this.extras.get(en)!.bossRings = rings;
    }
  }

  checkBulletHits(bullets: PooledBullet[], gameState: GameState, weaponSystem: { onEnemyKilled(): void }): void {
    for (const b of bullets) {
      if (!b.active) continue;
      for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
        const en = this.enemies[ei];
        const ep = en.mesh.position.clone(); ep.y = b.mesh.position.y;
        const hitRadius = 0.95 * en.type.scale;
        if (b.mesh.position.distanceTo(ep) >= hitRadius) continue;

        en.hp -= b.damage;
        this.updateHealthBar(en);
        this.particles.spawnBlood(b.mesh.position.clone(), 0xff2244);
        this.particles.spawnFloatNum(b.mesh.position.clone(), b.damage, en.isBoss ? '#ff4444' : '#ffdd44');
        SFX.hit();
        hudCrosshairHit();

        // Boss phase 2 at 50% HP
        if (en.isBoss && !this.extras.get(en)?.phase2Triggered && en.hp <= en.maxHp * 0.5) {
          this.triggerBossPhase2(en);
        }

        if (en.hp <= 0) {
          this.killEnemy(ei, gameState, weaponSystem);
        }
        b.active = false;
        b.mesh.visible = false;
        break;
      }
    }
  }

  private triggerBossPhase2(en: Enemy): void {
    const extra = this.extras.get(en);
    if (!extra) return;
    extra.phase2Triggered = true;
    extra.enraged = true;
    en.speed *= 1.5;
    extra.visorMat.emissiveIntensity = 4.0;
    SFX.bossEnrage();
    this.postFX?.triggerChromaticSpike(0.04, 1200);
    hudStreakAnnounce('PHASE 2', 'WARLORD ENRAGED');
    // Extra rings glow brighter
    extra.bossRings?.forEach(r => {
      (r.material as THREE.MeshStandardMaterial).emissiveIntensity = 4.0;
    });
  }

  private killEnemy(idx: number, gameState: GameState, weaponSystem: { onEnemyKilled(): void }): void {
    const en = this.enemies[idx];
    const pos = en.mesh.position.clone().setY(1.2);

    if (en.isBoss) {
      // Boss death: slow motion + massive explosion
      this.slowMoUntil = Date.now() + 1800;
      SFX.bossDie();
      this.particles.spawnBossExplosion(pos);
      gameState.screenShake = 0.8;
      this.postFX?.triggerChromaticSpike(0.08, 2000);
      this.postFX?.triggerBloomSpike(3.0, 1500);
      hudShowBossBar(false, '');
      // Exploding death light
      const dl = new THREE.PointLight(0xff2200, 20, 25);
      dl.position.copy(pos);
      this.scene.add(dl);
      const fadeLight = () => { dl.intensity -= 0.5; if (dl.intensity > 0) requestAnimationFrame(fadeLight); else this.scene.remove(dl); };
      requestAnimationFrame(fadeLight);
    } else {
      SFX.enemyDie();
      this.particles.spawnExplosion(pos, 28);
      gameState.screenShake = Math.max(gameState.screenShake, 0.1);
      // Small death light flash
      const dl = new THREE.PointLight(en.type.visor, 6, 10);
      dl.position.copy(pos);
      this.scene.add(dl);
      setTimeout(() => this.scene.remove(dl), 200);
    }

    this.maybeDropPowerup(en.mesh.position.clone());
    this.extras.delete(en);
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

    // Killstreak rewards
    if (state.killStreak === 10 && !this.airstrikeActive) {
      this.triggerAirstrike(state);
    } else if (state.killStreak === 15) {
      state.damageBoostUntil = Date.now() + 8000;
      hudStreakAnnounce('BERSERKER', '2X DMG 8s');
      this.postFX?.triggerChromaticSpike(0.015, 500);
    }
  }

  private triggerAirstrike(state: GameState): void {
    this.airstrikeActive = true;
    hudStreakAnnounce('AIRSTRIKE', 'INCOMING');
    SFX.airstrike();
    let count = 0;
    const strike = () => {
      if (count >= 5) { this.airstrikeActive = false; return; }
      const x = (Math.random() - 0.5) * 40;
      const z = (Math.random() - 0.5) * 40;
      const pos = new THREE.Vector3(x, 1, z);
      this.particles.spawnExplosion(pos, 50);
      this.particles.spawnShockwave(pos, 0xff6600);
      state.screenShake = Math.max(state.screenShake, 0.3);
      // Damage nearby enemies
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const d = this.enemies[i].mesh.position.distanceTo(pos);
        if (d < 5) {
          this.enemies[i].hp -= Math.round(20 * (1 - d / 5));
          this.updateHealthBar(this.enemies[i]);
          if (this.enemies[i].hp <= 0) {
            // Award kill credit to player but don't call weaponSystem
            state.player.score += this.enemies[i].points;
            this.extras.delete(this.enemies[i]);
            this.scene.remove(this.enemies[i].mesh);
            this.enemies.splice(i, 1);
            hudUpdateScore(state);
          }
        }
      }
      count++;
      setTimeout(strike, 400);
    };
    setTimeout(strike, 300);
  }

  updateEnemies(_gameState: GameState, onPlayerHit: (dmg: number) => void): void {
    const now = Date.now();
    const camPos = this.camera.position;
    this.tick++;

    for (const en of this.enemies) {
      const toP = new THREE.Vector3().subVectors(camPos, en.mesh.position);
      toP.y = 0;
      const d = toP.length();
      toP.normalize();
      const extra = this.extras.get(en);

      if (en.ranged) {
        if (d > 9) en.mesh.position.addScaledVector(toP, en.speed);
        else if (d < 6) en.mesh.position.addScaledVector(toP, -en.speed * 0.5);
        const shotInterval = en.isBoss ? (extra?.enraged ? 500 : 700) : 1500;
        if (now - en.lastShot > shotInterval && d < 22) {
          this.enemyShoot(en, extra?.enraged);
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

      // Visor glow pulse
      if (extra?.visorMat) {
        const base = extra.enraged ? 3.5 : 1.4;
        const pulse = base + Math.sin(this.tick * 0.12 + en.lp) * (base * 0.4);
        extra.visorMat.emissiveIntensity = pulse;
      }

      // Boss rings rotation
      if (extra?.bossRings) {
        for (const ring of extra.bossRings) {
          const axis = ring.userData['axis'] as THREE.Vector3;
          const speed = ring.userData['speed'] as number;
          ring.rotateOnAxis(axis, speed * (extra.enraged ? 2.5 : 1.0));
        }
      }

      // Health bar always faces camera
      if (extra?.healthBarFill) {
        const bar = extra.healthBarFill.parent;
        if (bar) bar.lookAt(camPos);
      }

      const meleeRange = 1.2 + en.type.scale * 0.4;
      if (d < meleeRange && now - en.lastHit > 900) {
        onPlayerHit(en.dmg);
        en.lastHit = now;
      }
    }

    // Boss health bar update
    const boss = this.enemies.find(e => e.isBoss);
    if (boss) hudBossBar(boss.hp / boss.maxHp);
  }

  updateEnemyBullets(onPlayerHit: (dmg: number) => void): void {
    const camPos = this.camera.position;
    for (const eb of this.bulletPool) {
      if (!eb.active) continue;
      eb.mesh.position.add(eb.vel);
      eb.life--;
      if (eb.mesh.position.distanceTo(camPos) < 0.8) {
        onPlayerHit(eb.damage);
        eb.active = false; eb.mesh.visible = false;
        continue;
      }
      if (eb.life <= 0) { eb.active = false; eb.mesh.visible = false; }
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
      this.particles.spawnBossExplosion(en.mesh.position.clone().setY(1.2));
      state.player.score += Math.round(en.points * 0.5);
      this.extras.delete(en);
      this.scene.remove(en.mesh);
    }
    this.enemies = [];
    state.screenShake = 0.8;
    hudUpdateScore(state);
    hudNukeFlash();
    this.postFX?.triggerBloomSpike(4.0, 800);
    this.postFX?.triggerChromaticSpike(0.06, 600);
    hudShowBossBar(false, '');
  }

  useNuke(state: GameState): void {
    if (state.nukeStock <= 0) return;
    state.nukeStock--;
    hudNukeBtn(state.nukeStock);
    this.nukeAll(state);
  }

  private updateHealthBar(en: Enemy): void {
    const extra = this.extras.get(en);
    if (!extra) return;
    const pct = Math.max(0, en.hp / en.maxHp);
    extra.healthBarFill.scale.x = pct;
    extra.healthBarFill.position.x = (pct - 1) * 0.5;
    const mat = extra.healthBarFill.material as THREE.MeshBasicMaterial;
    if (pct > 0.6) mat.color.setHex(0x00ff44);
    else if (pct > 0.3) mat.color.setHex(0xffaa00);
    else mat.color.setHex(0xff2200);
  }

  private enemyShoot(en: Enemy, enraged = false): void {
    const burstCount = (en.isBoss && enraged) ? 3 : 1;
    for (let b = 0; b < burstCount; b++) {
      const slot = this.bulletPool.find(b => !b.active);
      if (!slot) continue;
      const dir = new THREE.Vector3().subVectors(this.camera.position, en.mesh.position);
      dir.y += 0.3; dir.normalize();
      if (burstCount > 1) {
        // spread
        dir.x += (b - 1) * 0.25;
        dir.normalize();
      }
      dir.x += (Math.random() - 0.5) * 0.08;
      dir.y += (Math.random() - 0.5) * 0.05;
      slot.mesh.position.copy(en.mesh.position).setY(1.4);
      slot.vel.copy(dir).multiplyScalar(en.isBoss ? 0.34 : 0.26);
      slot.life = 90;
      slot.damage = en.isBoss ? (enraged ? 24 : 18) : 8;
      slot.active = true;
      slot.mesh.visible = true;
    }
    SFX.enemyShoot(en.isBoss);
  }

  private maybeDropPowerup(pos: THREE.Vector3): void {
    if (Math.random() > 0.18) return;
    const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
    const color = POWERUP_COLORS[kind];
    const geo = kind === 'nuke' ? new THREE.OctahedronGeometry(0.35) : new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0 }));
    const grp = new THREE.Group();
    grp.add(mesh);
    grp.position.copy(pos).setY(0.7);
    const glow = new THREE.PointLight(color, 2.5, 8);
    grp.add(glow);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.04, 6, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = Math.PI / 2;
    grp.add(ring);
    this.scene.add(grp);
    this.powerups.push({ mesh: grp, kind });
  }

  private buildMesh(type: EnemyTypeDef): { grp: THREE.Group; visorMat: THREE.MeshStandardMaterial; healthBarFill: THREE.Mesh } {
    const grp = new THREE.Group();
    const s = type.scale;
    const bodyMat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.45, metalness: 0.7 });
    const trimMat = new THREE.MeshStandardMaterial({ color: type.trim, roughness: 0.55, metalness: 0.8 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x050508, emissive: type.visor, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.9 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.5, metalness: 0.9 });

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
    grp.userData['legL'] = buildLeg(-1);
    grp.userData['legR'] = buildLeg(1);

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
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff5500, emissiveIntensity: 0.8 }));
      tip.position.set(0.5*s, 0.98*s, -0.55*s); grp.add(tip);
    }

    if (type === ENEMY_TYPES['BOSS']) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.18*s, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0022, emissiveIntensity: 2.5 }));
      core.position.set(0, 1.3*s, 0.24*s); grp.add(core);
      const coreLight = new THREE.PointLight(0xff0022, 3, 14);
      coreLight.position.set(0, 1.3*s, 0.5*s); grp.add(coreLight);
      const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.6*s, 0.7*s, 0.2*s), trimMat);
      backpack.position.set(0, 1.4*s, -0.28*s); grp.add(backpack);
      for (const a of [-1, 1]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02*s, 0.02*s, 0.6*s, 6), jointMat);
        ant.position.set(a*0.2*s, 2.4*s, -0.28*s); grp.add(ant);
      }
    }

    // Health bar (parent group always faces camera via lookAt in updateEnemies)
    const barH = 0.15 * s;
    const barW = 0.9 * s;
    const barY = (type === ENEMY_TYPES['BOSS'] ? 8.5 : 2.6) * s;
    const barGrp = new THREE.Group();
    barGrp.position.set(0, barY, 0);
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, barH),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    barGrp.add(barBg);
    const healthBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, barH),
      new THREE.MeshBasicMaterial({ color: 0x00ff44, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    healthBarFill.position.z = 0.01;
    barGrp.add(healthBarFill);
    grp.add(barGrp);

    return { grp, visorMat, healthBarFill };
  }

  private pickType(wave: number): EnemyTypeDef {
    const r = Math.random();
    if (wave >= 3 && r < 0.18) return ENEMY_TYPES['RUNNER'];
    if (wave >= 4 && r < 0.32) return ENEMY_TYPES['GUNNER'];
    if (wave >= 5 && r < 0.45) return ENEMY_TYPES['BRUTE'];
    return ENEMY_TYPES['GRUNT'];
  }
}
