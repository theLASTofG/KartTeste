// IA dos bots.
import { G } from './state.js';
import { clamp, wrapA } from './utils.js';
import { CAR_R, PH, PROFILES } from './config.js';
import { obstacles, pieceAt, pieceStart, track, trackPoint } from './track.js';
import { respawn } from './physics.js';

// ------------------------------------------------------------------- IA
const tmpA = {};
function obsHalf(t) { return t === 'spinner' ? 3.2 : t === 'oil' ? 2.3 : t === 'bumper' ? 1.45 : t === 'kicker' ? 1.6 : 1.25; }
function laneFor(c, sG) {
  const i = pieceAt(sG), p = track[i], s = sG - pieceStart[i], ai = c.ai;
  const wob = Math.sin(G.R.t * ai.wf + ai.ph) * ai.wob;
  const er = ai.err && ai.err[i];
  if (er && er.lane !== undefined && s > 6 && s < p.len - 4) return er.lane;
  // desvia de obstáculos próximos (ou mira no mini boost)
  let near = null;
  for (const o of obstacles) if (o.pi === i && Math.abs(o.s - s) < 7.5) { near = o; break; }
  if (near) {
    if (near.type === 'mboost') return near.v;
    let best = 0, bm = -1e9;
    for (const cand of [-4.1, -2.7, 0, 2.7, 4.1]) {
      let m = 1e9;
      for (const o of obstacles) if (o.pi === i && Math.abs(o.s - s) < 7.5 && o.type !== 'mboost') m = Math.min(m, Math.abs(cand - o.v) - obsHalf(o.type) - CAR_R);
      m += cand * ai.side * 0.02;
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
    const nx = track[i + 1];
    if (nx && (nx.type === 'bridge' || nx.type === 'holes')) return -p.turn * 2.2 + wob * 0.2;   // curva antes de peça estreita: abre e alinha
    return -p.turn * 1.3 + wob * 0.5;
  }
  if (p.type === 'boost') return wob * 0.4;
  return ai.lane + wob;
}
function speedLimitAt(c, sG) {
  const i = pieceAt(sG), p = track[i], er = c.ai.err && c.ai.err[i];
  if (er && er.slow) return er.slow;
  let lim = 99;
  const nx = track[i + 1];
  if (p.turn) lim = (nx && (nx.type === 'bridge' || nx.type === 'holes')) ? 15.5 + c.ai.skill * 1.5 : 17.5 + c.ai.skill * 2.2;
  else if (p.type === 'bridge') lim = 16 + c.ai.skill * 2.5;
  else if (p.type === 'ice') lim = 15.5 + c.ai.skill * 2;
  else if (p.type === 'holes') lim = 16 + c.ai.skill * 2;
  else if (p.type === 'wind') lim = 20 + c.ai.skill * 2;
  else if (p.type === 'bumps') lim = 22;
  else if (p.type === 'chicane') lim = 14 + c.ai.skill * 2;
  for (const o of obstacles) if (o.pi === i && o.type === 'spinner') lim = Math.min(lim, 18);
  return lim;
}
export function aiDrive(c, dt, inp) {
  if (!c.alive || c.voidFall) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.drift = false; return; }
  const v = Math.max(0, c.vf), sG = c.prog;
  let look = 5 + v * 0.3;
  // sem muro (ponte/buracos): não mira na curva seguinte antes de sair da peça (senão corta pelo abismo)
  const Pc = track[c.pi];
  if (Pc && (Pc.type === 'bridge' || Pc.type === 'holes')) look = Math.min(look, Math.max(3, Pc.len - (sG - pieceStart[c.pi]) + 1.5));
  const Pn = track[c.pi + 1];
  if (Pc && Pc.turn && Pn && (Pn.type === 'bridge' || Pn.type === 'holes')) look = Math.min(look, 6.5);
  // sem muretas: perto da borda e indo para fora (e sem "erro" sorteado nesta peça), mira o centro da pista
  let lane = laneFor(c, sG + look);
  const Q = c.Q, planned = c.ai.err && c.ai.err[c.pi];
  if (c.grounded && Q && Q.hw && !planned && Math.abs(Q.v) > Q.hw - 1.5 && (c.vx * Q.rx + c.vz * Q.rz) * Math.sign(Q.v) > 0) lane = 0;
  trackPoint(sG + look, lane, tmpA);
  const err = wrapA(Math.atan2(tmpA.z - c.z, tmpA.x - c.x) - c.a);
  inp.steer = clamp(err * 2.4, -1, 1);
  let target = PH.maxSpeed;
  for (let d = 0; d <= 20; d += 4) { const lim = speedLimitAt(c, sG + d + 2); target = Math.min(target, Math.sqrt(lim * lim + 2 * 32 * d)); }
  if (c.finished) target = 0;
  inp.drift = false;
  if (v < target - 0.5) { inp.throttle = 1; inp.brake = 0; }
  else if (v > target + 1.5) { inp.throttle = 0; inp.brake = 1; }
  else { inp.throttle = 0.5; inp.brake = 0; }
  if (!c.finished && c.grounded && !c.voidFall && v < 1.5 && G.state === 'race') { c.stuckT += dt; if (c.stuckT > 1.8) respawn(c); } else c.stuckT = 0;
}
