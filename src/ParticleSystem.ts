import * as THREE from 'three';
import type { PooledParticle, FloatNum } from './types';

const POOL_SIZE = 120;
const FLOAT_NUM_LIFE = 50;

export class ParticleSystem {
  private pool: PooledParticle[] = [];
  private floatNums: FloatNum[] = [];
  private camera: THREE.PerspectiveCamera;
  private hudEl: HTMLElement;
  private W: number;
  private H: number;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.hudEl = document.getElementById('hud')!;
    this.W = window.innerWidth;
    this.H = window.innerHeight;

    const geo = new THREE.SphereGeometry(0.04, 4, 4);
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true });
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

  spawnBlood(pos: THREE.Vector3, color: number, count = 6): void {
    let spawned = 0;
    for (const p of this.pool) {
      if (p.active) continue;
      p.active = true;
      p.mesh.visible = true;
      (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      p.mesh.position.copy(pos);
      p.vel.set(
        (Math.random() - 0.5) * 0.16,
        Math.random() * 0.15,
        (Math.random() - 0.5) * 0.16,
      );
      p.maxLife = 22 + Math.floor(Math.random() * 18);
      p.life = p.maxLife;
      if (++spawned >= count) break;
    }
  }

  spawnFloatNum(worldPos: THREE.Vector3, text: string | number, color = '#ffdd44'): void {
    const el = document.createElement('div');
    el.className = 'floatnum';
    el.textContent = String(text);
    el.style.color = color;
    this.hudEl.appendChild(el);
    this.floatNums.push({ el, worldPos: worldPos.clone(), life: FLOAT_NUM_LIFE });
  }

  /** Call every logic tick */
  update(): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.mesh.position.add(p.vel);
      p.vel.y -= 0.008;
      p.life--;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.maxLife;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
      }
    }

    for (let i = this.floatNums.length - 1; i >= 0; i--) {
      const f = this.floatNums[i];
      f.life--;
      f.worldPos.y += 0.02;
      const v = f.worldPos.clone().project(this.camera);
      if (v.z > 1) {
        f.el.style.display = 'none';
      } else {
        f.el.style.display = 'block';
        f.el.style.left = (v.x * 0.5 + 0.5) * this.W + 'px';
        f.el.style.top  = (-v.y * 0.5 + 0.5) * this.H + 'px';
        f.el.style.opacity = String(Math.max(0, f.life / FLOAT_NUM_LIFE));
      }
      if (f.life <= 0) {
        f.el.remove();
        this.floatNums.splice(i, 1);
      }
    }
  }
}
