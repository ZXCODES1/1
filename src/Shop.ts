import type { GameState } from './GameState';
import { SFX } from './AudioEngine';
import { hudUpdateHealth, hudNukeBtn, hudUpdateCash } from './HUD';
import { WEAPONS } from './WeaponSystem';

interface ShopItem {
  id: string;
  name: string;
  desc: string;
  cost(state: GameState): number;
  canBuy(state: GameState): boolean;
  apply(state: GameState, weaponAmmo: number): void;
}

const ITEMS: ShopItem[] = [
  {
    id: 'heal',
    name: 'VOLLE REPARATUR',
    desc: 'Schild auf 100%',
    cost: () => 150,
    canBuy: (s) => s.player.health < s.player.maxHealth,
    apply: (s) => { s.player.health = s.player.maxHealth; },
  },
  {
    id: 'maxhp',
    name: 'PANZERUNG +25',
    desc: 'Max-Schild dauerhaft +25',
    cost: (s) => 400 + s.perks.maxHealthLvl * 200,
    canBuy: (s) => s.perks.maxHealthLvl < 5,
    apply: (s) => { s.perks.maxHealthLvl++; s.player.maxHealth += 25; s.player.health += 25; },
  },
  {
    id: 'armor',
    name: 'SCHADENS-ABWEHR',
    desc: '-12% erlittener Schaden',
    cost: (s) => 500 + s.perks.dmgReductLvl * 250,
    canBuy: (s) => s.perks.dmgReductLvl < 4,
    apply: (s) => { s.perks.dmgReductLvl++; },
  },
  {
    id: 'firerate',
    name: 'SCHNELLFEUER',
    desc: '+15% Feuerrate',
    cost: (s) => 450 + s.perks.fireRateLvl * 250,
    canBuy: (s) => s.perks.fireRateLvl < 4,
    apply: (s) => { s.perks.fireRateLvl++; },
  },
  {
    id: 'mag',
    name: 'GROSSES MAGAZIN',
    desc: '+40% Munition',
    cost: (s) => 400 + s.perks.magLvl * 200,
    canBuy: (s) => s.perks.magLvl < 4,
    apply: (s) => { s.perks.magLvl++; },
  },
  {
    id: 'nuke',
    name: 'TAKTISCHE NUKE',
    desc: 'Sofort kaufbar, 1x Vorrat',
    cost: () => 800,
    canBuy: () => true,
    apply: (s) => { s.nukeStock++; hudNukeBtn(s.nukeStock); },
  },
];

/** Stateless shop — opens the panel and wires up button handlers. Calls onClose when player continues. */
export function openShop(
  state: GameState,
  currentWeaponAmmo: number,
  onClose: () => void,
): void {
  state.phase = 'shop';
  const panel = document.getElementById('shopPanel')!;
  panel.style.display = 'flex';
  (document.getElementById('shopCash') as HTMLElement).textContent = '$' + state.player.cash;
  renderGrid(state, currentWeaponAmmo);

  const cont = document.getElementById('shopContinue')!;
  cont.onclick = () => {
    panel.style.display = 'none';
    onClose();
  };
  cont.ontouchstart = (e) => { e.preventDefault(); panel.style.display = 'none'; onClose(); };
  SFX.wave();
}

function renderGrid(state: GameState, weaponAmmo: number): void {
  const grid = document.getElementById('shopGrid')!;
  grid.innerHTML = '';
  for (const item of ITEMS) {
    const cost = item.cost(state);
    const affordable = state.player.cash >= cost && item.canBuy(state);
    const card = document.createElement('div');
    card.className = 'shop-card' + (affordable ? '' : ' disabled');
    card.innerHTML =
      `<div class="sc-name">${item.name}</div>` +
      `<div class="sc-desc">${item.desc}</div>` +
      `<div class="sc-cost">$${cost}</div>`;
    if (affordable) {
      const buy = () => {
        if (state.player.cash < item.cost(state) || !item.canBuy(state)) return;
        state.player.cash -= item.cost(state);
        SFX.buy();
        item.apply(state, weaponAmmo);
        hudUpdateHealth(state);
        hudUpdateCash(state);
        (document.getElementById('shopCash') as HTMLElement).textContent = '$' + state.player.cash;
        renderGrid(state, weaponAmmo);
      };
      card.onclick = buy;
      card.addEventListener('touchstart', (e) => { e.preventDefault(); buy(); }, { passive: false });
    }
    grid.appendChild(card);
  }
}

/** Calculates how much ammo the current weapon has with mag perk applied */
export function calcMagAmmo(weaponLevel: number, magLvl: number): number {
  return Math.round(WEAPONS[weaponLevel].ammo * (1 + magLvl * 0.4));
}
