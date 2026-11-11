// HUD: toasts, placar, velocímetro e indicador de rede.
import { G } from './state.js';
import { $, clamp, esc } from './utils.js';
import { DRIFT, fmtPts, POWER, PTS } from './config.js';
import { cars, myCar, NET } from './cars.js';

// ---------------------------------------------------------------- HUD
const toastsEl = $('toasts');
export function toast(text, color = '#fff', dur = 1.3) {
  for (const el of [...toastsEl.children]) if (el.textContent === text) el.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
  el.style.color = color; el.style.setProperty('--d', dur + 's');
  toastsEl.appendChild(el);
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  setTimeout(() => el.remove(), dur * 1000);
}
export function centerText(t, color) {
  const c = $('center'); c.textContent = t; c.style.color = color || '#fff';
  c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
}
export function updateBoard() {
  const b = $('board');
  const list = G.players.slice().sort((a, c) => c.score - a.score);
  b.innerHTML = `<div class="hd"><span>PLACAR</span><span>META ${fmtPts(G.TARGET)} PTS</span></div>` + list.map(p =>
    `<div class="sb ${p.id === G.myId ? 'me' : ''}"><span class="nm">${esc(p.name)}</span><div class="bar"><i style="background:${p.color};width:${clamp(p.score / G.TARGET * 100, 0, 100)}%"></i></div><span class="pt">${p.score}</span></div>`).join('');
}
G.lastHud = {};
// slot de item: vazio / sorteando (roleta curta) / pronto
let lastItemHud = '';
function updateItemHud(p) {
  const el = $('itemHud'); if (!el) return;
  const now = performance.now();
  let st = 'empty', icon = '', name = 'SEM ITEM';
  if (p.item && POWER.types[p.item]) {
    if (now < p.itemRollEnd) { st = 'rolling'; const ks = Object.keys(POWER.types); icon = POWER.types[ks[Math.floor(now / 90) % ks.length]].svg; name = 'SORTEANDO...'; }
    else { st = 'ready'; icon = POWER.types[p.item].svg; name = POWER.types[p.item].name; }
  }
  const sig = st + icon + name;
  if (sig === lastItemHud) return;
  lastItemHud = sig;
  for (const e of [el, $('tItem')]) if (e) { e.dataset.state = st; const s = e.querySelector('svg'); if (s) s.innerHTML = icon; }
  el.querySelector('.ih-nm').textContent = name;
}
export function updateHud() {
  const p = myCar(); if (!p) return;
  updateItemHud(p);
  const rank = rankOf(p);
  if (G.lastHud.rank !== rank || G.lastHud.n !== cars.length) { $('pos').innerHTML = `${rank}<small>º/${cars.length}</small>`; $('pos').style.color = rank === 1 ? '#ffd23f' : '#fff'; G.lastHud.rank = rank; G.lastHud.n = cars.length; }
  const kmh = Math.round(Math.hypot(p.vx, p.vz) * 3.6 * 1.4);
  if (G.lastHud.kmh !== kmh) { $('kmh').textContent = kmh; G.lastHud.kmh = kmh; }
  let fill, col, lbl;
  if (p.boostT > 0) { fill = p.boostT / p.boostMax; col = '#4df3ff'; lbl = 'TURBO!'; }
  else if (p.drifting) { fill = clamp(p.driftT / DRIFT.T[2], 0, 1); col = p.driftLevel ? DRIFT.css[p.driftLevel - 1] : '#c8d0e0'; lbl = p.driftLevel ? ['AZUL', 'LARANJA', 'ROXO'][p.driftLevel - 1] : 'DRIFT'; }
  else { fill = 0; col = '#c8d0e0'; lbl = 'DRIFT'; }
  const fk = Math.round(fill * 200);
  if (G.lastHud.fk !== fk || G.lastHud.col !== col) { const i = $('dbar').firstElementChild; i.style.width = (fill * 100) + '%'; i.style.background = col; G.lastHud.fk = fk; G.lastHud.col = col; }
  if (G.lastHud.lbl !== lbl) { $('dlbl').textContent = lbl; $('dlbl').style.color = col; G.lastHud.lbl = lbl; }
}
// indicador de conexão (ping até o host)
export function updateNetHud() {
  const el = $('net'); if (!el) return;
  if (NET.role === 'host') { el.textContent = '📶 HOST · ' + (NET.conns.size + 1) + ' online'; el.style.color = '#a6ff3b'; return; }
  if (NET.role === 'rejoining') { el.textContent = '📶 RECONECTANDO...'; el.style.color = '#ff9a1f'; return; }
  if (NET.role !== 'client') { el.textContent = ''; return; }
  if (!NET.pongAt || performance.now() - NET.pongAt > 6000) { el.textContent = '📶 SEM SINAL'; el.style.color = '#ff2e55'; return; }
  const r = NET.rtt;
  el.textContent = '📶 ' + r + ' ms'; el.style.color = r < 90 ? '#a6ff3b' : r < 180 ? '#ffd23f' : '#ff2e55';
}
export function placeToast(c) {
  const o = c.finishOrder;
  toast(o + 'º LUGAR! +' + (PTS[o - 1] || 0), o === 1 ? '#ffd23f' : '#fff', 2.2);
}
export function showScreen(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id); }
function rankOf(c) { let r = 1; for (const o of cars) if (o !== c && cmpRace(o, c) < 0) r++; return r; }
export function cmpRace(a, b) {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.finished) return (a.finishOrder || 99) - (b.finishOrder || 99);
  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  return b.prog - a.prog;
}
