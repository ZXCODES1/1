# VOID PROTOCOL

A browser-based 3D FPS built with Three.js and TypeScript — wave survival, weapon upgrades, an armory shop, procedural audio, and rotating level themes.

## Setup

```bash
npm install
npm run dev      # start dev server at http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build locally
```

## Controls

| Action | Keyboard / Mouse | Mobile |
|--------|-----------------|--------|
| Move | WASD / Arrow keys | Left joystick |
| Aim | Mouse (pointer lock) | Right drag zone |
| Shoot | F or Space | FIRE button |
| Reload | R | RELOAD button |
| Jump | Space | — |
| Pause | Escape or P | ❚❚ button |
| Nuke | N | ☢ button |

## Architecture

```
src/
├── main.ts           Entry point, fixed-timestep game loop (60 Hz)
├── types.ts          Shared interfaces and enums
├── GameState.ts      Central mutable state (singleton)
├── AudioEngine.ts    Procedural Web Audio (no external assets)
├── Input.ts          Keyboard, pointer-lock mouse, touch joystick
├── Renderer.ts       Three.js scene, arena, lighting, gun mesh
├── Player.ts         Movement, jump, health, damage
├── WeaponSystem.ts   Weapon chain, shoot, reload, upgrades
├── EnemyManager.ts   Archetypes, spawn, AI, walk animation
├── WaveManager.ts    Wave progression, boss waves, theme cycling
├── Shop.ts           Between-wave armory + perk system
├── ParticleSystem.ts Pooled blood/spark particles + floating numbers
├── LevelThemes.ts    5 visual themes applied every 5 waves
└── HUD.ts            All DOM HUD updates
```

## Features

- 5-wave boss cycle with escalating difficulty
- Weapon upgrade chain: Pistol → SMG → Shotgun → Assault → Railgun
- Kill-streak multiplier (Triple Kill → Godlike)
- Armory shop every 3 waves
- Powerup drops: shield, ammo, damage boost, tactical nuke
- 5 level themes: Downtown, Wüste, Nacht-Raid, Toxic Zone, Blood Moon
- Fully responsive — desktop pointer-lock and mobile touch controls
- Procedural audio (Web Audio API, zero asset files)
- Highscore persisted in localStorage
- Settings: volume, mouse sensitivity, graphics quality
