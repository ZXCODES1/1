import type { GameState } from './GameState';

export interface InputState {
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  jumpPressed: boolean;
  shootHeld: boolean;
  reloadPressed: boolean;
  nukePressed: boolean;
  pausePressed: boolean;
}

export type InputCallbacks = {
  onShoot: () => void;
  onReload: () => void;
  onNuke: () => void;
  onPause: () => void;
};

const JOYSTICK_MAX_R = 44;

export class Input {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: 0,
    jumpPressed: false,
    shootHeld: false,
    reloadPressed: false,
    nukePressed: false,
    pausePressed: false,
  };

  private keys: Record<string, boolean> = {};
  private joyActive = false;
  private joyTouchId = -1;
  private joyBaseX = 0;
  private joyBaseY = 0;
  private lookActive = false;
  private lookTouchId = -1;
  private lookLastX = 0;
  private lookLastY = 0;
  private fireInterval: ReturnType<typeof setInterval> | null = null;
  private gameState: GameState;
  private cbs: InputCallbacks;

  constructor(canvas: HTMLCanvasElement, gameState: GameState, cbs: InputCallbacks) {
    this.gameState = gameState;
    this.cbs = cbs;
    this.bindKeyboard();
    this.bindMouse(canvas);
    this.bindTouch();
    this.bindButtons();
  }

  updateSensitivity(sens: number): void {
    // sensitivity is read each frame from gameState.settings
    void sens;
  }

  private get sens(): number {
    return this.gameState.settings.sensitivity * 0.0004;
  }

  private bindKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyR') this.cbs.onReload();
      if (e.code === 'KeyF') this.cbs.onShoot();
      if (e.code === 'Escape' || e.code === 'KeyP') this.cbs.onPause();
      if (e.code === 'KeyN') this.cbs.onNuke();
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  private bindMouse(canvas: HTMLCanvasElement): void {
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.state.yaw -= e.movementX * this.sens;
      this.state.pitch -= e.movementY * this.sens;
      this.state.pitch = Math.max(-1.1, Math.min(1.1, this.state.pitch));
    });
    canvas.addEventListener('click', () => {
      // requestPointerLock is not supported on iOS — guard before calling
      if (this.gameState.phase === 'playing' && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
    });
    // hold left mouse to fire
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.gameState.phase === 'playing') {
        this.state.shootHeld = true;
        this.cbs.onShoot();
        if (this.fireInterval) clearInterval(this.fireInterval);
        this.fireInterval = setInterval(() => this.cbs.onShoot(), 100);
      }
    });
    canvas.addEventListener('mouseup', () => {
      this.state.shootHeld = false;
      if (this.fireInterval) { clearInterval(this.fireInterval); this.fireInterval = null; }
    });
  }

  private bindTouch(): void {
    const jZone = document.getElementById('joystickZone')!;
    const jKnob = document.getElementById('joystickKnob') as HTMLElement;
    const lookZone = document.getElementById('lookZone')!;

    jZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.joyActive = true;
      this.joyTouchId = t.identifier;
      const r = jZone.getBoundingClientRect();
      this.joyBaseX = r.left + r.width / 2;
      this.joyBaseY = r.top + r.height / 2;
    }, { passive: false });

    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.lookActive = true;
      this.lookTouchId = t.identifier;
      this.lookLastX = t.clientX;
      this.lookLastY = t.clientY;
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.joyActive && t.identifier === this.joyTouchId) {
          let dx = t.clientX - this.joyBaseX;
          let dy = t.clientY - this.joyBaseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > JOYSTICK_MAX_R) { dx = (dx / dist) * JOYSTICK_MAX_R; dy = (dy / dist) * JOYSTICK_MAX_R; }
          this.state.moveX = dx / JOYSTICK_MAX_R;
          this.state.moveY = dy / JOYSTICK_MAX_R;
          jKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }
        if (this.lookActive && t.identifier === this.lookTouchId) {
          const movX = t.clientX - this.lookLastX;
          const movY = t.clientY - this.lookLastY;
          this.state.yaw -= movX * this.sens * 10;
          this.state.pitch -= movY * this.sens * 10;
          this.state.pitch = Math.max(-1.1, Math.min(1.1, this.state.pitch));
          this.lookLastX = t.clientX;
          this.lookLastY = t.clientY;
        }
      }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.joyActive && t.identifier === this.joyTouchId) {
          this.joyActive = false;
          this.state.moveX = 0;
          this.state.moveY = 0;
          jKnob.style.transform = 'translate(-50%, -50%)';
        }
        if (this.lookActive && t.identifier === this.lookTouchId) {
          this.lookActive = false;
        }
      }
    }, { passive: false });
  }

  private bindButtons(): void {
    const fireBtn = document.getElementById('fireBtn')!;
    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      fireBtn.classList.add('firing');
      this.cbs.onShoot();
      if (this.fireInterval) clearInterval(this.fireInterval);
      this.fireInterval = setInterval(() => this.cbs.onShoot(), 140);
    }, { passive: false });
    fireBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      fireBtn.classList.remove('firing');
      if (this.fireInterval) { clearInterval(this.fireInterval); this.fireInterval = null; }
    }, { passive: false });

    const reloadBtn = document.getElementById('reloadBtn')!;
    reloadBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.cbs.onReload(); }, { passive: false });

    const nukeBtn = document.getElementById('nukeBtn')!;
    nukeBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.cbs.onNuke(); }, { passive: false });
    nukeBtn.addEventListener('click', () => this.cbs.onNuke());

    document.getElementById('pauseBtn')!.addEventListener('click', () => this.cbs.onPause());
  }

  /** Call every logic tick to compute directional move from keyboard */
  readKeyboardMove(): void {
    let x = 0, y = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) y = -1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) y = 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x = -1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x = 1;
    // keyboard overrides joystick
    if (x !== 0 || y !== 0) { this.state.moveX = x; this.state.moveY = y; }
    this.state.jumpPressed = !!this.keys['Space'];
  }
}
