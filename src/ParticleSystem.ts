import * as THREE from 'three';
import type { PooledParticle, FloatNum } from './types';

const POOL_SIZE = 500;
const FLOAT_NUM_LIFE = 55;

interface ShockwaveRing {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface Decal {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

const MAX_DECALS = 40;

function makeScorchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.5, 'rgba(20,10,5,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  // a few cracks
  x.strokeStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    x.beginPath(); x.moveTo(64, 64);
    x.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
    x.lineWidth = Math.random() * 2; x.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class ParticleSystem {
  private pool: PooledParticle[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private floatNums: FloatNum[] = [];
  private decals: Decal[] = [];
  private scorchTex: THREE.CanvasTexture;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hudEl: HTMLElement;
  private W: number;
  private H: number;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.hudEl = document.getElementById('hud')!;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.scorchTex = makeScorchTexture();

    const geo = new THREE.SphereGeometry(0.05, 4, 4);
    for (let i = 0; i < POOL_SIZE; i++) {
      // Half the pool uses additive blending (fire/glow), half normal (blood/debris)
      const additive = i < POOL_SIZE / 2;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff2244,
        transparent: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 40, active: false });
    }

    window.addEventListener('resize', () => {
      this.W = window.innerWidth;
      this.H = window.innerHeight;
    });
  }

  // ── spawn helpers ──────────────────────────────────────────────────────────

  spawnBlood(pos: THREE.Vector3, color: number, count = 8): void {
    this.spawn(pos, color, count, {
      speed: 0.18, gravity: 0.01, life: [20, 40], size: [0.04, 0.10], additive: false,
    });
  }

  spawnExplosion(pos: THREE.Vector3, count = 40): void {
    // Fire core
    this.spawn(pos, 0xff6600, Math.ceil(count * 0.5), {
      speed: 0.3, gravity: -0.003, life: [20, 45], size: [0.07, 0.18], additive: true,
    });
    // Bright inner flash
    this.spawn(pos, 0xffff88, Math.ceil(count * 0.2), {
      speed: 0.15, gravity: 0.0, life: [8, 18], size: [0.1, 0.25], additive: true,
    });
    // Dark smoke (rises)
    this.spawn(pos, 0x222222, Math.ceil(count * 0.3), {
      speed: 0.06, gravity: -0.006, life: [40, 80], size: [0.1, 0.22], additive: false,
    });
    // Scorch mark on the ground below the blast
    this.spawnDecal(pos, 1.2 + count * 0.02);
  }

  spawnSmoke(pos: THREE.Vector3, count = 6): void {
    this.spawn(pos, 0x333333, count, {
      speed: 0.04, gravity: -0.005, life: [30, 60], size: [0.08, 0.16], additive: false,
    });
  }

  spawnDecal(pos: THREE.Vector3, size = 1.4): void {
    const mat = new THREE.MeshBasicMaterial({
      map: this.scorchTex, transparent: true, opacity: 0.8,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(pos.x, 0.03, pos.z);
    this.scene.add(mesh);
    this.decals.push({ mesh, life: 600, maxLife: 600 });
    // Recycle the oldest decal once the cap is reached
    if (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift()!;
      this.scene.remove(old.mesh);
    }
  }

  spawnBossExplosion(pos: THREE.Vector3): void {
    this.spawnExplosion(pos, 80);
    // Extra spiral debris
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const r = 0.4 + Math.random() * 0.4;
      this.spawnSingle(
        pos.clone().add(new THREE.Vector3(Math.cos(ang) * r, Math.random() * 0.5, Math.sin(ang) * r)),
        0xff2200, { speed: 0.4, gravity: 0.012, life: [30, 60], size: [0.06, 0.14], additive: true },
      );
    }
    this.spawnShockwave(pos, 0xff4400);
  }

  spawnMuzzleSparks(pos: THREE.Vector3, dir: THREE.Vector3, color: number, count = 12): void {
    for (let i = 0; i < count; i++) {
      const slot = this.pool.find(p => !p.active);
      if (!slot) break;
      const spread = 0.5;
      const vel = dir.clone().multiplyScalar(0.3 + Math.random() * 0.4).add(
        new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.5, (Math.random() - 0.5) * spread),
      );
      this.activateSlot(slot, pos, color, vel, 10 + Math.floor(Math.random() * 12), 0.05, true);
    }
  }

  spawnShells(pos: THREE.Vector3, right: THREE.Vector3, count = 1): void {
    for (let i = 0; i < count; i++) {
      const slot = this.pool.find(p => !p.active && (p.mesh.material as THREE.MeshBasicMaterial).blending === THREE.NormalBlending);
      if (!slot) break;
      const vel = right.clone().multiplyScalar(0.06 + Math.random() * 0.05);
      vel.y = 0.08 + Math.random() * 0.04;
      vel.x += (Math.random() - 0.5) * 0.02;
      vel.z += (Math.random() - 0.5) * 0.02;
      this.activateSlot(slot, pos, 0xffcc44, vel, 22 + Math.floor(Math.random() * 8), 0.035, false);
    }
  }

  spawnShockwave(pos: THREE.Vector3, color: number): void {
    const geo = new THREE.TorusGeometry(0.5, 0.12, 6, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(pos).setY(0.3);
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, life: 30, maxLife: 30 });
  }

  spawnFloatNum(worldPos: THREE.Vector3, text: string | number, color = '#ffdd44'): void {
    const el = document.createElement('div');
    el.className = 'floatnum';
    el.textContent = String(text);
    el.style.color = color;
    this.hudEl.appendChild(el);
    this.floatNums.push({ el, worldPos: worldPos.clone(), life: FLOAT_NUM_LIFE });
  }

  // ── update ─────────────────────────────────────────────────────────────────

  update(): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.mesh.position.add(p.vel);
      p.vel.y -= 0.008;
      p.life--;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = (p.life / p.maxLife) * 0.9;
      if (p.life <= 0) { p.active = false; p.mesh.visible = false; }
    }

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const dc = this.decals[i];
      dc.life--;
      // hold full opacity, then fade out over the last 120 ticks
      const mat = dc.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(0.8, (dc.life / 120) * 0.8);
      if (dc.life <= 0) { this.scene.remove(dc.mesh); this.decals.splice(i, 1); }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life--;
      const t = 1 - sw.life / sw.maxLife;
      const scale = 1 + t * 14;
      sw.mesh.scale.setScalar(scale);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.7;
      if (sw.life <= 0) { this.scene.remove(sw.mesh); this.shockwaves.splice(i, 1); }
    }

    for (let i = this.floatNums.length - 1; i >= 0; i--) {
      const f = this.floatNums[i];
      f.life--;
      f.worldPos.y += 0.025;
      const v = f.worldPos.clone().project(this.camera);
      if (v.z > 1) {
        f.el.style.display = 'none';
      } else {
        f.el.style.display = 'block';
        f.el.style.left = (v.x * 0.5 + 0.5) * this.W + 'px';
        f.el.style.top  = (-v.y * 0.5 + 0.5) * this.H + 'px';
        f.el.style.opacity = String(Math.max(0, f.life / FLOAT_NUM_LIFE));
        f.el.style.transform = `translate(-50%,-50%) scale(${0.8 + 0.2 * (f.life / FLOAT_NUM_LIFE)})`;
      }
      if (f.life <= 0) { f.el.remove(); this.floatNums.splice(i, 1); }
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private spawn(
    pos: THREE.Vector3, color: number, count: number,
    opts: { speed: number; gravity: number; life: [number, number]; size: [number, number]; additive: boolean },
  ): void {
    let spawned = 0;
    for (const p of this.pool) {
      if (p.active) continue;
      // Match additive vs normal blending slot
      const isAdditive = (p.mesh.material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending;
      if (isAdditive !== opts.additive) continue;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * opts.speed * 2,
        Math.random() * opts.speed,
        (Math.random() - 0.5) * opts.speed * 2,
      );
      const life = opts.life[0] + Math.floor(Math.random() * (opts.life[1] - opts.life[0]));
      const size = opts.size[0] + Math.random() * (opts.size[1] - opts.size[0]);
      this.activateSlot(p, pos, color, vel, life, size, opts.additive);
      if (++spawned >= count) break;
    }
  }

  private spawnSingle(
    pos: THREE.Vector3, color: number,
    opts: { speed: number; gravity: number; life: [number, number]; size: [number, number]; additive: boolean },
  ): void {
    const p = this.pool.find(p => !p.active && ((p.mesh.material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending) === opts.additive);
    if (!p) return;
    const vel = new THREE.Vector3((Math.random()-0.5)*opts.speed*2, Math.random()*opts.speed*0.5, (Math.random()-0.5)*opts.speed*2);
    const life = opts.life[0] + Math.floor(Math.random()*(opts.life[1]-opts.life[0]));
    const size = opts.size[0] + Math.random()*(opts.size[1]-opts.size[0]);
    this.activateSlot(p, pos, color, vel, life, size, opts.additive);
  }

  private activateSlot(
    slot: PooledParticle, pos: THREE.Vector3, color: number,
    vel: THREE.Vector3, life: number, size: number, _additive: boolean,
  ): void {
    slot.active = true;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(size / 0.05);
    (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    slot.mesh.position.copy(pos);
    slot.vel.copy(vel);
    slot.maxLife = life;
    slot.life = life;
  }
}
