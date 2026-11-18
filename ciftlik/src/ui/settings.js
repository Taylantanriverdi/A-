// Ayarlar düğmesi + ortada cam panel (kalite, ses, müzik, yeni oyun).
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { h } from './frame.js';
import { shield, tap } from './touch.js';

const QUALITIES = ['auto', 'high', 'medium', 'low'];
const CONFIRM_MS = 6000;

export function createSettings(root, ctx, moneyWrap) {
  const { state, bus } = ctx;

  const gear = h('button', 'icon-btn glass interactive', `<span class="ic">${ICON.gear}</span>`);
  gear.type = 'button';
  gear.title = STR.settings;
  gear.setAttribute('aria-label', STR.settings);
  gear.setAttribute('aria-haspopup', 'dialog');
  shield(gear);
  moneyWrap.appendChild(gear);

  const backdrop = h('div', 'backdrop');
  const panel = h('div', 'panel glass scrollable');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', STR.settings);
  panel.innerHTML = `
    <header><h2>${STR.settings}</h2><button type="button" class="close" aria-label="${STR.close}"><span class="ic">${ICON.close}</span></button></header>
    <section class="s-quality">
      <div class="label"><b>${STR.quality}</b><span class="sub q-now"></span></div>
      <div class="seg" role="radiogroup" aria-label="${STR.quality}">
        ${QUALITIES.map((q) => `<button type="button" role="radio" data-q="${q}">${STR.qualityOpts[q]}</button>`).join('')}
      </div>
    </section>
    <section class="s-audio">
      <div class="label"><b>${STR.sound}</b><span class="num v-sound"></span></div>
      <div class="slider"><input type="range" min="0" max="100" step="1" data-k="sound" aria-label="${STR.sound}"></div>
      <div class="label l2"><b>${STR.music}</b><span class="num v-music"></span></div>
      <div class="slider"><input type="range" min="0" max="100" step="1" data-k="music" aria-label="${STR.music}"></div>
    </section>
    <section class="newgame">
      <button type="button" class="danger first">${STR.newGame}</button>
      <div class="confirm">
        <p>${STR.newGameAsk}</p>
        <div class="row"><button type="button" class="ghost cancel">${STR.newGameCancel}</button><button type="button" class="danger solid yes">${STR.newGameConfirm}</button></div>
      </div>
      <p class="hint">${STR.newGameHint}</p>
    </section>
    <p class="shortcuts">${STR.shortcuts}</p>`;
  backdrop.appendChild(panel);
  shield(backdrop);
  root.appendChild(backdrop);

  const qBtns = [...panel.querySelectorAll('.seg button')];
  const qNow = panel.querySelector('.q-now');
  const ranges = [...panel.querySelectorAll('input[type=range]')];
  const vLabels = { sound: panel.querySelector('.v-sound'), music: panel.querySelector('.v-music') };
  const ng = panel.querySelector('.newgame');
  let resolvedLevel = null; // settings:quality ile gelen gerçek seviye
  let localQuality = null;  // optimistik seçim (state güncellenene kadar)
  let open = false;
  let confirmTimer = 0;
  let lastFocus = null;

  const val01 = (k) => {
    const v = state.settings && typeof state.settings[k] === 'number' ? state.settings[k] : 0.5;
    return Math.max(0, Math.min(1, v));
  };

  function paintRange(r) {
    const pct = r.value + '%';
    r.style.setProperty('--p', pct);
    vLabels[r.dataset.k].textContent = `%${r.value}`;
  }

  function syncFromState() {
    const q = localQuality || (state.settings && state.settings.quality) || 'auto';
    for (const b of qBtns) {
      const on = b.dataset.q === q;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    qNow.textContent = q === 'auto' && resolvedLevel ? STR.qualityAutoNow(STR.qualityOpts[resolvedLevel] || resolvedLevel) : '';
    for (const r of ranges) {
      r.value = String(Math.round(val01(r.dataset.k) * 100));
      paintRange(r);
    }
  }

  for (const b of qBtns) {
    tap(b, () => {
      const q = b.dataset.q;
      localQuality = q;
      bus.emit('settings:set', { key: 'quality', value: q });
      syncFromState();
    });
  }
  for (const r of ranges) {
    r.addEventListener('input', () => paintRange(r));
    // Kaydetme isteği spam olmasın: değer bırakınca gönderilir
    r.addEventListener('change', () => bus.emit('settings:set', { key: r.dataset.k, value: Number(r.value) / 100 }));
    r.addEventListener('keydown', (e) => e.stopPropagation());
  }

  function resetConfirm() { clearTimeout(confirmTimer); ng.classList.remove('asking'); }
  tap(panel.querySelector('.danger.first'), () => {
    ng.classList.add('asking');
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(resetConfirm, CONFIRM_MS);
    panel.querySelector('.cancel').focus({ preventScroll: true });
  });
  tap(panel.querySelector('.cancel'), resetConfirm);
  tap(panel.querySelector('.yes'), () => {
    if (!ng.classList.contains('asking')) return;
    resetConfirm();
    bus.emit('save:reset', {});
  });
  tap(panel.querySelector('.close'), () => api.close());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });
  tap(gear, () => (open ? api.close() : api.open()));

  const api = {
    get isOpen() { return open; },
    open() {
      if (open) return;
      open = true;
      localQuality = null;
      syncFromState();
      lastFocus = document.activeElement && document.activeElement.matches && document.activeElement.matches(':focus-visible') ? document.activeElement : null;
      backdrop.classList.add('open');
      gear.setAttribute('aria-expanded', 'true');
    },
    close() {
      if (!open) return;
      open = false;
      resetConfirm();
      backdrop.classList.remove('open');
      gear.setAttribute('aria-expanded', 'false');
      if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
      if (lastFocus && lastFocus.focus && lastFocus !== document.body) { try { lastFocus.focus({ preventScroll: true }); } catch (_) {} }
      lastFocus = null;
    },
    onQuality(p) {
      if (p && p.level) resolvedLevel = p.level;
      if (open) syncFromState();
    },
    destroy() { clearTimeout(confirmTimer); },
  };
  return api;
}
