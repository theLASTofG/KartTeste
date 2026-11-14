// Máquina de estados/fases, telas e lobby.
import { G, hooks } from './state.js';
import { $, clamp, esc, rnd, store } from './utils.js';
import { fmtPts, GRID_SLOTS, HW, MAXP, PH, SIDE_WALLS, TARGET_OPTS } from './config.js';
import { SFX } from './audio.js';
import { applyTheme, themeKey, THEMES } from './scene.js';
import { activeExits, applyTrack, finishGlobal, INITIAL_TYPES, obstacles, PRESETS, presetPreview, tmpW, track, trackTypes } from './track.js';
import { applyBots, cars, isHost, isMP, NET, plist, syncCars } from './cars.js';
import { centerText, showScreen, toast, updateBoard } from './hud.js';
import { announceNow, createRoom, hostKick, hostLobbyChanged, joinRoom, leaveRoom, startSolo, toHost } from './net.js';
import { closeRoomAnnouncement } from './rooms.js';
import { setSlotMode } from './camera.js';
import { applyFree, clearFree, freeOnRoundEnd } from './freeobs.js';
import { confirmFree, endFree } from './freeplace.js';
import { applyTray, buildMode, showChampion, showResults } from './build-ui.js';
import { hostAfterResults, hostEnter, hostStartMatch } from './host.js';
import { resetItems } from './items.js';
export function setState(s) {
  G.state = s;
  document.body.classList.toggle('racing', s === 'countdown' || s === 'race');
  document.body.classList.toggle('building', s === 'pick' || s === 'results');
  document.body.classList.toggle('showhud', ['countdown', 'race', 'results', 'pick', 'paused'].includes(s));
}
function hidePhaseUI() {
  $('tray').classList.remove('show'); $('placebar').classList.remove('show'); $('phaseHdr').classList.remove('show');
  setSlotMode(false); G.menuOpen = false; endFree();
}
// executada em TODOS os peers com os dados enviados pelo host
export function enterPhase(ph, d) {
  d = d || {};
  G.phaseT = 0; G.phaseDur = d.dur || 0;
  resetItems();                                    // itens/caixas/projéteis nunca atravessam rodadas
  hidePhaseUI();
  G.lookBack = false;
  // armadilhas livres: reveladas no início da rodada, expiram ao fim dela; em qualquer outra fase não há nenhuma
  if (ph === 'countdown') applyFree(d.free); else if (ph === 'results') freeOnRoundEnd(); else clearFree();
  if (d.target) G.TARGET = d.target;
  if (d.cross !== undefined) G.allowCross = !!d.cross;
  if (d.theme && d.theme !== themeKey) applyTheme(d.theme);
  if (d.players) { G.players = d.players; syncCars(); updateBoard(); }
  $('confetti').style.display = 'none';
  switch (ph) {
    case 'lobby':
      setState('lobby'); showScreen('lobby'); renderLobby();
      for (const c of cars) c.mesh.root.visible = false;
      if (trackTypes().join() !== INITIAL_TYPES.join() || obstacles.length) { applyTrack(['start', 'finish'], [], false); applyTrack(INITIAL_TYPES, [], false); }
      break;
    case 'countdown':
      applyTrack(d.types, d.obs, false);
      G.round = d.round;
      placeCars(d.grid);
      G.R = { t: 0, cd: d.dur || 3.2, lastBeep: 4, finishCount: 0, firstFinishT: -1, endT: -1, maxT: 14 + finishGlobal / 9,
        startPressed: false, startEligible: false, spectateT: 0, netAcc: 0 };
      $('rnd').textContent = 'RODADA ' + G.round + ' · ' + track.filter(p => p.type !== 'finish').length + ' PEÇAS';
      G.lastHud = {}; hooks.tmap.clear(); hooks.syncTouch();
      showScreen(null); G.camSnap = true;
      setState('countdown');
      centerText('3', '#ff2e55'); SFX.beep(false); G.R.lastBeep = 3;
      break;
    case 'results': showResults(d); setState('results'); break;
    case 'pick':                                     // montagem: pegar carta + posicionar (ou voltar às cartas)
      for (const c of cars) c.mesh.root.visible = false;
      G.placed = d.placed || {};
      setState('pick'); showScreen(null);
      $('phaseHdr').classList.add('show');
      applyTray(d.tray);
      SFX.warn();
      break;
    case 'champion': setState('champion'); showChampion(d); break;
  }
}
function placeCars(grid) {
  const exits = activeExits().sort(() => Math.random() - 0.5); let bi = 0;     // bots se dividem entre as saídas ativas da Mega Pista
  for (const c of cars) {
    const slot = grid[c.pid] !== undefined ? grid[c.pid] : 0;
    const sl = GRID_SLOTS[slot % GRID_SLOTS.length];
    track[0].world(sl[0], sl[1], tmpW);
    Object.assign(c, {
      x: tmpW.x, z: tmpW.z, y: 0, a: tmpW.a, vx: 0, vz: 0, vy: 0, vf: 0, vl: 0, steer: 0, grip: PH.grip, kick: 0, hop: 0,
      drifting: false, driftDir: 0, driftT: 0, driftLevel: 0, boostT: 0, boostPow: 0, boostMax: 1, padCool: 0, oilT: 0,
      pi: 0, s: sl[0], v: sl[1], prog: sl[0], grounded: true, voidFall: false, item: null, itemReadyAt: 0, itemRollEnd: 0, itemCool: 0, pickCool: 0, deaths: 0, checkpointIdx: 0, checkpointS: 2.2, invuln: 0, lastHitBy: null, lastHitTimer: 0, freezeT: 0, slowT: 0, stunT: 0, spinT: 0, spinDir: 1, immuneT: 0, alive: true, finished: false, finishOrder: 0, finishT: 0, fallProg: 0,
      hitCool: 0, stuckT: 0, airT: 0, tumbleX: 0, tumbleZ: 0, spin: 0, pitch: 0, roll: 0, fxAcc: 0, braking: false, squash: 0, net: null, maxMul: 1,
      buf: null, netTs: 0, netOff: undefined, jit: undefined, interp: undefined, cpx: tmpW.x, cpz: tmpW.z, kickCool: 0
    });
    c.ai.lane = sl[1] * 0.5;
    c.ai.exit = exits.length ? exits[bi++ % exits.length] : 0;
    // erros sorteados por peça para os bots (caos estilo Make Way)
    c.ai.err = c.bot && isHost() ? track.map(p => {
      const k = 1.25 - c.ai.skill;
      if (p.type === 'bridge' && Math.random() < 1.1 * k) return { lane: (Math.random() < 0.5 ? -1 : 1) * rnd(1.6, 3.2) };
      if ((p.type === 'jump' || p.type === 'minijump') && Math.random() < 0.6 * k) return { slow: rnd(9, 15) };
      if (p.type === 'tripjump' && Math.random() < 0.5 * k) return { slow: rnd(10, 14) };
      if (p.turn && Math.random() < 0.55 * k) return { lane: p.turn * (SIDE_WALLS ? rnd(4.4, 6.5) : rnd(2.4, HW - 1.6)) };   // sem mureta, nunca mira fora da pista
      if (p.type === 'holes' && Math.random() < 0.8 * k) return { lane: rnd(-1.2, 1.2) };
      if (p.type === 'wind' && Math.random() < 0.7 * k) return { lane: p.windDir * rnd(1.5, 3) };
      if (p.type === 'bigjump' && Math.random() < 0.5 * k) return { slow: rnd(14, 20) };
      if (p.type === 'doublejump' && Math.random() < 0.5 * k) return { slow: rnd(11, 15) };
      return null;
    }) : null;
    if (c.ai.err) {                         // no máximo 1–2 erros por bot por rodada (pista longa não vira massacre)
      const idx = c.ai.err.map((e, i) => e ? i : -1).filter(i => i >= 0).sort(() => Math.random() - 0.5);
      const keep = Math.random() < 0.3 ? 2 : 1;
      for (const i of idx.slice(keep)) c.ai.err[i] = null;
    }
    c.mesh.root.visible = true;
    c.Q = {};
    track[0].query(c.x, c.z, c.Q);
  }
}
export function pauseGame() {
  if (isMP()) {                       // multiplayer: a sala não pausa, só abre o menu
    G.menuOpen = true; $('pauseTitle').textContent = 'MENU'; $('pauseNote').textContent = 'A corrida continua para os outros jogadores!';
    showScreen('pause'); hooks.tmap.clear(); hooks.syncTouch(); return;
  }
  G.prevState = G.state; setState('paused'); hooks.tmap.clear(); hooks.syncTouch(); SFX.update(0, 0, false, 0, false, 0);
  $('pauseTitle').textContent = 'PAUSADO'; $('pauseNote').textContent = ''; showScreen('pause');
}
export function resume() {
  if (G.menuOpen) { G.menuOpen = false; showScreen(null); return; }
  if (G.state !== 'paused') return; showScreen(null); setState(G.prevState); G.last = performance.now();
}
export function act(a) {
  SFX.init(); SFX.click();
  switch (a) {
    case 'solo': startSolo(); break;
    case 'host': createRoom(); break;
    case 'join': joinRoom(); break;
    case 'leave': leaveRoom(); break;
    case 'botminus': if (isHost()) { G.botCount = Math.max(0, G.players.filter(p => p.bot).length - 1); applyBots(); hostLobbyChanged(); } break;
    case 'botplus': if (isHost()) { G.botCount = Math.min(MAXP - G.players.filter(p => !p.bot).length, G.players.filter(p => p.bot).length + 1); applyBots(); hostLobbyChanged(); } break;
    case 'targetminus': case 'targetplus': if (isHost() && G.state === 'lobby') {
      const i = TARGET_OPTS.indexOf(G.TARGET), j = clamp((i < 0 ? 3 : i) + (a === 'targetplus' ? 1 : -1), 0, TARGET_OPTS.length - 1);
      G.TARGET = TARGET_OPTS[j]; store.set('target', G.TARGET); hostLobbyChanged();
    } break;
    case 'cross': if (isHost() && G.state === 'lobby') { G.allowCross = !G.allowCross; store.set('cross', G.allowCross); hostLobbyChanged(); } break;
    case 'presetprev': case 'presetnext': case 'presetrand': if (isHost() && G.state === 'lobby') {
      const ks = Object.keys(PRESETS), i = Math.max(0, ks.indexOf(G.presetKey));
      let k;
      if (a === 'presetrand') { do k = ks[Math.floor(Math.random() * ks.length)]; while (k === G.presetKey && ks.length > 1); }
      else k = ks[(i + (a === 'presetnext' ? 1 : ks.length - 1)) % ks.length];
      G.presetKey = k; store.set('preset', k);
      if (PRESETS[k].theme && themeKey !== PRESETS[k].theme) { applyTheme(PRESETS[k].theme); store.set('theme', themeKey); }
      if (PRESETS[k].cross && !G.allowCross) { G.allowCross = true; store.set('cross', true); toast('CRUZAR PISTA ligado (a pista usa 2 andares)', '#ffd23f', 1.6); }
      hostLobbyChanged();
    } break;
    case 'public': if (NET.role === 'host' && G.state === 'lobby') {
      G.publicRoom = !G.publicRoom; store.set('public', G.publicRoom);
      if (G.publicRoom) announceNow(); else closeRoomAnnouncement(NET.code);
      renderLobby(); toast(G.publicRoom ? 'SALA PÚBLICA: aparece na lista' : 'SALA PRIVADA: só por código', '#ffd23f', 1.4);
    } break;
    case 'theme': if (isHost() && G.state === 'lobby') {
      const ks = Object.keys(THEMES); applyTheme(ks[(ks.indexOf(themeKey) + 1) % ks.length]); store.set('theme', themeKey); hostLobbyChanged();
    } break;
    case 'start': if (isHost() && G.state === 'lobby') { if (G.players.length < 2) { G.botCount = 1; applyBots(); hostLobbyChanged(); } hostStartMatch(); } break;
    case 'copylink': {
      const url = location.href.split('?')[0].split('#')[0] + '?sala=' + NET.code;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('LINK COPIADO!', '#a6ff3b', 1.2), () => prompt('Copie o link:', url));
      break;
    }
    case 'continue': if (isHost() && G.state === 'results') hostAfterResults(); break;
    case 'resume': resume(); break;
    case 'again': if (isHost() && G.state === 'champion') { if (NET.role === 'solo') hostStartMatch(); else { for (const p of G.players) p.score = 0; hostEnter('lobby', { players: plist() }); } } break;
    case 'placefree': if (G.state === 'pick' && buildMode() === 'free') confirmFree(); break;
    case 'placepiece': if (G.state === 'pick' && buildMode() === 'piece') toHost({ t: 'place' }); break;
    case 'backcards': if (G.state === 'pick' && (buildMode() === 'piece' || buildMode() === 'obs')) { SFX.click(); toHost({ t: 'unpick' }); } break;
  }
}
export function goTitle() {
  clearFree(); resetItems(); hidePhaseUI(); $('confetti').style.display = 'none';
  G.R = null; setState('title'); showScreen('title'); SFX.update(0, 0, false, 0, false, 0);
  for (const c of cars) c.mesh.root.visible = false;
  if (trackTypes().join() !== INITIAL_TYPES.join() || obstacles.length) { applyTrack(['start', 'finish'], [], false); applyTrack(INITIAL_TYPES, [], false); }
}
export function renderLobby() {
  $('lobbyCode').textContent = NET.role === 'solo' ? 'SOLO' : (NET.code || '-----');
  $('shareRow').style.display = NET.role === 'host' ? '' : 'none';
  $('hostCtl').style.display = isHost() ? '' : 'none';
  $('lobbyWait').style.display = isHost() ? 'none' : '';
  $('botN').textContent = G.players.filter(p => p.bot).length;
  $('targetN').textContent = fmtPts(G.TARGET);
  const PR = PRESETS[G.presetKey], stars = '★'.repeat(PR.diff || 1) + '☆'.repeat(3 - (PR.diff || 1));
  $('presetN').textContent = PR.name;
  $('trackName').innerHTML = esc(PR.name) + '<span class="st">' + stars + '</span>';
  $('trackDesc').textContent = (PR.desc || '') + ' · ' + PR.types.filter(t => t !== 'start' && t !== 'finish').length + ' peças';
  $('trackPrev').innerHTML = presetPreview(G.presetKey);
  $('themeBtn').textContent = 'TEMA: ' + THEMES[themeKey].name;
  $('publicBtn').textContent = 'SALA: ' + (G.publicRoom ? 'PÚBLICA' : 'PRIVADA');
  $('publicBtn').style.display = NET.role === 'host' ? '' : 'none';
  $('crossBtn').textContent = 'CRUZAR PISTA: ' + (G.allowCross ? 'SIM' : 'NÃO');
  if (!$('lobbyWait').dataset.rejoin) $('lobbyWait').textContent = 'Aguardando o host começar... Meta: ' + fmtPts(G.TARGET) + ' pts · Pista: ' + PRESETS[G.presetKey].name + ' · Tema: ' + THEMES[themeKey].name;
  $('lobbyList').innerHTML = G.players.map(p => `<div class="pl"><span class="sw" style="background:${p.color}"></span><span>${esc(p.name)}${p.id === G.myId ? ' <span style="opacity:.6">(você)</span>' : ''}</span>
    ${p.id === 0 && !p.bot ? '<span class="hostb">HOST</span>' : ''}<span class="dv">${p.bot ? '🤖 BOT' : p.device === 'mobile' ? '📱 CELULAR' : '💻 PC'}</span>${NET.role === 'host' && !p.bot && p.id !== G.myId ? `<button class="kick" data-kick="${p.id}" title="Remover da sala">✕</button>` : ''}</div>`).join('') +
    `<div class="note">${G.players.length}/${MAXP} pilotos${NET.role === 'host' ? ' · Mande o código ou o link para seus amigos' : ''}</div>`;
}
document.addEventListener('visibilitychange', () => { if (document.hidden && hooks.uiActive() && !isMP()) pauseGame(); });
// host remove um jogador da sala (só no lobby)
$('lobbyList').addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-kick]');
  if (b && NET.role === 'host' && G.state === 'lobby') { SFX.click(); hostKick(+b.dataset.kick); }
});
