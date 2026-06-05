import * as THREE from 'three';
import type { LevelTheme } from './types';

export const LEVEL_THEMES: LevelTheme[] = [
  { name: 'DOWNTOWN',   skyTop: 0x3a78c2, skyBot: 0xcfe0ee, fog: 0x9bb8d4, ground: 0x3a3d42, sun: 0xfff2d6, sunI: 1.1, hemi: 0.85, fogNear: 40, fogFar: 130, grid: 0x00ffaa },
  { name: 'WÜSTE',      skyTop: 0xe0a85a, skyBot: 0xf5e0b0, fog: 0xe8c890, ground: 0xc2a060, sun: 0xffe0a0, sunI: 1.3, hemi: 0.90, fogNear: 30, fogFar: 120, grid: 0xffcc44 },
  { name: 'NACHT-RAID', skyTop: 0x05060f, skyBot: 0x1a2a45, fog: 0x0a1020, ground: 0x1c2230, sun: 0x6a80c0, sunI: 0.4, hemi: 0.35, fogNear: 25, fogFar: 90,  grid: 0x33ccff },
  { name: 'TOXIC ZONE', skyTop: 0x143a14, skyBot: 0x3a5a28, fog: 0x2a4a1a, ground: 0x2e3a22, sun: 0xc0ff80, sunI: 0.8, hemi: 0.60, fogNear: 20, fogFar: 85,  grid: 0x88ff22 },
  { name: 'BLOOD MOON', skyTop: 0x2a0510, skyBot: 0x6a1020, fog: 0x3a0a14, ground: 0x2a1a1a, sun: 0xff6040, sunI: 0.7, hemi: 0.50, fogNear: 22, fogFar: 95,  grid: 0xff3355 },
];

export interface ThemeRefs {
  skyMat: THREE.ShaderMaterial;
  fogRef: THREE.Fog;
  background: THREE.Color;
  floorMat: THREE.MeshStandardMaterial;
  sun: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  streetLights: THREE.PointLight[];
  stars: THREE.Points;
  sunSprite: THREE.Sprite;
  gridMat: THREE.ShaderMaterial;
}

export function applyTheme(idx: number, refs: ThemeRefs): void {
  const th = LEVEL_THEMES[idx % LEVEL_THEMES.length];
  (refs.skyMat.uniforms['top'].value as THREE.Color).setHex(th.skyTop);
  (refs.skyMat.uniforms['bottom'].value as THREE.Color).setHex(th.skyBot);
  refs.fogRef.color.setHex(th.fog);
  refs.fogRef.near = th.fogNear;
  refs.fogRef.far = th.fogFar;
  refs.background.setHex(th.fog);
  refs.floorMat.color.setHex(th.ground);
  refs.floorMat.needsUpdate = true;
  refs.sun.color.setHex(th.sun);
  refs.sun.intensity = th.sunI;
  refs.hemiLight.intensity = th.hemi;
  const nightish = th.sunI < 0.6;
  refs.streetLights.forEach(l => { l.intensity = nightish ? 2.2 : 0.0; });
  // Stars fade in for darker themes; sun tints + dims at night
  (refs.stars.material as THREE.PointsMaterial).opacity = nightish ? 0.9 : 0.0;
  (refs.sunSprite.material as THREE.SpriteMaterial).color.setHex(th.sun);
  (refs.sunSprite.material as THREE.SpriteMaterial).opacity = nightish ? 0.5 : 0.9;
  (refs.gridMat.uniforms['color'].value as THREE.Color).setHex(th.grid);
}
