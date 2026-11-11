// Entrada: teclado, toque, botões e gestos da câmera de montagem.
import { G } from './state.js';
import { $, store } from './utils.js';
import { SFX } from './audio.js';
import { onResize } from './scene.js';
import { isHost, myCar } from './cars.js';
import { toast } from './hud.js';
import { respawn } from './physics.js';
import { setStatus } from './net.js';
import { BC, panBy, pinchInfo, PTRS, zoomBy } from './camera.js';
import { pickCard, tryPlaceAt } from './build-ui.js';
import { act, pauseGame, resume } from './phases.js';

// --------------------------------------------------------------- entrada
export const keys = Object.create(null);
const TOUCH = { left: false, right: false, gas: false, brake: false, drift: false };
let autoGas = store.get('autogas', false);
G.menuOpen = false; let fsTouch = null;
export function applyDevice() {
  document.body.dataset.touch = G.myDevice === 'mobile' ? '1' : '0';
  for (const b of document.querySelectorAll('#devSeg button')) b.classList.toggle('on', b.dataset.dev === G.myDevice);
  $('optAuto').style.display = G.myDevice === 'mobile' ? '' : 'none';
}
document.querySelectorAll('#devSeg button').forEach(b => b.addEventListener('click', () => { G.myDevice = b.dataset.dev; store.set('device', G.myDevice); applyDevice(); SFX.init(); SFX.click(); }));
// ---- tela cheia
const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function toggleFS() {
  const d = document, el = d.documentElement;
  if (isFS()) { const ex = d.exitFullscreen || d.webkitExitFullscreen; if (ex) ex.call(d); return; }
  const rq = el.requestFullscreen || el.webkitRequestFullscreen;
  const fail = () => { setStatus('Tela cheia indisponível aqui. No iPhone: Compartilhar → Adicionar à Tela de Início.'); toast('TELA CHEIA INDISPONÍVEL', '#ff9a1f', 1.6); };
  if (!rq) { fail(); return; }
  const lock = () => { if (G.myDevice === 'mobile' && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => { }); };
  try { const p = rq.call(el, { navigationUI: 'hide' }); if (p && p.then) p.then(lock, fail); else lock(); } catch (e) { fail(); }
}
function refreshFs() { for (const b of document.querySelectorAll('[data-tap="fs"]')) b.classList.toggle('on', isFS()); }
document.addEventListener('fullscreenchange', () => { refreshFs(); onResize(); });
document.addEventListener('webkitfullscreenchange', () => { refreshFs(); onResize(); });

const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];
window.addEventListener('keydown', e => {
  SFX.init();
  if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Enter' && e.target.id === 'codeInp') act('join'); return; }
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (G.state === 'pick') {
    const dg = /^(Digit|Numpad)([0-9])$/.exec(e.code);
    if (dg) { const n = +dg[2]; pickCard(n === 0 ? 9 : n - 1); return; }
    if (e.code === 'Escape' || e.code === 'Backspace') { act('backcards'); return; }
  }
  if (e.code === 'KeyR') doTap('reset');
  else if (e.code === 'KeyP' || e.code === 'Escape') doTap('pause');
  else if (e.code === 'KeyM') doTap('mute');
  else if (e.code === 'KeyG') doTap('auto');
  else if (e.code === 'KeyF') doTap('fs');
  else if (e.code === 'Enter') {
    if (G.state === 'results' && isHost()) act('continue');
    else if (G.state === 'pick') act('placepiece');
  }
}, { passive: false });
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; tmap.clear(); syncTouch(); });

const holdBtns = [...document.querySelectorAll('[data-btn]')];
export const tmap = new Map();           // touch.identifier -> botão (multi-touch real)
export const uiActive = () => G.state === 'countdown' || G.state === 'race';
function hitBtn(x, y) {
  for (let pass = 0; pass < 2; pass++) {
    const m = pass ? 16 : 0;
    for (const b of holdBtns) {
      const r = b.getBoundingClientRect();
      if (r.width && x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m) return b.dataset.btn;
    }
  }
  return null;
}
export function syncTouch() {
  for (const k in TOUCH) TOUCH[k] = false;
  for (const v of tmap.values()) TOUCH[v] = true;
  for (const b of holdBtns) b.classList.toggle('on', TOUCH[b.dataset.btn]);
}
document.addEventListener('touchstart', e => {
  SFX.init();
  if (!uiActive() || G.myDevice !== 'mobile' || G.menuOpen) return;
  let used = false;
  for (const t of e.changedTouches) {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const tap = el && el.closest && el.closest('[data-tap]');
    if (tap) { if (tap.dataset.tap === 'fs') fsTouch = t.identifier; else doTap(tap.dataset.tap); continue; }
    const b = hitBtn(t.clientX, t.clientY);
    if (b) { tmap.set(t.identifier, b); used = true; }
  }
  if (used) syncTouch();
  e.preventDefault();
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (!uiActive() || G.myDevice !== 'mobile') return;
  let ch = false;
  for (const t of e.changedTouches) {
    if (!tmap.has(t.identifier)) continue;
    const b = hitBtn(t.clientX, t.clientY);
    if (b && b !== tmap.get(t.identifier)) { tmap.set(t.identifier, b); ch = true; }
  }
  if (ch) syncTouch();
  e.preventDefault();
}, { passive: false });
function touchEnd(e) {
  let ch = false;
  for (const t of e.changedTouches) {
    if (tmap.delete(t.identifier)) ch = true;
    if (t.identifier === fsTouch) { fsTouch = null; toggleFS(); }   // tela cheia precisa ser no touchend (gesto do usuário)
  }
  if (ch) syncTouch();
  if (uiActive() && G.myDevice === 'mobile') e.preventDefault();
}
document.addEventListener('touchend', touchEnd, { passive: false });
document.addEventListener('touchcancel', touchEnd, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerdown', e => {
  SFX.init();
  if (e.pointerType !== 'mouse' || !uiActive()) return;
  const b = e.target.closest && e.target.closest('[data-btn]');
  if (b) { tmap.set('mouse', b.dataset.btn); syncTouch(); }
});
window.addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && tmap.delete('mouse')) syncTouch(); });
document.querySelectorAll('[data-tap]').forEach(b => b.addEventListener('click', () => doTap(b.dataset.tap)));
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
$('optAuto').addEventListener('click', () => doTap('auto'));

function doTap(what) {
  SFX.init();
  if (what === 'pause') { if (G.state === 'paused' || G.menuOpen) resume(); else if (uiActive()) pauseGame(); }
  else if (what === 'reset') { const p = myCar(); if (p && G.state === 'race' && p.alive && p.grounded && !p.finished) respawn(p); }
  else if (what === 'mute') { SFX.setMute(!SFX.muted); refreshButtons(); }
  else if (what === 'auto') { autoGas = !autoGas; store.set('autogas', autoGas); refreshButtons(); if (uiActive()) toast(autoGas ? 'AUTO-GAS ON' : 'AUTO-GAS OFF', '#a6ff3b', 1); }
  else if (what === 'fs') toggleFS();
}
export function refreshButtons() {
  $('bMute').textContent = SFX.muted ? '✕' : '♪';
  $('tAuto').classList.toggle('on', autoGas); $('tAuto').textContent = autoGas ? 'AUTO-GAS: ON' : 'AUTO-GAS: OFF';
  $('tGas').classList.toggle('auto', autoGas);
  $('optAuto').classList.toggle('on', autoGas); $('optAuto').querySelector('span').textContent = autoGas ? 'ON' : 'OFF';
  refreshFs();
}
export function readPlayerInput(inp) {
  if (G.menuOpen) { inp.steer = 0; inp.throttle = 0; inp.brake = 0; inp.drift = false; inp.gasRaw = false; return; }
  const k = keys, mob = G.myDevice === 'mobile';
  const left = k.ArrowLeft || k.KeyA || TOUCH.left, right = k.ArrowRight || k.KeyD || TOUCH.right;
  const brake = !!(k.ArrowDown || k.KeyS || TOUCH.brake), gas = !!(k.ArrowUp || k.KeyW || TOUCH.gas);
  inp.steer = (right ? 1 : 0) - (left ? 1 : 0);
  inp.throttle = (gas || (mob && autoGas && !brake)) ? 1 : 0;
  inp.brake = brake ? 1 : 0;
  inp.drift = !!(k.Space || k.ShiftLeft || k.ShiftRight || TOUCH.drift);
  inp.gasRaw = gas;
}
{
  const gl = $('gl');
  gl.addEventListener('pointerdown', e => {
    if (!BC.active) return;
    try { gl.setPointerCapture(e.pointerId); } catch (x) { }
    PTRS.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, pinch: false });
    if (PTRS.size >= 2) { for (const q of PTRS.values()) q.pinch = true; G.pinch = pinchInfo(); }
  });
  gl.addEventListener('pointermove', e => {
    const q = PTRS.get(e.pointerId); if (!q || !BC.active) return;
    const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY;
    if (!q.moved && Math.hypot(q.x - q.sx, q.y - q.sy) > 8) q.moved = true;
    if (PTRS.size === 1) { if (q.moved) panBy(dx, dy); }
    else if (G.pinch) { const n = pinchInfo(); zoomBy(G.pinch.d / Math.max(20, n.d)); panBy(n.x - G.pinch.x, n.y - G.pinch.y); G.pinch = n; }
  });
  const end = e => {
    const q = PTRS.get(e.pointerId); if (!q) return;
    PTRS.delete(e.pointerId); if (PTRS.size < 2) G.pinch = null;
    if (e.type === 'pointerup' && !q.moved && !q.pinch) tryPlaceAt(e.clientX, e.clientY);   // tap curto = escolher zona
  };
  gl.addEventListener('pointerup', end); gl.addEventListener('pointercancel', end);
  gl.addEventListener('wheel', e => { if (!BC.active) return; e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
    SFX.click();
    const c = b.dataset.cam;
    if (c === 'in') zoomBy(0.75); else if (c === 'out') zoomBy(1.33); else if (c === 'all') BC.manual = false;
  }));
}
