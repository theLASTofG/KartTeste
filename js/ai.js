// IA dos bots.
import { G } from './state.js';
import { clamp, wrapA } from './utils.js';
import { CAR_R, GEY, geyserState, MEGA, PH, PROFILES } from './config.js';
import { finishGlobal, obstacles, pieceAt, pieceStart, succIdx, track, trackPoint } from './track.js';
import { respawn } from './physics.js';
import { cars } from './cars.js';

// ------------------------------------------------------------------- IA
const tmpA = {};
const nxt = (i, c) => { const n = succIdx(i, 0, c.ai.exit); return n >= 0 ? track[n] : undefined; };          // próxima peça no ramo escolhido
const GSA = { st: 0, k: 0 };
// gêiser só atrapalha se estiver em aviso tardio/erupção QUANDO o carro chegar lá; em repouso a IA ignora
function geyserBlocks(o, s, c) {
  const eta = Math.max(0, o.s - s) / Math.max(10, c.vf || 10);
  const g = geyserState(o.ph, G.R.t + eta, GSA);
  return g.st === 1 || (g.st === 0 && g.k > 0.7);
}
function obsHalf(t) { return t === 'geyser' ? GEY.radius : t === 'mine' ? 1.7 : t === 'spinner' ? 3.2 : t === 'oil' ? 2.3 : t === 'bumper' ? 1.45 : t === 'kicker' ? 1.6 : 1.25; }
function laneFor(c, sG) {
  const i = pieceAt(sG, c.pi, c.ai.exit), p = track[i], s = sG - pieceStart[i], ai = c.ai;
  const wob = Math.sin(G.R.t * ai.wf + ai.ph) * ai.wob;
  const er = ai.err && ai.err[i];
  if (er && er.lane !== undefined && s > 6 && s < p.len - 4) return er.lane;
  if (p.special === 'mega') {                                  // vai para a saída escolhida antes dos bumpers (s = 46)
    const t = clamp((s - 12) / 22, 0, 1), k = ai.exit === undefined ? 1 : ai.exit;
    return -MEGA.shift + (MEGA.exitV[k] + MEGA.shift) * t * t * (3 - 2 * t);
  }
  if (p.special === 'funnel') {                                // devolve o carro suavemente para o centro (lv = 0) antes da saída do funil
    const k = ai.exit === undefined ? 1 : ai.exit, t = clamp(s / MEGA.funnelLen, 0, 1), e = t * t * (3 - 2 * t);
    return MEGA.exitV[k] + (-MEGA.shift - MEGA.exitV[k]) * e;
  }
  if (p.type === 'serpentina' || p.type === 'spiralup') return wob * 0.3;
  // desvia de obstáculos próximos (ou mira no mini boost)
  let near = null;
  for (const o of obstacles) if (o.pi === i && Math.abs(o.s - s) < 7.5 && !(o.type === 'geyser' && !geyserBlocks(o, s, c))) { near = o; break; }
  if (near) {
    if (near.type === 'mboost' || (near.type === 'itembox' && !c.item)) return near.v;
    let best = 0, bm = -1e9;
    for (const cand of [-4.4, -3.2, 0, 3.2, 4.4]) {
      let m = 1e9;
      for (const o of obstacles) if (o.pi === i && Math.abs(o.s - s) < 7.5 && o.type !== 'mboost' && o.type !== 'itembox' && !(o.type === 'geyser' && !geyserBlocks(o, s, c))) m = Math.min(m, Math.abs(cand - o.v) - obsHalf(o.type) - CAR_R);
      m += cand * ai.side * 0.02 - Math.max(0, Math.abs(cand) - 3.8) * 0.8;      // sem mureta: evita colar na borda
      if (m > bm) { bm = m; best = cand; }
    }
    return best;
  }
  if (p.type === 'holes') { if (s < 14) return 3.0; if (s < 31) return -3.0; return ai.side * 3.8; }
  if (p.type === 'wind') return -p.windDir * 2.6 + wob * 0.3;
  if (p.type === 'ice') return wob * 0.3;
  if (p.type === 'bridge') return wob * 0.45;
  if (PROFILES[p.type]) return wob * 0.3;
  if (p.type === 'chicane') { if (s < 5) return 2.6; if (s < 19) return 3.0; if (s < 33) return -3.0; if (s < 47) return 3.0; return 0; }
  if (p.turn) {
    const nx = nxt(i, c);
    if (nx && (nx.type === 'bridge' || nx.type === 'holes')) return -p.turn * 2.2 + wob * 0.2;   // curva antes de peça estreita: abre e alinha
    return -p.turn * 1.3 + wob * 0.5;
  }
  if (p.type === 'boost') return wob * 0.4;
  return ai.lane + wob;
}
function speedLimitAt(c, sG) {
  const i = pieceAt(sG, c.pi, c.ai.exit), p = track[i], er = c.ai.err && c.ai.err[i];
  if (er && er.slow) return er.slow;
  let lim = 99;
  const nx = nxt(i, c);
  const n2 = nx ? nxt(track.indexOf(nx), c) : undefined, haz = t => !!t && (t.type === 'bridge' || t.type === 'holes' || t.type === 'ice' || t.type === 'wind' || t.type === 'narrow' || !!(t.def && t.def.ice));
  if (p.turn && p.def.ice) lim = 13.5 + c.ai.skill * 2;
  else if (p.turn) lim = haz(nx) ? 15 + c.ai.skill * 1.5 : haz(n2) ? 16.5 + c.ai.skill * 1.5 : 17.5 + c.ai.skill * 2.2;
  else if (p.type === 'bridge') lim = 16 + c.ai.skill * 2.5;
  else if (p.type === 'ice') lim = 15.5 + c.ai.skill * 2;
  else if (p.type === 'holes') lim = 16 + c.ai.skill * 2;
  else if (p.type === 'wind') lim = 20 + c.ai.skill * 2;
  else if (p.type === 'bumps') lim = 22;
  else if (p.type === 'minefield') lim = 13 + c.ai.skill * 2.5;
  else if (p.type === 'chicane') lim = 14 + c.ai.skill * 2;
  else if (p.type === 'serpentina') lim = 15.5 + c.ai.skill * 2;
  else if (p.type === 'spiralup') lim = 14.5 + c.ai.skill * 2;
  else if (p.special === 'funnel') lim = 17 + c.ai.skill * 2;
  else if (p.special === 'mega') lim = (c.ai.exit === 0 || c.ai.exit === 3) ? 15 + c.ai.skill * 1.5 : 18.5 + c.ai.skill * 1.5;
  if (!p.turn && nx && nx.turn && haz(n2)) lim = Math.min(lim, 18);    // reta antes de curva que antecede perigo: já alivia
  for (const o of obstacles) if (o.pi === i && o.type === 'spinner') lim = Math.min(lim, 18);
  return lim;
}
// bot decide usar o item (com pequeno atraso aleatório); o host consome o item uma única vez
export function aiWantsItem(c, dt) {
  const a = c.ai;
  if (!c.item || !c.alive || c.finished || c.voidFall || G.state !== 'race') { a.itemWait = -1; return false; }
  const fx = Math.cos(c.a), fz = Math.sin(c.a);
  let ahead = false, behind = false, active = 0;
  for (const o of cars) {
    if (o === c || !o.alive || o.finished || o.voidFall) continue;
    const ox = o.owned ? o.x : (o.cpx ?? o.x), oz = o.owned ? o.z : (o.cpz ?? o.z);
    const dx = ox - c.x, dz = oz - c.z, along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
    if (!(o.immuneT > 0)) active++;
    if (along > 4 && along < 55 && Math.abs(lat) < 3.2) ahead = true;
    if (along < -3 && along > -22 && Math.abs(lat) < 4) behind = true;
  }
  const behindMe = cars.some(o => o !== c && o.alive && !o.finished && !o.voidFall && o.prog > c.prog + 3);
  const want = c.item === 'frost' ? ahead : c.item === 'peel' ? behind && c.grounded
    : c.item === 'swap' ? behindMe                                  // quem tem alguém à frente troca de lugar
    : c.item === 'skip' ? c.grounded && c.prog < finishGlobal - 120   // atalho só com bastante pista pela frente
    : c.item === 'wings' ? c.grounded
    : c.item === 'shield' ? (c.threatT || 0) > 0                      // projétil teleguiado vindo: ergue o escudo
    : c.item === 'storm' ? behindMe && active > 0 : active > 0;
  if (!want) { a.itemWait = -1; return false; }
  if (a.itemWait === undefined || a.itemWait < 0) a.itemWait = 0.5 + Math.random() * 1.8;
  a.itemWait -= dt;
  return a.itemWait <= 0;
}
export function aiDrive(c, dt, inp) {
  inp.jump = false;
  if (!c.alive || c.voidFall) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.drift = false; return; }
  const v = Math.max(0, c.vf), sG = c.prog;
  let look = 5 + v * 0.3;
  // sem muro (ponte/buracos): não mira na curva seguinte antes de sair da peça (senão corta pelo abismo)
  const Pc = track[c.pi];
  if (Pc && (Pc.type === 'bridge' || Pc.type === 'holes')) look = Math.min(look, Math.max(3, Pc.len - (sG - pieceStart[c.pi]) + 1.5));
  const Pn = nxt(c.pi, c);
  if (Pc && Pc.turn && Pn && (Pn.type === 'bridge' || Pn.type === 'holes')) look = Math.min(look, 6.5);
  // sem muretas: perto da borda e indo para fora (e sem "erro" sorteado nesta peça), mira o centro da pista
  let lane = laneFor(c, sG + look);
  const Q = c.Q, planned = c.ai.err && c.ai.err[c.pi];
  if (c.grounded && Q && Q.hw && !planned && Math.abs(Q.v) > Q.hw - 1.5 && (c.vx * Q.rx + c.vz * Q.rz) * Math.sign(Q.v) > 0) lane = 0;
  trackPoint(sG + look, lane, tmpA, c.pi, c.ai.exit);
  const err = wrapA(Math.atan2(tmpA.z - c.z, tmpA.x - c.x) - c.a);
  const slick = Pc && (Pc.type === 'ice' || Pc.type === 'wind' || Pc.def.ice);
  inp.steer = clamp(err * (slick ? 1.6 : 2.4), -1, 1);                       // gelo/vento: menos esterço brusco
  let target = PH.maxSpeed;
  for (let d = 0; d <= 20; d += 4) { const lim = speedLimitAt(c, sG + d + 2); target = Math.min(target, Math.sqrt(lim * lim + 2 * 32 * d)); }
  if (c.finished) target = 0;
  inp.drift = false;
  if (v < target - 0.5) { inp.throttle = 1; inp.brake = 0; }
  else if (v > target + 1.5) { inp.throttle = 0; inp.brake = 1; }
  else { inp.throttle = 0.5; inp.brake = 0; }
  // guarda de borda forte (sem muretas): muito perto da borda e indo para fora -> tira o pé e contra-esterça ao máximo
  if (c.grounded && Q && Q.hw && !planned && Math.abs(Q.v) > Q.hw - 0.9 && (c.vx * Q.rx + c.vz * Q.rz) * Math.sign(Q.v) > 0) {
    trackPoint(sG + look, 0, tmpA, c.pi, c.ai.exit);
    inp.steer = clamp(wrapA(Math.atan2(tmpA.z - c.z, tmpA.x - c.x) - c.a) * 5, -1, 1);
    inp.throttle = 0.25; inp.brake = 0; inp.drift = false;
  }
  if (!c.finished && c.grounded && !c.voidFall && v < 1.5 && G.state === 'race') { c.stuckT += dt; if (c.stuckT > 1.8) respawn(c); } else c.stuckT = 0;
}
