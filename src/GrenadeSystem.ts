import * as THREE from 'three';
import type { GameState } from './GameState';
import type { EnemyManager } from './EnemyManager';
import type { ParticleSystem } from './ParticleSystem';
import { SFX } from './AudioEngine';
import { hudGrenadeCount } from './HUD';

interface Grenade {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  vel: THREE.Vector3;
  fuse: number;     // ticks until detonation
  active: boolean;
}

const POOL = 6;
const GRAVITY = 0.012;
const BLAST_RADIUS = 6;
const BLAST_DMG = 60;

export class GrenadeSystem {
  private pool: Grenade[] = [];
  private camera: THREE.PerspectiveCamera;
  private enemyMgr: EnemyManager;
  private particles: ParticleSystem;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, enemyMgr: EnemyManager, particles: ParticleSystem) {
    this.camera = camera;
    this.enemyMgr = enemyMgr;
    this.particles = particles;

    const geo = new THREE.IcosahedronGeometry(0.12, 0);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a3a22, emissive: 0x88ff00, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      const light = new THREE.PointLight(0x88ff00, 0, 6);
      mesh.add(light);
      this.pool.push({ mesh, light, vel: new THREE.Vector3(), fuse: 0, active: false });
    }
  }

  throw(state: GameState): void {
    if (state.grenadeStock <= 0 || !state.player.alive) return;
    const slot = this.pool.find(g => !g.active);
    if (!slot) return;
    state.grenadeStock--;
    hudGrenadeCount(state.grenadeStock);
    SFX.grenade();

    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    slot.mesh.position.copy(this.camera.position).addScaledVector(fwd, 0.6);
    slot.vel.copy(fwd).multiplyScalar(0.42);
    slot.vel.y += 0.16; // lob arc
    slot.fuse = 80;
    slot.active = true;
    slot.mesh.visible = true;
    slot.light.intensity = 1.5;
  }

  update(state: GameState): void {
    for (const g of this.pool) {
      if (!g.active) continue;
      g.vel.y -= GRAVITY;
      g.mesh.position.add(g.vel);
      g.mesh.rotation.x += 0.3; g.mesh.rotation.y += 0.2;
      g.fuse--;

      // blink faster as the fuse runs down
      g.light.intensity = 1 + Math.sin(g.fuse * 0.6) * 1.2;

      // bounce off the ground, losing energy
      if (g.mesh.position.y <= 0.12) {
        g.mesh.position.y = 0.12;
        g.vel.y = Math.abs(g.vel.y) * 0.45;
        g.vel.x *= 0.6; g.vel.z *= 0.6;
        if (g.vel.y < 0.02) g.vel.y = 0;
      }

      if (g.fuse <= 0) {
        this.detonate(g, state);
      }
    }
  }

  private detonate(g: Grenade, state: GameState): void {
    g.active = false;
    g.mesh.visible = false;
    g.light.intensity = 0;
    this.particles.spawnDecal(g.mesh.position.clone(), 2.4);
    this.enemyMgr.damageArea(g.mesh.position.clone(), BLAST_RADIUS, BLAST_DMG, state);
    // knock the player if they're caught in the blast
    const d = this.camera.position.distanceTo(g.mesh.position);
    if (d < BLAST_RADIUS) state.screenShake = Math.max(state.screenShake, 0.5);
  }
}
