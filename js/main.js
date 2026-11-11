// Ponto de entrada: laço principal, atualização da corrida, boot e registro dos hooks.
import { G, hooks } from './state.js';
import { $, clamp, lerp, rnd, store } from './utils.js';
import { DRIFT, NET_DT, PH, SUBSTEP, TARGET_OPTS } from './config.js';
import { SFX } from './audio.js';
import { applyTheme, camera, H, M, renderer, scene, sun, texChevron, texChevron1, texWind, W } from './scene.js';
import { burst, emit, updateParticles } from './fx.js';
import { applyTrack, canPlace, dropAnims, INITIAL_TYPES, obstacles, slotGroup, tmpW, track } from './track.js';
import { beamMat, freeSlots, rebuildSlots, syncObstacles } from './obstacles.js';
import { cars, isHost, isMP, myCar, NET } from './cars.js';
import { centerText, showScreen, toast, updateHud } from './hud.js';
import { carCollisions, giveBoost, obsClock, pistonLift, stepCar, trackContact } from './physics.js';
import { aiDrive } from './ai.js';
import { broadcast, broadcastFast, packCar, setStatus, toHost, toHostFast, updateRemote } from './net.js';
import { BC, drawFx, followCamera, overviewCamera, panBy, PTRS, zoomBy } from './camera.js';
import { applyEffect, resetItems, hostPickup, hostUse, itemClientMsg, itemHostMsg, itemSnapshot, IT, updateItems, useItem } from './items.js';
import { applyTray, buildMode, itemEnabled, pickCard, renderBuild, tryPlaceAt } from './build-ui.js';
import { hostEndRound, hostPick, hostPlace, hostRegisterFinish, hostUnpick, hostUpdateBuild } from './host.js';
import { act, enterPhase, goTitle, renderLobby, setState } from './phases.js';
import { applyDevice, keys, readPlayerInput, refreshButtons, syncTouch, tmap, uiActive } from './input.js';

// funções chamadas "de baixo para cima" (ver state.js)
Object.assign(hooks, { applyTray, BC, enterPhase, goTitle, hostPick, hostPlace, hostRegisterFinish, hostUnpick, itemClientMsg, itemHostMsg, itemSnapshot, rebuildSlots, renderBuild, renderLobby, syncObstacles, syncTouch, tmap, uiActive });
function update(dt) {
  G.clockT += dt;
  G.phaseT += dt;
  texChevron.offset.x -= dt * 2.2; texChevron1.offset.x -= dt * 2.2; texWind.offset.x -= dt * 1.6;
  updateDrops(dt);
  animateObstacles(dt);
  updateItems(dt);
  if (G.state === 'countdown' || G.state === 'race') { updateRace(dt); return; }
  if (isHost()) hostUpdateBuild();
  if (G.state === 'pick') {
    const k = G.phaseDur ? clamp(1 - G.phaseT / G.phaseDur, 0, 1) : 0;
    $('phaseBar').style.width = (k * 100) + '%';
    $('phaseBar').style.background = k < 0.3 ? '#ff2e55' : '#a6ff3b';
    if (slotGroup.visible) {
      M.slot.opacity = 0.6 + 0.35 * Math.sin(G.clockT * 6); beamMat.opacity = 0.2 + 0.12 * Math.sin(G.clockT * 6);
      const sc = clamp((BC.manual ? BC.d : BC.autoD) / 55, 1, 2.4);   // marcador cresce quando a câmera está longe
      for (const g of slotGroup.children) g.scale.setScalar(sc);
    }
  }
  overviewCamera(dt);
  SFX.update(0, 0, false, 0, false, 0);
  updateCars(dt, false);
}
function updateRace(dt) {
  const me = myCar();
  if (G.state === 'countdown') {
    G.R.cd -= dt;
    if (me) {
      readPlayerInput(me.inp);
      if (me.inp.gasRaw && !G.R.startPressed) { G.R.startPressed = true; G.R.startEligible = G.R.cd <= 0.55; }
      if (!me.inp.gasRaw) { G.R.startPressed = false; G.R.startEligible = false; }
    }
    const n = Math.ceil(G.R.cd);
    if (n < G.R.lastBeep && n >= 1) { G.R.lastBeep = n; SFX.beep(false); centerText(String(n), n === 2 ? '#ff9a1f' : '#ffd23f'); }
    if (G.R.cd <= 0) {
      setState('race'); SFX.beep(true); centerText('VAI!', '#a6ff3b');
      setTimeout(() => { if ($('center').textContent === 'VAI!') $('center').textContent = ''; }, 700);
      if (me && G.R.startEligible && me.inp.gasRaw) { giveBoost(me, 0.45, 0.9, 5); SFX.boost(2); toast('LARGADA PERFEITA!', '#ffd23f', 1.2); }
      for (const c of cars) if (c.owned && c.bot && Math.random() < 0.35) giveBoost(c, 0.25, 0.6, 3);
    }
    SFX.update(0, me ? me.inp.throttle : 0, false, 0, true, 0);
    for (const c of cars) if (!c.owned) updateRemote(c, dt);
  } else {
    G.R.t += dt;
    // rubber-band leve dos bots em relação aos humanos
    let hMax = -1e9, hMin = 1e9;
    for (const c of cars) if (!c.bot && c.alive && !c.finished) { hMax = Math.max(hMax, c.prog); hMin = Math.min(hMin, c.prog); }
    for (const c of cars) {
      if (!c.owned) continue;
      if (c.isLocal && !c.finished) readPlayerInput(c.inp); else aiDrive(c, dt, c.inp);
      if (c.bot) {
        let m = 0.93 + 0.07 * c.ai.skill;
        if (hMax > -1e9) { if (c.prog > hMax + 20) m *= 1 - clamp((c.prog - hMax - 20) / 50, 0, 1) * 0.05; if (c.prog < hMin) m *= 1 + clamp((hMin - c.prog) / 40, 0, 1) * 0.06; }
        c.maxMul = m;
      } else c.maxMul = 1;
    }
    for (const c of cars) if (!c.owned) updateRemote(c, dt);
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-6)), h = dt / n;
    for (let k = 0; k < n; k++) {
      for (const c of cars) if (c.owned) stepCar(c, c.inp, h);
      carCollisions();
    }
    spawnCarFx(dt);
    if (isHost()) {
      const running = cars.filter(c => c.alive && !c.finished).length;
      if (G.R.endT < 0 && (running === 0 || (G.R.firstFinishT >= 0 && G.R.t - G.R.firstFinishT > 8) || G.R.t > G.R.maxT)) {
        G.R.endT = G.R.t;
        if (running > 0) { toast('TEMPO ESGOTADO!', '#ff9a1f', 1.4); broadcast({ t: 'msg', text: 'TEMPO ESGOTADO!', color: '#ff9a1f' }); }
      }
      if (G.R.endT >= 0 && G.R.t - G.R.endT > 1.4) { hostEndRound(); return; }
    }
    if (me) {
      const sp = Math.hypot(me.vx, me.vz);
      SFX.update(sp / PH.maxSpeed, me.alive && !me.finished ? me.inp.throttle : 0, me.boostT > 0,
        me.grounded ? clamp((Math.abs(me.vl) - 2) / 7, 0, 1) + (me.drifting ? 0.35 : 0) : 0, me.alive, clamp((sp - 15) / 15, 0, 1));
    }
    if (G.R.spectateT > 0) G.R.spectateT -= dt;
  }
  // rede: host manda tudo; cliente manda só o próprio carro
  G.R.netAcc += dt;
  if (G.R.netAcc >= NET_DT && isMP()) {
    G.R.netAcc = 0;
    if (NET.role === 'host') broadcastFast({ t: 'snap', c: cars.map(packCar) });
    else if (me) toHostFast({ t: 'st', s: packCar(me).slice(1) });
  }
  updateCars(dt, true);
  followCamera(dt);
  updateHud();
}
function updateDrops(dt) {
  for (let i = dropAnims.length - 1; i >= 0; i--) {
    const a = dropAnims[i];
    a.t += dt;
    const k = clamp(a.t / a.dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
    a.g.position.y = lerp(a.y0, a.yEnd, e);
    if (k >= 1 && !a.landed) {
      a.landed = true; a.g.position.y = a.yEnd; SFX.place(); G.shake = Math.max(G.shake, 0.3);
      if (a.piece) { a.piece.world(a.piece.len / 2, 0, tmpW); burst(tmpW.x, 0.5, tmpW.z, 40, 0.6, 0.9, 1, 12, 0.8, 10); }
      else burst(a.g.position.x, a.yEnd + 0.5, a.g.position.z, 20, 1, 0.5, 0.8, 8, 0.6, 10);
      dropAnims.splice(i, 1);
    }
  }
}
function animateObstacles(dt) {
  const tc = obsClock();
  for (const o of obstacles) {
    if (o.type === 'spinner' && o.bar) o.bar.rotation.y = -(o.ph + tc * o.spd);
    if (o.type === 'bumper' && o.bar) { o.pulse = Math.max(0, o.pulse - dt); const s = 1 + o.pulse * 0.8; o.bar.scale.set(s, 1, s); }
    if (o.type === 'piston' && o.bar) { o.lift = pistonLift(o, tc); o.bar.position.y = -2.4 * (1 - o.lift); }
  }
}
function spawnCarFx(dt) {
  for (const c of cars) {
    if (!c.alive) continue;
    const fx = Math.cos(c.a), fz = Math.sin(c.a), rx = -fz, rz = fx;
    if (c.drifting && c.grounded) {
      c.fxAcc = (c.fxAcc || 0) + dt * (c.driftLevel > 0 ? 70 : 25);
      while (c.fxAcc >= 1) {
        c.fxAcc -= 1;
        const sd = Math.random() < 0.5 ? 1 : -1;
        const wx = c.x - fx * 0.8 + rx * 0.66 * sd, wz = c.z - fz * 0.8 + rz * 0.66 * sd;
        if (c.driftLevel > 0) {
          const [r, g, b] = DRIFT.col[c.driftLevel - 1];
          const a = c.a + Math.PI + rnd(-0.9, 0.9), s = rnd(2, 7);
          emit(wx, c.y + 0.15, wz, Math.cos(a) * s + c.vx * 0.5, rnd(1, 4), Math.sin(a) * s + c.vz * 0.5, rnd(0.15, 0.35), r, g, b, 14);
        } else emit(wx, c.y + 0.2, wz, c.vx * 0.2 + rnd(-1, 1), rnd(0.5, 1.5), c.vz * 0.2 + rnd(-1, 1), rnd(0.3, 0.5), 0.35, 0.35, 0.4, -1);
      }
    } else c.fxAcc = 0;
    if (c.boostT > 0 && Math.random() < dt * 50) {
      emit(c.x - fx * 1.9, c.y + 0.45, c.z - fz * 1.9, -fx * rnd(4, 9) + c.vx * 0.6, rnd(-0.5, 1), -fz * rnd(4, 9) + c.vz * 0.6, rnd(0.12, 0.25),
        c.isLocal ? 0.3 : 1, c.isLocal ? 0.95 : 0.6, c.isLocal ? 1 : 0.15, 0);
    }
    if (c.oilT > 0 && c.grounded && Math.random() < dt * 30) emit(c.x, c.y + 0.2, c.z, rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1), 0.4, 0.35, 0.25, 0.8, 3);
  }
}
function updateCars(dt, racing) {
  const tnow = performance.now() / 1000;
  for (const c of cars) {
    const m = c.mesh;
    if (!racing || c.y < -90) { m.root.visible = false; continue; }
    m.root.visible = true;
    m.root.position.set(c.x, c.y, c.z);
    let pitchT = 0;
    if (c.grounded && c.Q && c.Q.slope && c.owned) pitchT = Math.atan(c.Q.slope * Math.cos(c.a - Math.atan2(c.Q.fz, c.Q.fx)));
    else if (!c.grounded) pitchT = Math.atan2(c.vy || 0, Math.max(4, Math.abs(c.vf || 0))) * 0.7;
    c.pitch = (c.pitch || 0) + (pitchT - (c.pitch || 0)) * (1 - Math.exp(-dt * 12));
    const rollT = c.grounded ? -(c.steer || 0) * clamp(Math.abs(c.vf || 0) / 25, 0, 1) * (c.drifting ? 0.12 : 0.06) : 0;
    c.roll = (c.roll || 0) + (rollT - (c.roll || 0)) * (1 - Math.exp(-dt * 10));
    m.root.rotation.set(c.roll + (c.alive ? 0 : c.tumbleX || 0), -c.a, c.pitch + (c.alive ? 0 : c.tumbleZ || 0));
    c.squash = Math.max(0, (c.squash || 0) - dt);
    const hop = c.hop > 0 ? Math.sin(c.hop / 0.16 * Math.PI) * 0.35 : 0;
    m.body.position.y = hop;
    m.body.scale.set(1 + c.squash * 0.4, 1 - c.squash * 0.8, 1 + c.squash * 0.4);
    c.spin = (c.spin || 0) - (c.vf || 0) * dt / 0.34;
    for (const w of m.wheels) { w.spin.rotation.z = c.spin; if (w.front) w.piv.rotation.y = -(c.steer || 0) * 0.45; }
    const boosting = c.boostT > 0;
    m.flame.visible = m.flameCore.visible = boosting;
    if (boosting) { const s = 0.8 + Math.random() * 0.5; m.flame.scale.set(1, s * (0.8 + (c.boostPow || 0.3)), 1); m.flameCore.scale.set(1, s, 1); }
    m.mTail.color.setHex(c.braking ? 0xff2020 : 0x8a1020);
    m.glow.visible = c.alive && c.y > -2;
    if (m.marker) { m.marker.position.y = 2.4 + Math.sin(tnow * 5) * 0.15; m.marker.visible = c.alive; }
  }
}

// ------------------------------------------------------------------ loop
G.last = performance.now(); let fpsEMA = 60; let slow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - G.last) / 1000; G.last = now;
  if (dt <= 0) return;
  if (dt > 0.05) dt = 0.05;
  fpsEMA += (1 / dt - fpsEMA) * 0.05;
  // desempenho adaptativo: 1º desliga sombras, depois reduz a resolução interna
  if (G.state === 'race' && fpsEMA < 42 && (sun.castShadow || G.PR > 0.75)) {
    if (++slow > 90) { if (sun.castShadow) sun.castShadow = false; else { G.PR = Math.max(0.75, G.PR - 0.25); renderer.setPixelRatio(G.PR); renderer.setSize(W, H); } slow = 0; }
  } else slow = 0;
  if (G.state !== 'paused') { update(dt); updateParticles(dt); }
  drawFx(dt);
  renderer.render(scene, camera);
}

// host em segundo plano: o navegador congela o requestAnimationFrame, então um Worker
// mantém a simulação/rede rodando (senão a sala inteira trava quando o host minimiza)
let bgWorker = null;
try {
  const src = 'let i=null;onmessage=e=>{clearInterval(i);i=e.data?setInterval(()=>postMessage(0),33):null}';
  bgWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  bgWorker.onmessage = () => {
    if (!document.hidden) return;
    const now = performance.now(); let dt = (now - G.last) / 1000; G.last = now;
    if (dt > 0) update(Math.min(dt, 0.1));
  };
} catch (e) { bgWorker = null; }
document.addEventListener('visibilitychange', () => { if (bgWorker) bgWorker.postMessage(document.hidden && NET.role === 'host'); });

// ------------------------------------------------------------------ boot
if (G.myDevice === 'mobile') { G.PR = Math.min(G.PR, 1.5); renderer.setPixelRatio(G.PR); }
{ const t = store.get('target', 10000); if (TARGET_OPTS.includes(t)) G.TARGET = t; }
applyTheme(store.get('theme', 'neon'));
$('nameInp').value = G.myName;
const qs = new URLSearchParams(location.search);
if (qs.get('sala')) { $('codeInp').value = qs.get('sala').toUpperCase().slice(0, 5); setStatus('Convite recebido! Escolha seu nome e toque em ENTRAR NA SALA.'); }
applyDevice();
refreshButtons();
applyTrack(INITIAL_TYPES, [], false);
setState('title'); showScreen('title');
$('loading').remove();
window.__game = {
  get state() { return G.state; }, get R() { return G.R; }, get track() { return track; }, get obstacles() { return obstacles; },
  get tray() { return G.tray; }, get holds() { return G.holds; }, get placed() { return G.placed; }, get players() { return G.players; },
  get NET() { return NET; }, cars, update, act, canPlace, freeSlots, hostPick, hostPlace, toHost, myCar, keys,
  get BC() { return BC; }, PTRS, pickCard, buildMode, itemEnabled, stepCar, trackContact, tryPlaceAt, panBy, zoomBy, applyTrack, camera,
  IT, useItem, hostUse, hostPickup, applyEffect, itemSnapshot, itemClientMsg, resetItems
};
requestAnimationFrame(frame);
