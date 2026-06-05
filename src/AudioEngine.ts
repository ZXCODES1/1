import type { GameState } from './GameState';

let actx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let reverbSend: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicPlaying = false;
let musicNodes: OscillatorNode[] = [];

// iOS Safari requires webkitAudioContext fallback; creation must be inside a user-gesture handler
export function initAudio(): void {
  if (actx) return;
  try {
    const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    actx = new Ctx();

    // Master compressor — prevents ear-blasting during intense fights
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(actx.destination);

    masterGain = actx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(comp);

    // Reverb send bus for spatial depth
    reverbSend = actx.createGain();
    reverbSend.gain.value = 0.18;
    buildReverb().then(conv => {
      if (!conv || !reverbSend || !masterGain) return;
      reverbSend.connect(conv);
      conv.connect(masterGain);
    });

    musicGain = actx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(masterGain);

  } catch {
    // Audio unavailable — game works without sound
  }
}

async function buildReverb(): Promise<ConvolverNode | null> {
  if (!actx) return null;
  const len = actx.sampleRate * 2.0;
  const buf = actx.createBuffer(2, len, actx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  const conv = actx.createConvolver();
  conv.buffer = buf;
  return conv;
}

export function setVolume(state: GameState): void {
  if (masterGain) masterGain.gain.value = state.settings.volume;
}

// ── Ambient music ─────────────────────────────────────────────────────────────

// Pentatonic scale in Hz (A minor penta)
const PENTA = [110, 130.8, 146.8, 164.8, 196, 220, 261.6, 293.7, 329.6, 392];

export function startMusic(wave: number): void {
  if (!actx || !musicGain || musicPlaying) return;
  musicPlaying = true;

  const intensity = Math.min(1, wave / 10);

  // Bass drone — 2 detuned saws
  for (const detune of [-8, 8]) {
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    osc.detune.value = detune;
    g.gain.value = 0.06 + intensity * 0.04;
    osc.connect(g); g.connect(musicGain!);
    osc.start(); musicNodes.push(osc);
  }

  // Arpeggio — cycles through pentatonic, rate increases with wave
  const noteMs = Math.max(120, 400 - wave * 20);
  let step = 0;
  const arpLoop = () => {
    if (!musicPlaying || !actx || !musicGain) return;
    const freq = PENTA[step % PENTA.length];
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq * 2;
    g.gain.setValueAtTime(0.04 + intensity * 0.04, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + noteMs / 1000 * 0.8);
    o.connect(g); g.connect(musicGain!);
    o.start(); o.stop(actx.currentTime + noteMs / 1000);
    step++;
    setTimeout(arpLoop, noteMs);
  };

  // Fade music in
  musicGain.gain.setValueAtTime(0, actx.currentTime);
  musicGain.gain.linearRampToValueAtTime(0.25 + intensity * 0.2, actx.currentTime + 3);

  setTimeout(arpLoop, 500);
}

export function stopMusic(): void {
  musicPlaying = false;
  musicNodes.forEach(o => { try { o.stop(); } catch { /* already stopped */ } });
  musicNodes = [];
  if (actx && musicGain) {
    musicGain.gain.setValueAtTime(musicGain.gain.value, actx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0, actx.currentTime + 1);
  }
}

// ── Core synthesis ────────────────────────────────────────────────────────────

function blip(
  freq: number,
  dur: number,
  type: OscillatorType = 'square',
  vol = 0.2,
  sweep?: number,
  reverb = false,
): void {
  if (!actx || !masterGain) return;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, actx.currentTime);
  if (sweep !== undefined) {
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * sweep), actx.currentTime + dur);
  }
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g);
  g.connect(masterGain);
  if (reverb && reverbSend) g.connect(reverbSend);
  o.start(); o.stop(actx.currentTime + dur);
}

function noiseBurst(dur: number, vol = 0.3, filterFreq = 2000, reverb = false): void {
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
  src.connect(f); f.connect(g); g.connect(masterGain);
  if (reverb && reverbSend) g.connect(reverbSend);
  src.start();
}

// 3D-positioned sound — pan based on angle to player camera
export function positionalBlip(
  freq: number, dur: number, type: OscillatorType,
  vol: number, worldX: number, worldZ: number,
  cameraX: number, cameraZ: number, cameraYaw: number,
): void {
  if (!actx || !masterGain) return;
  const dx = worldX - cameraX;
  const dz = worldZ - cameraZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const distVol = Math.max(0, 1 - dist / 28);
  if (distVol < 0.02) return;

  const angle = Math.atan2(dx, -dz) - cameraYaw;
  const pan = Math.max(-1, Math.min(1, Math.sin(angle)));

  const o = actx.createOscillator();
  const g = actx.createGain();
  const panner = actx.createStereoPanner();
  panner.pan.value = pan;
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol * distVol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g); g.connect(panner); panner.connect(masterGain);
  o.start(); o.stop(actx.currentTime + dur);
}

export const SFX = {
  shoot(level: number): void {
    blip(420 - level * 20, 0.08, 'sawtooth', 0.16, 0.4);
    noiseBurst(0.06, 0.12, 3000);
  },
  shotgun(): void { noiseBurst(0.15, 0.32, 1800); blip(180, 0.12, 'sawtooth', 0.22, 0.3); },
  rail(): void { blip(880, 0.35, 'sine', 0.28, 0.1, true); noiseBurst(0.2, 0.22, 6000); },
  hit(): void { blip(900, 0.04, 'square', 0.12, 1.4); },
  enemyDie(): void { blip(120, 0.22, 'sawtooth', 0.2, 0.25, true); noiseBurst(0.14, 0.16, 1000); },
  bossDie(): void {
    blip(60, 0.9, 'sawtooth', 0.35, 0.15, true);
    noiseBurst(0.8, 0.4, 600, true);
    setTimeout(() => blip(40, 0.6, 'sawtooth', 0.2, 0.1, true), 200);
  },
  bossEnrage(): void {
    [80, 100, 130, 160].forEach((f, i) =>
      setTimeout(() => blip(f, 0.2, 'sawtooth', 0.25, 0.1, true), i * 80));
    noiseBurst(0.4, 0.3, 800, true);
  },
  hurt(): void { blip(100, 0.22, 'square', 0.22, 0.5); noiseBurst(0.1, 0.1, 800); },
  reload(): void {
    blip(300, 0.05, 'square', 0.1);
    setTimeout(() => blip(500, 0.06, 'square', 0.14), 180);
    setTimeout(() => blip(700, 0.04, 'square', 0.1), 340);
  },
  upgrade(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      setTimeout(() => blip(f, 0.14, 'triangle', 0.22, 1.02, true), i * 65));
  },
  wave(): void {
    blip(330, 0.15, 'triangle', 0.2, 1.0, true);
    setTimeout(() => blip(440, 0.2, 'triangle', 0.2, 1.0, true), 150);
  },
  buy(): void { blip(660, 0.08, 'square', 0.18); setTimeout(() => blip(990, 0.1, 'square', 0.18), 70); },
  nuke(): void { noiseBurst(1.0, 0.5, 400, true); blip(50, 1.0, 'sawtooth', 0.4, 0.25, true); },
  enemyShoot(isBoss: boolean): void { blip(isBoss ? 180 : 340, 0.1, 'sawtooth', 0.12, 0.45); },
  airstrike(): void {
    noiseBurst(0.6, 0.4, 1200, true);
    blip(80, 0.5, 'sawtooth', 0.3, 0.2, true);
  },
  grenade(): void { noiseBurst(0.08, 0.15, 2000); blip(600, 0.05, 'square', 0.12); },
  grenadeExplosion(): void {
    noiseBurst(0.5, 0.4, 800, true);
    blip(100, 0.4, 'sawtooth', 0.3, 0.2, true);
  },
  footstep(): void { blip(60, 0.04, 'sine', 0.04); },
};
