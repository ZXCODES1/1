import type { GameState } from './GameState';

let actx: AudioContext | null = null;
let masterGain: GainNode | null = null;

// iOS Safari requires webkitAudioContext fallback; creation must be inside a user-gesture handler
export function initAudio(): void {
  if (actx) return;
  try {
    const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    actx = new Ctx();
    masterGain = actx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(actx.destination);
  } catch {
    // Audio unavailable — game still works without sound
  }
}

export function setVolume(state: GameState): void {
  if (masterGain) masterGain.gain.value = state.settings.volume;
}

function blip(
  freq: number,
  dur: number,
  type: OscillatorType = 'square',
  vol = 0.2,
  sweep?: number,
): void {
  if (!actx || !masterGain) return;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, actx.currentTime);
  if (sweep !== undefined) {
    o.frequency.exponentialRampToValueAtTime(
      Math.max(20, freq * sweep),
      actx.currentTime + dur,
    );
  }
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start();
  o.stop(actx.currentTime + dur);
}

function noiseBurst(dur: number, vol = 0.3, filterFreq = 2000): void {
  if (!actx || !masterGain) return;
  const n = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const g = actx.createGain();
  g.gain.value = vol;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterFreq;
  src.connect(f);
  f.connect(g);
  g.connect(masterGain);
  src.start();
}

export const SFX = {
  shoot(level: number): void { blip(420 - level * 20, 0.08, 'sawtooth', 0.16, 0.4); noiseBurst(0.06, 0.12, 3000); },
  shotgun(): void { noiseBurst(0.15, 0.3, 1800); blip(180, 0.12, 'sawtooth', 0.2, 0.3); },
  rail(): void { blip(880, 0.3, 'sine', 0.25, 0.1); noiseBurst(0.2, 0.2, 5000); },
  hit(): void { blip(700, 0.05, 'square', 0.1, 1.2); },
  enemyDie(): void { blip(160, 0.18, 'sawtooth', 0.18, 0.3); noiseBurst(0.12, 0.15, 1200); },
  bossDie(): void { blip(90, 0.6, 'sawtooth', 0.3, 0.2); noiseBurst(0.5, 0.3, 800); },
  hurt(): void { blip(120, 0.18, 'square', 0.2, 0.6); },
  reload(): void {
    blip(300, 0.05, 'square', 0.1);
    setTimeout(() => blip(440, 0.06, 'square', 0.12), 180);
  },
  upgrade(): void {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.12, 'triangle', 0.2), i * 70));
  },
  wave(): void { blip(330, 0.15, 'triangle', 0.2); setTimeout(() => blip(440, 0.2, 'triangle', 0.2), 150); },
  buy(): void { blip(660, 0.08, 'square', 0.18); setTimeout(() => blip(990, 0.1, 'square', 0.18), 70); },
  nuke(): void { noiseBurst(0.8, 0.4, 600); blip(60, 0.8, 'sawtooth', 0.35, 0.3); },
  enemyShoot(isBoss: boolean): void { blip(isBoss ? 200 : 320, 0.08, 'sawtooth', 0.1, 0.5); },
};
