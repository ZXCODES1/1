import type { GameState } from './GameState';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function hudShow(show: boolean): void {
  el('hud').style.display = show ? 'block' : 'none';
  el('controls').style.display = show ? 'block' : 'none';
}

export function hudUpdateHealth(state: GameState): void {
  const pct = (state.player.health / state.player.maxHealth) * 100;
  el('hpFill').style.width = Math.max(0, pct) + '%';
  const low = el('lowHpPulse');
  if (pct <= 30 && state.player.alive) low.classList.add('active');
  else low.classList.remove('active');
}

export function hudUpdateAmmo(ammo: number): void {
  el('ammoNum').textContent = String(ammo);
}

export function hudUpdateScore(state: GameState): void {
  el('scoreNum').textContent = String(state.player.score);
}

export function hudUpdateWave(wave: number): void {
  el('waveLabel').textContent = 'WAVE ' + wave;
}

export function hudUpdateCash(state: GameState): void {
  const cashEl = el('cashNum');
  if (cashEl) cashEl.textContent = '$' + state.player.cash;
  const multEl = el('multNum');
  if (multEl) {
    multEl.textContent = 'x' + state.scoreMultiplier;
    multEl.style.opacity = state.scoreMultiplier > 1 ? '1' : '0.3';
  }
}

export function hudDamageFlash(): void {
  const dv = el('dmgVignette');
  dv.style.opacity = '1';
  setTimeout(() => { dv.style.opacity = '0'; }, 180);
}

export function hudShowReloadBar(show: boolean, reloadMs?: number): void {
  const rb = el('reloadBar');
  const rf = el('reloadFill');
  if (show) {
    rb.style.display = 'flex';
    rf.style.width = '0%';
    setTimeout(() => { rf.style.width = '100%'; }, 30);
    if (reloadMs !== undefined) {
      rf.style.transition = `width ${reloadMs}ms linear`;
    }
  } else {
    rb.style.display = 'none';
    rf.style.width = '0%';
  }
}

export function hudAnnounceWave(text: string, subHtml = ''): void {
  const wa = el('waveAnnounce');
  wa.innerHTML = text + (subHtml ? `<br><span style="font-size:0.55em;color:#ffcc44">${subHtml}</span>` : '');
  wa.style.opacity = '1';
  setTimeout(() => { wa.style.opacity = '0'; }, subHtml ? 2200 : 1800);
}

export function hudKillFeed(html: string, isBoss: boolean): void {
  const kf = el('killFeed');
  const msg = document.createElement('div');
  msg.className = 'kmsg';
  msg.innerHTML = html;
  if (isBoss) { msg.style.color = '#ffaa00'; msg.style.borderColor = '#ffaa00'; }
  kf.appendChild(msg);
  setTimeout(() => msg.remove(), 2200);
}

export function hudStreakAnnounce(title: string, sub: string): void {
  const hud = el('hud');
  const ann = document.createElement('div');
  ann.className = 'streak-ann';
  ann.innerHTML = `<span class="st-t">${title}</span><span class="st-s">${sub}</span>`;
  hud.appendChild(ann);
  setTimeout(() => ann.remove(), 1800);
}

export function hudUpgradeAnnounce(weaponName: string): void {
  const uf = el('upgradeFlash');
  uf.style.opacity = '1';
  setTimeout(() => { uf.style.opacity = '0'; }, 300);
  const hud = el('hud');
  const ann = document.createElement('div');
  ann.className = 'upann';
  ann.innerHTML = `<span class="upt">WEAPON UPGRADED</span><span class="ups">${weaponName} UNLOCKED</span>`;
  hud.appendChild(ann);
  setTimeout(() => ann.remove(), 2300);
}

export function hudUpdateWeapon(
  name: string,
  pct: number,
  killsText: string,
  glow: string,
): void {
  el<HTMLElement>('weaponName').textContent = name;
  el<HTMLElement>('weaponName').style.textShadow = `0 0 14px ${glow}`;
  el<HTMLElement>('weaponFill').style.width = pct + '%';
  el<HTMLElement>('weaponFill').style.background = `linear-gradient(90deg,${glow},#fff)`;
  el<HTMLElement>('weaponFill').style.boxShadow = `0 0 8px ${glow}`;
  el<HTMLElement>('weaponKills').textContent = killsText;
}

export function hudCrosshairHit(): void {
  const ch = el('crosshair');
  ch.style.borderColor = '#ff4444';
  ch.style.color = '#ff4444';
  setTimeout(() => { ch.style.color = 'var(--green)'; }, 100);
}

export function hudHitmarker(kill = false): void {
  const hm = el('hitmarker');
  hm.classList.remove('show', 'kill');
  // force reflow so the animation restarts on rapid hits
  void hm.offsetWidth;
  hm.classList.add(kill ? 'kill' : 'show');
}

export function hudNukeBtn(stock: number): void {
  const btn = el('nukeBtn');
  btn.style.display = stock > 0 ? 'flex' : 'none';
  el('nukeCount').textContent = String(stock);
}

export function hudPowerupAnnounce(label: string): void {
  hudStreakAnnounce('POWERUP', label);
}

export function hudNukeFlash(): void {
  const uf = el('upgradeFlash');
  uf.style.background = 'rgba(255,240,200,0.6)';
  uf.style.opacity = '1';
  setTimeout(() => { uf.style.opacity = '0'; uf.style.background = ''; }, 350);
}

export function hudShowOverlay(
  title: string,
  sub: string,
  btnText: string,
  onBtn: () => void,
): void {
  const ov = el('overlay');
  ov.style.display = 'flex';
  (ov.querySelector('h1') as HTMLElement).textContent = title;
  (ov.querySelector('.sub') as HTMLElement).textContent = sub;
  const btn = el<HTMLButtonElement>('startBtn');
  btn.textContent = btnText;
  btn.onclick = onBtn;
  const hs = el('highScoreDisplay');
  if (hs) hs.textContent = 'HIGHSCORE: ' + (parseInt(localStorage.getItem('voidprotocol_highscore') ?? '0', 10) || 0);
}

export function hudHideOverlay(): void {
  el('overlay').style.display = 'none';
}

export function hudShowBossBar(show: boolean, name: string): void {
  const bar = el('bossBar');
  if (!bar) return;
  bar.style.display = show ? 'flex' : 'none';
  if (show) {
    const nameEl = el('bossName');
    if (nameEl) nameEl.textContent = name;
    hudBossBar(1);
  }
}

export function hudBossBar(pct: number): void {
  const fill = el('bossFill');
  if (fill) fill.style.width = Math.max(0, Math.min(1, pct)) * 100 + '%';
}
