import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ThemeRefs } from './LevelThemes';
import type { GameState } from './GameState';

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gunGrp: THREE.Group;
  flashMat: THREE.MeshBasicMaterial;
  themeRefs: ThemeRefs;
  animateEnv(time: number): void;
}

// ── Procedural textures ───────────────────────────────────────────────────────

function makeAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#3a3d42';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const g = 40 + Math.random() * 40;
    x.fillStyle = `rgba(${g},${g},${g + 4},${Math.random() * 0.5})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  x.fillStyle = 'rgba(220,200,90,0.7)';
  for (let j = 0; j < 256; j += 40) x.fillRect(125, j, 6, 22);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  return t;
}

function makeBuildingTexture(base: string, win: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 2000; i++) {
    x.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    x.fillRect(Math.random() * 128, Math.random() * 256, 3, 3);
  }
  for (let wy = 14; wy < 250; wy += 30) {
    for (let wx = 12; wx < 120; wx += 26) {
      const lit = Math.random() > 0.55;
      x.fillStyle = lit ? win : 'rgba(20,28,40,0.95)';
      x.fillRect(wx, wy, 16, 20);
      x.fillStyle = 'rgba(255,255,255,0.12)';
      x.fillRect(wx, wy, 16, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ── Scene setup ───────────────────────────────────────────────────────────────

export function initRenderer(gameState: GameState): SceneRefs {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const W = window.innerWidth;
  const H = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: gameState.settings.quality !== 'low', powerPreference: 'high-performance' });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, gameState.settings.quality === 'high' ? 2 : 1));
  renderer.shadowMap.enabled = gameState.settings.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9bb8d4);
  scene.fog = new THREE.Fog(0x9bb8d4, 40, 130);

  // PBR image-based lighting — metallic surfaces now reflect a real environment
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(72, W / H, 0.1, 300);
  camera.position.set(0, 1.7, 0);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // Lights
  const hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x4a4033, 0.85);
  scene.add(hemiLight);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.1);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.width = sun.shadow.mapSize.height = 1024;
  Object.assign(sun.shadow.camera, { near: 1, far: 150, left: -50, right: 50, top: 50, bottom: -50 });
  scene.add(sun);
  const fillLight = new THREE.DirectionalLight(0xaec8ff, 0.3);
  fillLight.position.set(-20, 20, -20);
  scene.add(fillLight);

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top:    { value: new THREE.Color(0x3a78c2) },
      bottom: { value: new THREE.Color(0xcfe0ee) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
    side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(200, 24, 16), skyMat));

  // Sun disc — glowing sprite placed in the sky toward the directional light
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xfff2c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sunSprite.scale.set(34, 34, 1);
  sunSprite.position.set(80, 110, 60);
  scene.add(sunSprite);

  // Star field — invisible by day, bright at night themes (toggled in applyTheme)
  const STAR_COUNT = 1200;
  const starPos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(190);
    if (v.y < 0) v.y = -v.y; // upper hemisphere only
    starPos[i * 3] = v.x; starPos[i * 3 + 1] = v.y; starPos[i * 3 + 2] = v.z;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.1, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(stars);

  // Ground
  const groundTex = makeAsphaltTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0.0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x5a6b3a, roughness: 1 }),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -0.05;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ── Animated neon grid floor (cyberpunk glow) ──────────────────────────────
  const gridMat = new THREE.ShaderMaterial({
    uniforms: {
      time:  { value: 0 },
      color: { value: new THREE.Color(0x00ffaa) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    extensions: { derivatives: true } as { derivatives: boolean },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform float time;
      uniform vec3 color;
      void main(){
        vec2 g = abs(fract(vUv * 30.0 - 0.5) - 0.5) / fwidth(vUv * 30.0);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        // travelling pulse wave across the grid
        float wave = 0.65 + 0.35 * sin(vUv.x * 12.0 + vUv.y * 12.0 - time * 3.0);
        float edgeFade = 1.0 - smoothstep(0.30, 0.5, length(vUv - 0.5));
        gl_FragColor = vec4(color * line * wave, line * edgeFade * 0.22);
      }
    `,
  });
  const neonGrid = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), gridMat);
  neonGrid.rotation.x = -Math.PI / 2;
  neonGrid.position.y = 0.02;
  scene.add(neonGrid);

  // ── Atmospheric floating dust / embers ─────────────────────────────────────
  const DUST_COUNT = 300;
  const dustPos = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustPos[i * 3]     = (Math.random() - 0.5) * 60;
    dustPos[i * 3 + 1] = Math.random() * 18;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xaad8ff, size: 0.07, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // Perimeter walls
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.9 });
  const wallDefs: [number, number, number, number, number, number][] = [
    [60, 3, 1, 0, 1.5, -30], [60, 3, 1, 0, 1.5, 30],
    [1, 3, 60, -30, 1.5, 0],  [1, 3, 60, 30, 1.5, 0],
  ];
  const neonTrimMat = new THREE.MeshStandardMaterial({ color: 0x002222, emissive: 0x00ffcc, emissiveIntensity: 2.4 });
  for (const [w, h, d, x, y, z] of wallDefs) {
    const wm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concreteMat);
    wm.position.set(x, y, z);
    wm.castShadow = wm.receiveShadow = true;
    scene.add(wm);
    // glowing neon strip along the top edge of each wall
    const horizontal = w > d;
    const stripGeo = horizontal
      ? new THREE.BoxGeometry(w * 0.98, 0.12, 0.16)
      : new THREE.BoxGeometry(0.16, 0.12, d * 0.98);
    const strip = new THREE.Mesh(stripGeo, neonTrimMat);
    strip.position.set(x, y + h / 2 - 0.2, z + (horizontal ? (z < 0 ? 0.55 : -0.55) : 0) + (horizontal ? 0 : (x < 0 ? 0.55 : -0.55)));
    scene.add(strip);
  }

  // City skyline
  const buildingPalette = [
    { base: '#7d8491', win: '#ffd98a' },
    { base: '#6b7280', win: '#bce3ff' },
    { base: '#8a7d6f', win: '#ffe7b0' },
    { base: '#5f6b75', win: '#d6f0ff' },
    { base: '#94795f', win: '#ffcf80' },
  ];
  const buildingTexCache = buildingPalette.map(p => makeBuildingTexture(p.base, p.win));

  function makeBuilding(x: number, z: number, w: number, d: number, h: number, texIdx: number): void {
    const tex = buildingTexCache[texIdx % buildingTexCache.length].clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(2, Math.round(h / 5)));
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
    b.position.set(x, h / 2, z);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  }

  const skyline: [number, number, number, number, number][] = [
    [-45,-45,12,12,28],[-30,-50,10,10,38],[-12,-52,14,14,22],[10,-52,12,12,34],[30,-50,12,12,26],[46,-44,14,14,40],
    [-50,-25,10,10,30],[50,-25,12,12,36],[-52,0,12,12,24],[52,2,10,10,42],[-50,26,12,12,32],[50,28,12,12,28],
    [-46,46,12,12,34],[-26,50,12,12,26],[-6,52,14,14,38],[16,52,12,12,30],[34,50,12,12,44],[48,44,12,12,24],
  ];
  skyline.forEach(([x, z, w, d, h], i) => makeBuilding(x, z, w, d, h, i));

  // Cover objects
  buildCovers(scene);

  // Street lamps
  const streetLights = buildStreetLights(scene);

  // Gun
  const { gunGrp, flashMat } = buildGun(camera);

  window.addEventListener('resize', () => {
    const W2 = window.innerWidth;
    const H2 = window.innerHeight;
    camera.aspect = W2 / H2;
    camera.updateProjectionMatrix();
    renderer.setSize(W2, H2);
  });

  return {
    renderer,
    scene,
    camera,
    gunGrp,
    flashMat,
    animateEnv(time: number): void {
      gridMat.uniforms['time'].value = time;
      // drift dust slowly upward, wrapping at the ceiling
      const arr = dustGeo.attributes['position'].array as Float32Array;
      for (let i = 0; i < DUST_COUNT; i++) {
        arr[i * 3 + 1] += 0.006 + (i % 5) * 0.001;
        if (arr[i * 3 + 1] > 18) arr[i * 3 + 1] = 0;
      }
      dustGeo.attributes['position'].needsUpdate = true;
      // keep grid centred on the player for an infinite-floor illusion
      neonGrid.position.x = Math.round(camera.position.x / 2) * 2;
      neonGrid.position.z = Math.round(camera.position.z / 2) * 2;
    },
    themeRefs: {
      skyMat,
      fogRef: scene.fog as THREE.Fog,
      background: scene.background as THREE.Color,
      floorMat,
      sun,
      hemiLight,
      streetLights,
      stars,
      sunSprite,
      gridMat,
    },
  };
}

function buildCovers(scene: THREE.Scene): void {
  function makeContainer(x: number, z: number, rot: number, colorHex: number): void {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.7, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 2.4), bodyMat);
    body.position.y = 1.2; body.castShadow = body.receiveShadow = true;
    g.add(body);
    const ribMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, metalness: 0.4 });
    for (let r = -2; r <= 2; r += 0.5) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, 2.42), ribMat);
      rib.position.set(r, 1.2, 0);
      g.add(rib);
    }
    g.position.set(x, 0, z); g.rotation.y = rot;
    scene.add(g);
  }

  function makeBarrel(x: number, z: number, colorHex: number): void {
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5, metalness: 0.5 });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12), mat);
    b.position.set(x, 0.6, z); b.castShadow = b.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 6, 16), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.25;
    b.add(ring); scene.add(b);
  }

  function makeBlock(x: number, z: number, w: number, h: number, d: number): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.95 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true;
    scene.add(b);
  }

  makeContainer(8, 7, 0.3, 0xc44a3a); makeContainer(-9, -6, -0.5, 0x3a6ec4);
  makeContainer(12, -10, 1.2, 0xc4a23a); makeContainer(-13, 9, 0.1, 0x3ac46e);
  makeBlock(0, 12, 4, 2, 1.2); makeBlock(0, -12, 4, 2, 1.2);
  makeBlock(15, 3, 1.5, 2.5, 3); makeBlock(-15, -3, 1.5, 2.5, 3);
  makeBlock(6, -4, 2, 1.4, 2); makeBlock(-6, 4, 2, 1.4, 2);
  makeBarrel(4, 6, 0xcc3322); makeBarrel(4.9, 6.3, 0x2255cc); makeBarrel(4.4, 7, 0xccaa22);
  makeBarrel(-5, -7, 0x2255cc); makeBarrel(-5.8, -6.5, 0xcc3322);
  makeBarrel(11, 0, 0x33aa44); makeBarrel(-11, 1, 0xccaa22);
}

function buildStreetLights(scene: THREE.Scene): THREE.PointLight[] {
  const spots: [number, number][] = [[-14,-14],[14,-14],[-14,14],[14,14],[0,0]];
  return spots.map(([x, z]) => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.6, metalness: 0.5 }),
    );
    pole.position.set(x, 2.5, z); pole.castShadow = true; scene.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd070, emissiveIntensity: 0.2 }),
    );
    bulb.position.set(x, 5, z); scene.add(bulb);
    const light = new THREE.PointLight(0xffd070, 0, 22);
    light.position.set(x, 5, z); scene.add(light);
    // volumetric-feel god-ray cone beneath each lamp
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 5, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    cone.position.set(x, 2.5, z);
    scene.add(cone);
    return light;
  });
}

function buildGun(camera: THREE.PerspectiveCamera): { gunGrp: THREE.Group; flashMat: THREE.MeshBasicMaterial } {
  const gunGrp = new THREE.Group();
  camera.add(gunGrp);
  gunGrp.position.set(0.22, -0.18, -0.4);
  const gMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.4, metalness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.6, metalness: 0.7 });

  // receiver / body
  gunGrp.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.46), gMat));
  // barrel
  const gBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 10), gMat);
  gBarrel.rotation.x = Math.PI / 2; gBarrel.position.set(0, 0.02, -0.4);
  gunGrp.add(gBarrel);
  // angled pistol grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), darkMat);
  grip.position.set(0, -0.16, 0.12); grip.rotation.x = 0.35;
  gunGrp.add(grip);
  // magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.09), darkMat);
  mag.position.set(0, -0.15, -0.02); mag.rotation.x = -0.08;
  gunGrp.add(mag);
  // glowing front + rear iron sights
  const sightMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.01), sightMat);
  frontSight.position.set(0, 0.1, -0.32); gunGrp.add(frontSight);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.01), sightMat);
  rearSight.position.set(0, 0.1, 0.16); gunGrp.add(rearSight);
  // side accent strip
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.4), sightMat);
  accent.position.set(0.046, 0.01, 0);
  gunGrp.add(accent);

  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0 });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), flashMat);
  flash.position.set(0, 0.02, -0.62);
  gunGrp.add(flash);
  return { gunGrp, flashMat };
}

/** Rebuild gun visuals when weapon level changes */
export function rebuildGun(gunGrp: THREE.Group, camera: THREE.PerspectiveCamera, level: number, color: number, barrelLen: number, bullets: number): THREE.MeshBasicMaterial {
  while (gunGrp.children.length) gunGrp.remove(gunGrp.children[0]);
  camera.add(gunGrp);
  gunGrp.position.set(0.22, -0.18, -0.4);

  const gMat = new THREE.MeshLambertMaterial({ color: 0x181818 });
  const aMat = new THREE.MeshBasicMaterial({ color });

  const bodyW = 0.08 + level * 0.012;
  const bodyH = 0.12 + level * 0.01;
  gunGrp.add(new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, 0.45 + level * 0.04), gMat));

  const br = 0.018 + level * 0.004;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(br, br, barrelLen, 8), gMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -(0.22 + barrelLen / 2));
  gunGrp.add(barrel);

  const acc = new THREE.Mesh(new THREE.BoxGeometry(0.005, bodyH, 0.45 + level * 0.04), aMat);
  acc.position.set(bodyW / 2 + 0.001, 0, 0);
  gunGrp.add(acc);

  if (bullets > 1) {
    for (const sign of [-1, 1]) {
      const br2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, barrelLen * 0.8, 8), gMat);
      br2.rotation.x = Math.PI / 2;
      br2.position.set(sign * 0.04, 0.02, -(0.22 + barrelLen * 0.8 / 2));
      gunGrp.add(br2);
    }
  }

  if (level >= 3) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8), gMat);
    scope.position.set(0, bodyH / 2 + 0.025, -0.1);
    gunGrp.add(scope);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 8), aMat);
    lens.position.set(0, bodyH / 2 + 0.025, -0.145);
    gunGrp.add(lens);
  }

  if (level >= 4) {
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), aMat);
    fl.position.set(-(bodyW / 2 + 0.015), -0.02, -0.18);
    gunGrp.add(fl);
  }

  const flashMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07 + level * 0.015, 6, 6), flashMat);
  flash.position.set(0, 0.02, -(0.22 + barrelLen + 0.08));
  gunGrp.add(flash);

  return flashMat;
}
