// Gece İstilası: 19:00 uyarı bandı + gece HUD'u (PLAN §16). state'i yalnızca OKUR; DOM yazımı rAF'ta.
// Mod kapalıyken hiçbir şey görünmez. Eylemler: build.openCategory('defense') / panels.open('soldier').
import { WAVES, RAID_SCHEDULE } from '../data/defense.js';
import { STR } from './strings.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';
import { formatMoney } from './hud.js';

const R = STR.raid;

export function createRaidHud(root, leftCol, ctx, { openPanel, openDefense }) {
  const { state } = ctx;
  const on = () => !!(state.settings && state.settings.raids);
  const def = () => state.defense || {};

  // ---- Uyarı bandı ----
  const band = h('div', 'raid-band glass');
  band.hidden = true;
  band.setAttribute('role', 'alert');
  band.innerHTML = `<span class="rb-moon" aria-hidden="true"></span><span class="rb-tx"></span>
    <span class="rb-acts"><button type="button" class="ghost rb-def"></button><button type="button" class="ghost rb-sol"></button></span>`;
  shield(band);
  root.appendChild(band);
  const bTx = band.querySelector('.rb-tx');
  band.querySelector('.rb-def').textContent = R.warnDefense;
  band.querySelector('.rb-sol').textContent = R.warnSoldiers;
  tap(band.querySelector('.rb-def'), () => openDefense());
  tap(band.querySelector('.rb-sol'), () => openPanel('soldier'));
  let bandOn = false, bandBlood = false, bandDirty = false;

  // ---- Gece HUD ----
  const hud = h('div', 'raid-hud glass');
  hud.hidden = true;
  hud.innerHTML = `<div class="rh-top"><b class="rh-wave"></b><span class="rh-tag"></span></div>
    <div class="rh-row"><span class="rh-left"></span><span class="rh-kills"></span></div>
    <div class="rh-house"><span class="rh-hl">${R.hudHouse}</span><span class="bar rh-bar"><i></i></span><span class="num rh-hn"></span></div>
    <div class="rh-loot" hidden></div>`;
  leftCol.appendChild(hud);
  const q = (s) => hud.querySelector(s);
  const eWave = q('.rh-wave'), eTag = q('.rh-tag'), eLeft = q('.rh-left'), eKills = q('.rh-kills');
  const eFill = q('.rh-bar i'), eBar = q('.rh-bar'), eHn = q('.rh-hn'), eLoot = q('.rh-loot');
  let active = false, kills = 0, loot = 0, lootPulse = false, lootAt = 0;

  const onWarn = (p) => { bandOn = true; bandBlood = !!(p && p.bloodMoon); bandDirty = true; };
  const onStart = () => { active = true; kills = 0; loot = 0; bandOn = false; bandDirty = true; eLoot.hidden = true; };
  const onEnd = () => { active = false; };
  const onKilled = (p) => { kills++; loot += Number(p && p.reward) || 0; lootPulse = true; lootAt = performance.now(); };

  let shownBand = null, shownHud = null, shownBlood = null;
  function render() {
    const raids = on();
    const d = def();
    let hr = 0;
    try { hr = ctx.now().hour; } catch (e) { hr = 0; }
    if (bandOn && (hr >= RAID_SCHEDULE.startHour || hr < 6)) { bandOn = false; bandDirty = true; }
    const showBand = raids && bandOn;
    if (showBand !== shownBand) { shownBand = showBand; band.classList.toggle('show', showBand); if (showBand) band.hidden = false; else setTimeout(() => { if (!shownBand) band.hidden = true; }, 300); }
    if (showBand && (bandDirty || bandBlood !== shownBlood)) {
      bandDirty = false; shownBlood = bandBlood;
      band.classList.toggle('blood', bandBlood);
      setText(bTx, bandBlood ? R.warnBlood : R.warn);
    }
    const mons = (d.monsters && d.monsters.length) || 0;
    const showHud = raids && (active || mons > 0 || (d.wavesLeft || 0) > 0);
    if (showHud !== shownHud) { shownHud = showHud; hud.hidden = !showHud; hud.classList.toggle('show', showHud); }
    if (!showHud) return;
    hud.classList.toggle('blood', !!d.bloodMoon);
    setText(eWave, R.hudWave(Math.max(1, Math.min(WAVES.perNight, d.wave || 1)), WAVES.perNight));
    setText(eTag, d.bloodMoon ? R.hudBlood : '');
    setText(eLeft, R.hudLeft(mons));
    setText(eKills, R.hudKills(kills));
    const mx = d.houseMax || 1, hp = Math.max(0, Math.min(mx, d.houseHp == null ? mx : d.houseHp));
    const pct = Math.round((hp / mx) * 100), w = `${pct}%`;
    if (eFill.__w !== w) { eFill.__w = w; eFill.style.width = w; eFill.style.background = pct < 30 ? 'var(--bad)' : pct < 60 ? 'var(--accent)' : 'var(--good)'; }
    setText(eHn, `${Math.round(hp)}/${mx}`);
    if (loot > 0) {
      eLoot.hidden = false;
      setText(eLoot, R.loot(formatMoney(loot).replace(/\s*₺$/, '').trim()));
    }
    if (lootPulse) { lootPulse = false; eLoot.classList.remove('pulse'); void eLoot.offsetWidth; eLoot.classList.add('pulse'); }
  }
  void eBar; void lootAt;
  return { onWarn, onStart, onEnd, onKilled, render, destroy() { band.remove(); hud.remove(); } };
}
export default createRaidHud;
