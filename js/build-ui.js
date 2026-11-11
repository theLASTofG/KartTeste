// Interface da fase de montagem (cartas, posicionamento) e telas de resultado.
import * as THREE from 'three';
import { G, hooks } from './state.js';
import { $, clamp, esc, lerp, rnd } from './utils.js';
import { ITEMS, PALETTE } from './config.js';
import { SFX } from './audio.js';
import { camera, H, W } from './scene.js';
import { canPlace, freeExits, megaIndex, obstacles, slotGroup, track } from './track.js';
import { freeSlots } from './obstacles.js';
import { isHost, NET, playerById } from './cars.js';
import { showScreen, toast } from './hud.js';
import { toHost } from './net.js';
import { setSlotMode } from './camera.js';
// carta utilizável agora? (peça cabe no fim da pista / ainda há espaço livre para obstáculo)
export function itemEnabled(type) { return ITEMS[type].kind === 'piece' ? canPlace(type) : freeSlots().length > 0; }

// ------------------------------------------------------ UI de montagem
export function applyTray(t) {
  G.tray = t; G.holds = {};
  for (const i of G.tray) if (i.by >= 0) G.holds[i.by] = i.id;
  renderBuild();
}
function myItem() { return G.tray.find(i => i.id === G.holds[G.myId]); }
// modo da minha tela na montagem: cartas | encaixar peça | posicionar obstáculo | pronto
export function buildMode() {
  const it = myItem();
  return G.placed[G.myId] ? 'done' : !it ? 'cards' : ITEMS[it.type].kind === 'obs' ? 'obs' : 'piece';
}
const KEY_LABEL = i => i === 9 ? '0' : String(i + 1);
function renderTray() {
  const el = $('tray');
  const gen = G.tray.map(i => i.id + i.type).join();
  if (el.dataset.gen !== gen) {
    el.dataset.gen = gen;
    el.innerHTML = G.tray.map((it, k) => {
      const d = ITEMS[it.type];
      return `<button class="item" data-id="${it.id}" style="--r:${it.rot}deg;--dl:${-k * 0.27}s">
        <span class="key">${KEY_LABEL(k)}</span><div class="who"></div><div class="in"><svg viewBox="0 0 64 64">${d.svg}</svg><div class="nm">${d.name}</div>
        <div class="tg ${d.kind === 'piece' ? 'p' : 'o'}">${d.kind === 'piece' ? 'PISTA' : 'OBSTÁCULO'}</div></div></button>`;
    }).join('');
    el.querySelectorAll('.item').forEach(b => b.addEventListener('click', () => pickCard(G.tray.findIndex(i => i.id === +b.dataset.id))));
  }
  for (const it of G.tray) {
    const b = el.querySelector(`[data-id="${it.id}"]`); if (!b) continue;
    const p = playerById(it.by);
    b.classList.toggle('taken', it.by >= 0 && it.by !== G.myId);
    b.classList.toggle('mine', it.by === G.myId);
    b.classList.toggle('off', it.by < 0 && !itemEnabled(it.type));       // "SEM ESPAÇO"
    b.style.setProperty('--tc', p ? p.color : '#fff');
    b.querySelector('.who').textContent = p ? p.name : '';
  }
}
// clique ou atalho (1–9, 0): valida de novo antes de pedir ao host
export function pickCard(idx) {
  const it = G.tray[idx];
  if (G.state !== 'pick' || buildMode() !== 'cards' || !it || it.by >= 0) return;
  if (!itemEnabled(it.type)) { SFX.deny(); toast('SEM ESPAÇO!', '#ff2e55', 0.9); return; }
  SFX.grab();
  toHost({ t: 'pick', id: it.id });
}
export function renderBuild() {
  if (G.state !== 'pick') return;
  const mode = buildMode(), it = myItem(), d = it && ITEMS[it.type];
  $('tray').classList.toggle('show', mode === 'cards');
  if (mode === 'cards') renderTray();
  $('phaseTxt').textContent = { cards: 'RÁPIDO! ESCOLHA UMA CARTA (1–0)', piece: 'ENCAIXE SUA PEÇA!', obs: 'POSICIONE O OBSTÁCULO!', done: 'PRONTO! ESPERANDO OS OUTROS...' }[mode];
  const bar = $('placebar');
  bar.classList.toggle('show', mode !== 'cards');
  bar.dataset.mode = mode;
  $('placeChips').innerHTML = G.players.map(p => `<span class="chip ${G.placed[p.id] === 'ok' ? 'ok' : G.placed[p.id] === 'no' ? 'no' : ''}" style="${G.placed[p.id] ? '' : 'border:1px solid ' + p.color}">${esc(p.name)}${G.placed[p.id] === 'ok' ? ' ✓' : G.placed[p.id] === 'no' ? ' ✗' : ''}</span>`).join('');
  $('placeIcon').innerHTML = d ? d.svg : '';
  const exitMode = mode === 'piece' && megaIndex() >= 0 && freeExits().some(k => canPlace(it.type, k));
  if (mode === 'piece') $('placeTxt').innerHTML = `<b>${d.name}</b><br>${!canPlace(it.type) ? '⚠ Não cabe agora — volte às cartas e escolha outra.' : exitMode ? 'Toque numa <span style="color:#ffd23f">saída colorida</span> da Mega Pista (ou ENCAIXAR = primeira livre)' : 'Encaixe no fim da pista antes dos outros!'}`;
  else if (mode === 'obs') $('placeTxt').innerHTML = `<b>${d.name}</b><br>Toque num <span style="color:#00e5ff">espaço brilhante</span>`;
  else if (mode === 'done') $('placeTxt').innerHTML = G.placed[G.myId] === 'ok' ? `<b>${d ? d.name : 'Peça'}</b> colocada! ✓` : '<b>Sem carta nesta rodada</b>';
  setSlotMode(mode === 'obs' || exitMode, exitMode ? 'exit' : 'slot');
  if (exitMode) for (const g of slotGroup.children) if (g.userData.kind === 'exit') g.visible = canPlace(it.type, +g.children[0].userData.key[1]);
}
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
export function tryPlaceAt(x, y) {
  const bm = buildMode();
  if ((bm !== 'obs' && bm !== 'piece') || !slotGroup.visible) return;
  ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1);
  camera.updateMatrixWorld(); slotGroup.updateMatrixWorld(true);   // marcadores recém-criados ainda sem matriz de mundo
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(slotGroup.children, true).filter(h => h.object.userData.key && h.object.parent.visible);
  const hit = hits.find(h => h.object.userData.plate) || hits[0];        // placa tem prioridade sobre o feixe de outra zona
  if (hit) { SFX.grab(); toHost({ t: 'place', key: hit.object.userData.key }); }
}
export function showResults(d) {
  $('center').textContent = '';
  hooks.tmap.clear(); hooks.syncTouch(); SFX.update(0, 0, false, 0, false, 0);
  $('resTitle').textContent = 'RODADA ' + d.round;
  $('resBody').innerHTML = d.res.map((r, k) => {
    const p = playerById(r.pid) || { name: '?', color: '#fff' };
    return `<div class="rr ${r.pid === G.myId ? 'me' : ''}"><span class="p">${k + 1}º</span>
    <span><span class="sw" style="background:${p.color}"></span>${esc(p.name)}<br><span class="lb">${r.lb}</span></span>
    <span class="g">+${r.pts}</span><div class="bar"><i id="rb${r.pid}" style="background:${p.color};width:${r.before / G.TARGET * 100}%"></i></div>
    <span class="tot" id="rt${r.pid}">${r.before}</span></div>`;
  }).join('');
  $('resBtn').style.display = isHost() ? '' : 'none';
  $('resBtn').textContent = d.champ !== null && d.champ !== undefined ? 'VER CAMPEÃO 🏆' : 'MONTAR PISTA ➜';
  $('resNote').textContent = isHost() ? '' : 'Próxima fase em instantes...';
  showScreen('results');
  requestAnimationFrame(() => requestAnimationFrame(() => { for (const r of d.res) { const e = $('rb' + r.pid); if (e) e.style.width = clamp(r.after / G.TARGET * 100, 0, 100) + '%'; } }));
  const t0 = performance.now(); let ticks = 0;
  const count = () => {
    const k = clamp((performance.now() - t0) / 1200, 0, 1);
    for (const r of d.res) { const e = $('rt' + r.pid); if (e) e.textContent = Math.round(lerp(r.before, r.after, 1 - Math.pow(1 - k, 3))); }
    if (k < 1) { if (++ticks % 4 === 0) SFX.tick(ticks % 8); requestAnimationFrame(count); }
  };
  requestAnimationFrame(count);
}
export function showChampion(d) {
  SFX.champ();
  const c = playerById(d.champ) || G.players[0];
  $('champTitle').textContent = c.id === G.myId ? 'VOCÊ É O CAMPEÃO!' : c.name.toUpperCase() + ' É O CAMPEÃO!';
  const list = G.players.slice().sort((a, b) => b.score - a.score);
  $('champBody').innerHTML = list.map((o, k) => `<div class="rr ${o.id === G.myId ? 'me' : ''}" style="grid-template-columns:44px 1fr 80px"><span class="p">${k + 1}º</span>
    <span><span class="sw" style="background:${o.color}"></span>${esc(o.name)}</span><span class="tot">${o.score} pts</span></div>`).join('') +
    `<p style="font-weight:700;opacity:.8">Pista final: ${track.length} peças · ${obstacles.length} obstáculos · ${d.round} rodadas</p>`;
  $('againBtn').style.display = isHost() ? '' : 'none';
  $('againBtn').textContent = NET.role === 'solo' ? 'JOGAR DE NOVO' : 'VOLTAR AO LOBBY';
  $('champNote').textContent = isHost() ? '' : 'Aguardando o host...';
  const cf = $('confetti'); cf.innerHTML = '';
  for (let i = 0; i < 70; i++) {
    const e = document.createElement('i');
    e.style.left = rnd(0, 100) + 'vw'; e.style.background = PALETTE[i % PALETTE.length];
    e.style.animationDuration = rnd(2.2, 4.5) + 's'; e.style.animationDelay = rnd(-4, 0) + 's';
    cf.appendChild(e);
  }
  cf.style.display = 'block';
  showScreen('champ');
}
