// Lógica do host: partidas, rodadas, sorteio das cartas e posicionamento.
import { G, HST, hooks } from './state.js';
import { clamp, r2, rnd, TAU } from './utils.js';
import { ITEMS, PTS } from './config.js';
import { themeKey } from './scene.js';
import { applyTrack, canPlace, finishGlobal, freeExits, layoutSigs, megaIndex, pieceSigs, PRESETS, trackTypes } from './track.js';
import { freeSlots, obsData } from './obstacles.js';
import { cars, playerById, plist, syncCars } from './cars.js';
import { placeToast } from './hud.js';
import { broadcast, sendTo } from './net.js';
import { applyTray, itemEnabled, renderBuild } from './build-ui.js';

// ---------------------------------------------------- lógica do HOST
export function hostEnter(ph, d) {
  d = Object.assign({ target: G.TARGET, theme: themeKey, cross: G.allowCross }, d);
  HST.last = { ph, d };                       // guardado para quem reconectar no meio da partida
  hooks.enterPhase(ph, d); broadcast({ t: 'phase', ph, d });
}
export function hostStartMatch() {
  for (const p of G.players) p.score = 0;
  HST.round = 0;
  const P = PRESETS[G.presetKey] || PRESETS.curta;
  applyTrack(['start', 'finish'], [], false); applyTrack(P.types, P.obs, false);
  hostStartRound();
}
function hostStartRound() {
  HST.round++;
  // quem reconectou durante a corrida recebe o carro de volta do bot
  let back = false;
  for (const p of G.players) if (p.rejoin && p.connected) { p.bot = false; p.rejoin = false; back = true; }
  if (back) syncCars();
  const order = G.players.slice().sort((a, b) => (a.score - b.score) || (Math.random() - 0.5)); // líder larga atrás
  const grid = {}; order.forEach((p, k) => grid[p.id] = k);
  hostEnter('countdown', { round: HST.round, grid, types: trackTypes(), obs: obsData(), players: plist(), dur: 3.2 });
}
export function hostRegisterFinish(c) {
  if (c.finishOrder || !G.R) return;
  c.finishOrder = ++G.R.finishCount;
  if (G.R.firstFinishT < 0) G.R.firstFinishT = G.R.t;
  if (c.isLocal) placeToast(c);
}
export function hostEndRound() {
  const fin = cars.filter(c => c.finished && c.finishOrder).sort((a, b) => a.finishOrder - b.finishOrder);
  const rest = cars.filter(c => !(c.finished && c.finishOrder)).sort((a, b) => b.prog - a.prog);
  const res = [];
  fin.forEach((c, k) => res.push({ pid: c.pid, pts: PTS[k] || 20, lb: (k + 1) + 'º lugar' }));
  rest.forEach(c => {
    const f = clamp((c.alive ? c.prog : (c.fallProg || c.prog)) / finishGlobal, 0, 1);
    res.push({ pid: c.pid, pts: Math.round(f * 70 / 5) * 5, lb: (c.alive ? 'Tempo · ' : 'Caiu · ') + Math.round(f * 100) + '%' });
  });
  for (const r of res) { const p = playerById(r.pid); r.before = p.score; p.score += r.pts; r.after = p.score; }
  const top = G.players.slice().sort((a, b) => b.score - a.score)[0];
  HST.champ = top && top.score >= G.TARGET ? top.id : null;
  hostEnter('results', { res, players: plist(), champ: HST.champ, round: HST.round, dur: 6 });
}
export function hostAfterResults() {
  if (HST.champ !== null) hostEnter('champion', { players: plist(), champ: HST.champ, round: HST.round });
  else hostStartPick();
}
function pickWeighted(list) {
  let t = 0; for (const k of list) t += ITEMS[k].w;
  let r = Math.random() * t;
  for (const k of list) { r -= ITEMS[k].w; if (r <= 0) return k; }
  return list[list.length - 1];
}
// embaralhamento Fisher–Yates (sem viés) e sorteio ponderado sem repetição
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function drawDistinct(list, n) {
  const pool = list.slice(), out = [];
  while (out.length < n && pool.length) { const k = pickWeighted(pool); out.push(k); pool.splice(pool.indexOf(k), 1); }
  return out;
}
const DECK_PIECES = 6, DECK_OBS = 4;                  // 10 cartas por rodada
function hostStartPick() {
  const pieces = Object.keys(ITEMS).filter(k => ITEMS[k].kind === 'piece');
  const obs = Object.keys(ITEMS).filter(k => ITEMS[k].kind === 'obs');
  const deck = shuffle([...drawDistinct(pieces, DECK_PIECES), ...drawDistinct(obs, DECK_OBS)])
    .map((type, i) => ({ id: i, type, rot: Math.round(rnd(-4, 4)), by: -1 }));
  HST.botAt = {}; HST.botPlaceAt = {}; HST.placeEnd = -1;
  for (const p of G.players) if (p.bot) HST.botAt[p.id] = rnd(0.8, 4);
  hostEnter('pick', { tray: deck, placed: {}, dur: 20 });
}
function broadcastBuild() { broadcast({ t: 'track', types: trackTypes(), obs: obsData(), placed: G.placed }); }
export function hostPick(pid, id) {
  if (G.state !== 'pick' || G.holds[pid] !== undefined || G.placed[pid]) return;
  const item = G.tray.find(i => i.id === id);
  if (!item || item.by >= 0) { sendTo(pid, { t: 'msg', text: 'ALGUÉM PEGOU ANTES!', color: '#ff2e55', deny: true }); return; }
  if (!itemEnabled(item.type)) { sendTo(pid, { t: 'msg', text: 'SEM ESPAÇO PARA ESSA CARTA!', color: '#ff2e55', deny: true }); return; }
  item.by = pid;
  applyTray(G.tray); broadcast({ t: 'tray', tray: G.tray });
  const pl = playerById(pid); if (pl && pl.bot) HST.botPlaceAt[pid] = G.phaseT + rnd(0.8, 3);
}
// "Voltar às Cartas": devolve a carta ainda não posicionada (a rodada não avança)
export function hostUnpick(pid) {
  if (G.state !== 'pick' || G.placed[pid]) return;
  const item = G.tray.find(i => i.id === G.holds[pid]); if (!item) return;
  item.by = -1;
  applyTray(G.tray); broadcast({ t: 'tray', tray: G.tray });
}
export function hostPlace(pid, slotKey, auto) {
  if (G.state !== 'pick' || G.placed[pid]) return;
  const it = G.tray.find(i => i.id === G.holds[pid]); if (!it) return;
  let ok = false;
  if (ITEMS[it.type].kind === 'piece') {
    const m = megaIndex();
    if (m < 0) {                                                  // pista linear: encaixa antes da chegada
      ok = canPlace(it.type);
      if (ok) { const t = trackTypes(); t.splice(t.length - 1, 0, it.type); applyTrack(t, obsData(), true); }
    } else {                                                      // com Mega Pista: numa das 4 saídas livres (x0..x3) OU no fim da pista (end)
      let onde = slotKey === 'end' ? -2 : slotKey && /^x[0-3]$/.test(slotKey) ? +slotKey[1] : null;
      if (onde !== null && !canPlace(it.type, onde)) onde = null;
      if (onde === null) {                                        // sem escolha válida: 1ª saída livre que aceita a carta; senão o fim da pista
        const k = freeExits().find(e => canPlace(it.type, e));
        onde = k !== undefined ? k : canPlace(it.type, -2) ? -2 : null;
      }
      if (onde !== null) {
        const t = trackTypes();
        if (onde === -2) t.splice(t.length - 1, 0, it.type); else t.push('x' + onde + ':' + it.type);
        const oldSig = pieceSigs(), newSig = layoutSigs(t);       // obstáculos acompanham a peça (os índices mudam quando entra peça no meio)
        const list = obsData().map(o => { const [pi, si] = o.key.split(':').map(Number); const ni = newSig.indexOf(oldSig[pi]); return ni < 0 ? null : { ...o, key: ni + ':' + si }; }).filter(Boolean);
        applyTrack(t, list, true); ok = true;
      }
    }
    if (!ok) sendTo(pid, { t: 'msg', text: 'NÃO COUBE NA PISTA!', color: '#ff2e55', deny: true });
  } else {
    const free = freeSlots();
    if (!slotKey || !free.includes(slotKey)) {
      if (!auto) { sendTo(pid, { t: 'msg', text: 'ESPAÇO OCUPADO!', color: '#ff2e55', deny: true }); return; }
      slotKey = free.length ? free[Math.floor(Math.random() * free.length)] : null;
    }
    if (slotKey) {
      const list = obsData(); list.push({ key: slotKey, type: it.type, ph: r2(rnd(0, TAU)), spd: r2((Math.random() < 0.5 ? -1 : 1) * rnd(1.4, 2.0)) });
      applyTrack(trackTypes(), list, true); ok = true;
    }
  }
  G.placed[pid] = ok ? 'ok' : 'no';
  renderBuild(); broadcastBuild();
}
// tempo acabou / bot: usa a carta que tem (ou uma sobra utilizável) e posiciona sozinho
function hostAutoPlace(pid) {
  if (G.placed[pid]) return;
  if (G.holds[pid] === undefined) {
    const free = G.tray.filter(i => i.by < 0 && itemEnabled(i.type));
    if (free.length) { free[Math.floor(Math.random() * free.length)].by = pid; applyTray(G.tray); broadcast({ t: 'tray', tray: G.tray }); }
  }
  const it = G.tray.find(i => i.id === G.holds[pid]);
  if (!it) { G.placed[pid] = 'no'; renderBuild(); broadcastBuild(); return; }
  if (ITEMS[it.type].kind === 'obs') { const fs = freeSlots(); hostPlace(pid, fs[Math.floor(Math.random() * fs.length)], true); }
  else hostPlace(pid, null, true);
}
export function hostUpdateBuild() {
  if (G.state === 'results') { if (G.phaseT >= G.phaseDur) hostAfterResults(); return; }
  if (G.state !== 'pick') return;
  for (const id in HST.botAt) if (G.phaseT >= HST.botAt[id]) {
    delete HST.botAt[id];
    const free = G.tray.filter(i => i.by < 0 && itemEnabled(i.type));
    if (free.length) hostPick(+id, free[Math.floor(Math.random() * free.length)].id); else hostAutoPlace(+id);
  }
  for (const id in HST.botPlaceAt) if (G.phaseT >= HST.botPlaceAt[id]) { delete HST.botPlaceAt[id]; hostAutoPlace(+id); }
  if (HST.placeEnd < 0 && (G.players.every(p => G.placed[p.id]) || G.phaseT >= G.phaseDur)) {
    for (const p of G.players) hostAutoPlace(p.id);
    HST.placeEnd = G.phaseT + 1.3;
  }
  if (HST.placeEnd >= 0 && G.phaseT >= HST.placeEnd) hostStartRound();
}
