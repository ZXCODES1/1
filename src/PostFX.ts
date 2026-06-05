import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Custom shader: vignette + film grain + chromatic aberration
const ScreenFXShader = {
  uniforms: {
    tDiffuse:   { value: null as THREE.Texture | null },
    time:       { value: 0 },
    chromatic:  { value: 0.002 },
    grain:      { value: 0.04 },
    vignette:   { value: 0.55 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float chromatic;
    uniform float grain;
    uniform float vignette;
    varying vec2 vUv;

    float rand(vec2 co){ return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;

      // chromatic aberration
      vec2 ca = center * chromatic;
      float r = texture2D(tDiffuse, uv + ca).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - ca).b;
      vec4 col = vec4(r, g, b, 1.0);

      // vignette
      float dist = length(center);
      col.rgb *= smoothstep(0.85, 0.15, dist * vignette);

      // film grain
      col.rgb += (rand(uv + fract(time)) - 0.5) * grain;

      gl_FragColor = col;
    }
  `,
};

export interface PostFX {
  composer: EffectComposer;
  update(time: number): void;
  triggerChromaticSpike(intensity: number, durationMs: number): void;
  triggerBloomSpike(strength: number, durationMs: number): void;
}

export function initPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostFX {
  const W = window.innerWidth;
  const H = window.innerHeight;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(W, H),
    0.9,   // strength
    0.6,   // radius
    0.25,  // threshold — anything brighter than this blooms
  );
  composer.addPass(bloomPass);

  const fxPass = new ShaderPass(ScreenFXShader);
  composer.addPass(fxPass);
  composer.addPass(new OutputPass());

  window.addEventListener('resize', () => {
    const W2 = window.innerWidth;
    const H2 = window.innerHeight;
    composer.setSize(W2, H2);
    bloomPass.resolution.set(W2, H2);
  });

  let chromaticBase = 0.002;

  const self: PostFX = {
    composer,

    update(time: number) {
      (fxPass.uniforms as typeof ScreenFXShader.uniforms)['time'].value = time;
    },

    triggerChromaticSpike(intensity: number, durationMs: number) {
      (fxPass.uniforms as typeof ScreenFXShader.uniforms)['chromatic'].value = intensity;
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / durationMs;
        if (t >= 1) {
          (fxPass.uniforms as typeof ScreenFXShader.uniforms)['chromatic'].value = chromaticBase;
          return;
        }
        // ease out
        const ease = 1 - t * t;
        (fxPass.uniforms as typeof ScreenFXShader.uniforms)['chromatic'].value = chromaticBase + intensity * ease;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },

    triggerBloomSpike(strength: number, durationMs: number) {
      const original = bloomPass.strength;
      bloomPass.strength = strength;
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / durationMs;
        if (t >= 1) { bloomPass.strength = original; return; }
        bloomPass.strength = original + (strength - original) * (1 - t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
  };

  return self;
}
