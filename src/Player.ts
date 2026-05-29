import * as THREE from 'three';
import type { GameState } from './GameState';
import type { InputState } from './Input';
import { hudUpdateHealth, hudDamageFlash } from './HUD';
import { SFX } from './AudioEngine';
import { saveHighScore } from './GameState';

const PLAYER_SPEED = 0.07;
const GRAVITY = 0.007;
const JUMP_VEL = 0.14;
const ARENA_BOUND = 28;
const EYE_HEIGHT = 1.7;

export class Player {
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(state: GameState, input: InputState): void {
    if (!state.player.alive) return;

    // Read keyboard move (joystick already set in Input)
    const jx = input.moveX;
    const jy = input.moveY;

    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));

    this.camera.position.addScaledVector(fwd, -jy * PLAYER_SPEED);
    this.camera.position.addScaledVector(rgt, jx * PLAYER_SPEED);

    // Jump
    if (input.jumpPressed && state.player.onGround) {
      state.player.velY = JUMP_VEL;
      state.player.onGround = false;
    }
    state.player.velY -= GRAVITY;
    this.camera.position.y += state.player.velY;
    if (this.camera.position.y <= EYE_HEIGHT) {
      this.camera.position.y = EYE_HEIGHT;
      state.player.velY = 0;
      state.player.onGround = true;
    }

    // Arena bounds
    this.camera.position.x = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.camera.position.x));
    this.camera.position.z = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.camera.position.z));

    // Apply camera rotation from input
    this.camera.rotation.y = input.yaw;
    this.camera.rotation.x = input.pitch;

    // Screen shake decay
    if (state.screenShake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * state.screenShake * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * state.screenShake * 0.3;
      state.screenShake *= 0.85;
    }
  }

  takeDamage(amount: number, state: GameState, onDeath: () => void): void {
    if (!state.player.alive) return;
    const reduction = Math.max(0.4, 1 - state.perks.dmgReductLvl * 0.12);
    state.player.health -= amount * reduction;
    hudDamageFlash();
    SFX.hurt();
    state.screenShake = Math.max(state.screenShake, 0.15);
    state.killStreak = 0;
    state.scoreMultiplier = 1;
    hudUpdateHealth(state);
    if (state.player.health <= 0) {
      state.player.alive = false;
      state.player.health = 0;
      saveHighScore(state.player.score);
      onDeath();
    }
  }
}
