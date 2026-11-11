// Física arcade dos carros: passo, contato com pista/mureta, obstáculos e colisões.
import { G, hooks } from './state.js';
import { clamp, lerp, rnd, wrapA } from './utils.js';
import { BARRIERS, CAR_R, DRIFT, FINISH_S, GRAV, PAD, PH, POWER, profileSeg, RAMP_PADS, WALL_H, WIND_ACC } from './config.js';
import { SFX } from './audio.js';
import { burst } from './fx.js';
import { obstacles, pieceStart, tmpW, track } from './track.js';
import { cars, isHost } from './cars.js';
import { toast } from './hud.js';

// ------------------------------------------------------------ física
G.shake = 0;
export function giveBoost(c, pow, dur, kick) {
  if (c.boostT > 0) { c.boostPow = Math.max(c.boostPow, pow); c.boostT = Math.max(c.boostT, dur); }
  else { c.boostPow = pow; c.boostT = dur; }
  c.boostMax = Math.max(c.boostT, 0.01);
  c.vx += Math.cos(c.a) * kick; c.vz += Math.sin(c.a) * kick;
}
function endDrift(c, release) {
  const lvl = c.driftLevel;
  c.drifting = false; c.driftT = 0; c.driftLevel = 0;
  if (release && lvl > 0) {
    giveBoost(c, DRIFT.pow[lvl - 1], DRIFT.dur[lvl - 1], DRIFT.kick[lvl - 1]);
    if (c.isLocal) {
      SFX.boost(lvl); toast(DRIFT.name[lvl - 1], DRIFT.css[lvl - 1], 0.9);
      G.shake = Math.max(G.shake, lvl >= 3 ? 0.5 : lvl * 0.15);
      const [r, g, b] = DRIFT.col[lvl - 1];
      burst(c.x - Math.cos(c.a) * 1.5, c.y + 0.4, c.z - Math.sin(c.a) * 1.5, 14 + lvl * 8, r, g, b, 7, 0.45, 6);
    }
  }
}
export function respawn(c) {
  const P0 = track[c.pi];
  const s = clamp(c.Q.s || 2, 2, P0.len - 2);
  P0.world(s, 0, tmpW);
  c.x = tmpW.x; c.z = tmpW.z; c.a = tmpW.a; c.y = P0.query(c.x, c.z, c.Q).h;
  c.vx = Math.cos(c.a) * 6; c.vz = Math.sin(c.a) * 6; c.vy = 0; c.grounded = true;
  c.drifting = false; c.driftT = 0; c.driftLevel = 0; c.kick = 0; c.steer = 0; c.stuckT = 0; c.voidFall = false;
  if (c.isLocal) toast('REPOSICIONADO', '#fff', 0.8);
}
function pushOut(c, nx, nz, over, dt, bounce = 0.35) {
  c.x += nx * over; c.z += nz * over;
  const vn = c.vx * nx + c.vz * nz;
  if (vn < 0) {
    const imp = -vn;
    c.vx -= nx * vn * (1 + bounce); c.vz -= nz * vn * (1 + bounce);
    const loss = 1 - clamp(imp / 60, 0, 0.16); c.vx *= loss; c.vz *= loss;
    const tx = -nz, tz = nx, fwd = (c.vx * tx + c.vz * tz) >= 0;
    const ta = Math.atan2(fwd ? tz : -tz, fwd ? tx : -tx);
    c.a += wrapA(ta - c.a) * clamp(dt * 5 + imp / 90, 0, 0.35);
    if (imp > 5) {
      if (c.drifting) { c.drifting = false; c.driftT = 0; c.driftLevel = 0; }
      if (c.hitCool <= 0) {
        c.hitCool = 0.25;
        burst(c.x - nx * CAR_R, c.y + 0.4, c.z - nz * CAR_R, 10, 1, 0.88, 0.4, 6, 0.4, 12);
        if (c.isLocal) { SFX.thump(imp); G.shake = Math.max(G.shake, clamp(imp / 30, 0.1, 0.45)); }
      }
    }
    return imp;
  }
  c.vx *= (1 - 0.5 * dt); c.vz *= (1 - 0.5 * dt);
  if (c.drifting) c.driftT = Math.max(0, c.driftT - dt * 1.5);
  return 0;
}
// queda livre (voidFall): só gravidade + inércia. Nada reposiciona, empurra ou captura o carro; morre abaixo de y = -20.
function freeFall(c, dt) {
  c.grounded = false;
  c.vy -= GRAV * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.airT += dt;
  c.tumbleX += dt * 3.1; c.tumbleZ += dt * 2.3;
  if (c.y < -20 && c.alive) {
    c.alive = false; c.fallProg = c.prog;
    if (c.isLocal) { SFX.fall(); toast('CAIU NO ABISMO!', '#ff2e55', 2); G.R.spectateT = 1.6; }
  }
}
const NO_INP = { steer: 0, throttle: 0, brake: 0, drift: false, gasRaw: false };
const SCR = { steer: 0, throttle: 0, brake: 0, drift: false, gasRaw: false };
export function stepCar(c, inp, dt) {
  if (c.voidFall) { freeFall(c, dt); return; }
  if (!c.alive) { c.vy -= GRAV * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.tumbleX += dt * 3.1; c.tumbleZ += dt * 2.3; return; }
  // efeitos de item: congelado/atordoado ignoram o controle; casca bloqueia o drift; congelamento deixa lento e com pouca direção
  if (c.freezeT > 0 || c.stunT > 0) inp = NO_INP;
  else if (c.spinT > 0 && inp.drift) { SCR.steer = inp.steer; SCR.throttle = inp.throttle; SCR.brake = inp.brake; SCR.drift = false; inp = SCR; }
  const slowed = c.slowT > 0;
  const air = !c.grounded;
  const tgt = inp.steer * (slowed ? POWER.frost.steerMul : 1);
  const rate = (tgt === 0 || (c.steer !== 0 && Math.sign(tgt) !== Math.sign(c.steer))) ? 14 : 9;
  c.steer += clamp(tgt - c.steer, -rate * dt, rate * dt);
  let fx = Math.cos(c.a), fz = Math.sin(c.a);
  let vf = c.vx * fx + c.vz * fz;
  if (!air && inp.drift && !c.drifting && vf > DRIFT.minSpeed && Math.abs(inp.steer) > 0.2) {
    c.drifting = true; c.driftDir = Math.sign(inp.steer); c.driftT = 0; c.driftLevel = 0; c.kick = c.driftDir * 3.0; c.hop = 0.16;
    if (c.isLocal) SFX.hop();
  }
  if (c.drifting) {
    if (!inp.drift) endDrift(c, true);
    else if (vf < DRIFT.stopSpeed) endDrift(c, false);
    else if (!air) {
      c.driftT += dt;
      const lvl = c.driftT >= DRIFT.T[2] ? 3 : c.driftT >= DRIFT.T[1] ? 2 : c.driftT >= DRIFT.T[0] ? 1 : 0;
      if (lvl > c.driftLevel) { c.driftLevel = lvl; if (c.isLocal) SFX.level(lvl); }
    }
  }
  let st = c.steer;
  if (c.drifting) st = clamp(c.driftDir * 0.75 + c.steer * 0.45, -1.1, 1.1);
  const av = Math.abs(vf);
  const sf = clamp(av / 5, 0, 1) * (1 - 0.3 * clamp((av - 14) / 18, 0, 1));
  const turn = PH.turn * sf * (c.drifting ? 1.32 : 1) * (air ? PH.airTurn : 1);
  c.a += (st * turn * (vf >= -0.3 ? 1 : -1) + c.kick) * dt;
  if (c.spinT > 0) {
    c.a += c.spinDir * POWER.peel.spinRate * clamp(c.spinT, 0, 1) * dt;
    c.oilT = Math.max(c.oilT || 0, 0.2);                                  // grip baixo enquanto gira
    if (c.drifting) { c.drifting = false; c.driftT = 0; c.driftLevel = 0; }
  }
  c.kick *= Math.exp(-10 * dt); c.hop = Math.max(0, c.hop - dt);
  fx = Math.cos(c.a); fz = Math.sin(c.a);
  vf = c.vx * fx + c.vz * fz;
  let vl = -c.vx * fz + c.vz * fx;
  const boosting = c.boostT > 0;
  const vmax = PH.maxSpeed * (1 + (boosting ? c.boostPow : 0)) * (c.maxMul || 1) * (slowed ? POWER.frost.slowMul : 1);
  c.braking = false;
  c.oilT = Math.max(0, (c.oilT || 0) - dt);
  if (!air) {
    if (inp.throttle > 0 && vf >= -1) {
      const r = clamp(vf / vmax, 0, 1.2);
      let acc = PH.accel * Math.max(0, 1 - r * r) * inp.throttle;
      if (boosting) acc += PH.boostAccel * c.boostPow;
      if (vf < vmax) vf = Math.min(vmax, vf + acc * dt);
    } else if (inp.throttle > 0) vf += PH.brake * dt;
    else if (inp.brake > 0) {
      if (vf > 0.7) { vf -= PH.brake * dt; c.braking = true; }
      else vf = Math.max(-PH.maxRev, vf - PH.revAccel * dt);
    } else {
      const dec = (PH.coast + PH.coastK * Math.abs(vf)) * dt;
      vf = Math.abs(vf) <= dec ? 0 : vf - Math.sign(vf) * dec;
    }
    if (vf > vmax) vf -= (vf - vmax) * PH.overDecay * dt;
    const onIce = c.Q && c.Q.ice;
    const gT = c.oilT > 0 ? PH.gripOil : onIce ? (c.drifting ? 1.8 : 2.6) : c.drifting ? PH.gripDrift : PH.grip;
    c.grip += (gT - c.grip) * Math.min(1, dt * 9);
    const vl2 = vl * Math.exp(-c.grip * dt);
    const keep = c.drifting ? 0.55 : 0.85;
    const cons = Math.sign(vf) * Math.sqrt(Math.max(0, vf * vf + vl * vl - vl2 * vl2));
    vf = lerp(vf, cons, keep); vl = vl2;
    if (c.drifting) vf -= vf * 0.10 * dt;
  } else { vf -= vf * 0.04 * dt; vl *= Math.exp(-0.5 * dt); }
  if (c.boostT > 0) { c.boostT -= dt; if (c.boostT <= 0) { c.boostT = 0; c.boostPow = 0; } }
  if (c.freezeT > 0) { vf *= Math.exp(-4.5 * dt); vl *= Math.exp(-4 * dt); }        // congelado: freia sozinho (sem teleporte)
  else if (c.stunT > 0) { vf *= Math.exp(-2.2 * dt); vl *= Math.exp(-3 * dt); }
  c.vx = fx * vf - fz * vl; c.vz = fz * vf + fx * vl; c.vf = vf; c.vl = vl;
  if (c.Q && c.Q.wind) { c.vx += c.Q.rx * c.Q.wind * WIND_ACC * dt; c.vz += c.Q.rz * c.Q.wind * WIND_ACC * dt; }   // vento lateral
  c.kickCool = (c.kickCool || 0) - dt;
  c.x += c.vx * dt; c.z += c.vz * dt;
  trackContact(c, dt);
}
export function obsClock() { return G.R && G.state === 'race' ? G.R.t : G.clockT; }
// pistão: sobe e desce em ciclo (determinístico pelo relógio da corrida)
export function pistonLift(o, tc) { return clamp((Math.sin(tc * Math.abs(o.spd) * 1.2 + o.ph) + 0.15) * 2.2, 0, 1); }
function obstacleContact(c, dt) {
  const tc = obsClock();
  for (const o of obstacles) {
    const dx = c.x - o.x, dz = c.z - o.z;
    if (dx * dx + dz * dz > 64) continue;
    if (c.y > o.y + 2.8 || c.y < o.y - 0.9) continue;
    const ca = Math.cos(o.a), sa = Math.sin(o.a);
    if (o.type === 'block') {
      const u = dx * ca + dz * sa, w = -dx * sa + dz * ca;
      const cu = clamp(u, -1.2, 1.2), cw = clamp(w, -1.2, 1.2);
      let eu = u - cu, ew = w - cw, d = Math.hypot(eu, ew);
      if (d >= CAR_R) continue;
      if (d < 1e-4) { if (Math.abs(u) > Math.abs(w)) { eu = Math.sign(u) || 1; ew = 0; } else { eu = 0; ew = Math.sign(w) || 1; } } else { eu /= d; ew /= d; }
      pushOut(c, eu * ca - ew * sa, eu * sa + ew * ca, CAR_R - d, dt);
    } else if (o.type === 'bumper') {
      const d = Math.hypot(dx, dz), R0 = 1.4 + CAR_R;
      if (d >= R0 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      pushOut(c, nx, nz, R0 - d, dt, 1.1);
      c.vx += nx * 9; c.vz += nz * 9; o.pulse = 0.3;
      if (c.grounded) { c.grounded = false; c.vy = 3.5; }
      if (c.isLocal) { SFX.boing(); G.shake = Math.max(G.shake, 0.3); }
      burst(o.x + nx * 1.4, o.y + 1, o.z + nz * 1.4, 12, 1, 0.3, 0.6, 7, 0.4, 8);
    } else if (o.type === 'spinner') {
      const ang = o.a + o.ph + tc * o.spd, bx = Math.cos(ang), bz = Math.sin(ang);
      const t = clamp(dx * bx + dz * bz, -3.0, 3.0);
      const px = dx - bx * t, pz = dz - bz * t, d = Math.hypot(px, pz), R0 = 0.3 + CAR_R;
      if (d < R0 && d > 1e-4) {
        const nx = px / d, nz = pz / d;
        pushOut(c, nx, nz, R0 - d, dt, 0.6);
        const tv = o.spd * t;                                     // velocidade da barra no ponto de contato
        c.vx += (-bz * tv) * 0.8 + nx * 5; c.vz += (bx * tv) * 0.8 + nz * 5;
        if (c.isLocal && c.hitCool <= 0) { SFX.thump(12); G.shake = Math.max(G.shake, 0.35); c.hitCool = 0.2; }
      }
      const dp = Math.hypot(dx, dz), RP = 0.6 + CAR_R;
      if (dp < RP && dp > 1e-4) pushOut(c, dx / dp, dz / dp, RP - dp, dt);
    } else if (o.type === 'oil') {
      if (c.grounded && dx * dx + dz * dz < 2.3 * 2.3) {
        if (c.oilT <= 0.05) { c.kick += (Math.random() < 0.5 ? -1 : 1) * rnd(1.5, 2.8); if (c.drifting) endDrift(c, false); if (c.isLocal) { SFX.splat(); toast('ÓLEO!', '#9a7cff', 0.7); } }
        c.oilT = 0.9;
      }
    } else if (o.type === 'mboost') {
      const u = dx * ca + dz * sa, w = -dx * sa + dz * ca;
      if (c.grounded && Math.abs(u) < 1.7 && Math.abs(w) < 1.7 && c.padCool <= 0) {
        giveBoost(c, PAD.pow * 0.8, 0.8, 3); c.padCool = 0.6;
        if (c.isLocal) { SFX.pad(); toast('BOOST!', '#a6ff3b', 0.6); }
      }
    } else if (o.type === 'kicker') {
      const u = dx * ca + dz * sa, w = -dx * sa + dz * ca;
      const along = c.vx * ca + c.vz * sa;
      if (c.grounded && Math.abs(w) < 1.6 && u > -1.3 && u < 1.3 && along > 4 && (c.kickCool || 0) <= 0) {
        c.grounded = false; c.vy = Math.max(c.vy, 5 + along * 0.16); c.kickCool = 0.5; c.airT = 0;
        if (c.isLocal) { SFX.jump(); toast('HOP!', '#ff9a1f', 0.6); }
      }
    } else if (o.type === 'piston') {
      const lift = pistonLift(o, tc);
      if (lift < 0.35 || c.y > o.y + 2.4 * lift + 0.2) continue;   // abaixado: dá pra passar por cima
      const u = dx * ca + dz * sa, w = -dx * sa + dz * ca;
      const cu = clamp(u, -1.1, 1.1), cw = clamp(w, -1.1, 1.1);
      let eu = u - cu, ew = w - cw, d = Math.hypot(eu, ew);
      if (d >= CAR_R) continue;
      if (d < 1e-4) { if (Math.abs(u) > Math.abs(w)) { eu = Math.sign(u) || 1; ew = 0; } else { eu = 0; ew = Math.sign(w) || 1; } } else { eu /= d; ew /= d; }
      pushOut(c, eu * ca - ew * sa, eu * sa + ew * ca, CAR_R - d, dt, 0.5);
      if (c.grounded && lift < 0.9) { c.grounded = false; c.vy = Math.max(c.vy, 6); }    // subindo: arremessa pra cima
    }
  }
}
// caixa fixa no frame da peça (centro cs,cv; meia-extensão hs,hv): empurra o carro para fora
function boxPushLocal(c, Q, cs, cv, hs, hv, dt) {
  const ds = Q.s - cs, dv = Q.v - cv;
  let es = ds - clamp(ds, -hs, hs), ev = dv - clamp(dv, -hv, hv), d = Math.hypot(es, ev);
  if (d >= CAR_R) return;
  if (d < 1e-4) { if (Math.abs(ds) / hs > Math.abs(dv) / hv) { es = Math.sign(ds) || 1; ev = 0; } else { es = 0; ev = Math.sign(dv) || 1; } } else { es /= d; ev /= d; }
  pushOut(c, Q.fx * es + Q.rx * ev, Q.fz * es + Q.rz * ev, CAR_R - d, dt);
}
export function trackContact(c, dt) {
  let Pc = track[c.pi], Q = c.Q;
  Pc.query(c.x, c.z, Q);
  // troca de peça só com o carro lateralmente sobre a pista: fora da borda, nenhuma outra peça "captura" o carro
  for (let k = 0; k < 3; k++) {
    if (c.voidFall || Math.abs(Q.v) > Q.hw + 0.25) break;
    if (Q.s > Pc.len && c.pi < track.length - 1) { c.pi++; Pc = track[c.pi]; Pc.query(c.x, c.z, Q); }
    else if (Q.s < 0 && c.pi > 0) { c.pi--; Pc = track[c.pi]; Pc.query(c.x, c.z, Q); }
    else break;
  }
  if (c.grounded) {
    if (Q.floor && Math.abs(c.y - Q.h) < 0.8) {
      const along = c.vx * Q.fx + c.vz * Q.fz, vg = along * Q.slope;
      if (c.vy > 1 && vg < c.vy - GRAV * dt * 1.5) { c.grounded = false; c.airT = 0; }   // passou da crista rápido: decola (lombadas)
      else { c.y = Q.h; c.vy = vg; }
    } else {
      c.grounded = false; c.airT = 0;
      const sg = profileSeg(Pc.type, Q.s);
      if (c.isLocal && sg && sg[2] === 'gap' && Math.abs(Q.v) <= Q.hw) { SFX.jump(); toast(Pc.type === 'bigjump' ? 'MEGA VOOOO!' : 'VOOOA!', '#ffd23f', 0.9); }
    }
  }
  if (!c.grounded) {
    const prevY = c.y;
    c.vy -= GRAV * dt; c.y += c.vy * dt; c.airT += dt;
    // só pousa atravessando a superfície DE CIMA PARA BAIXO (prevY acima do piso, com folga mínima pela inclinação).
    // Quem já estava abaixo do piso nunca é "pescado" de volta: vira queda livre (voidFall) e ninguém mais o captura.
    const tol = 0.15 + Math.abs(Q.slope) * Math.hypot(c.vx, c.vz) * dt;
    if (Q.floor && c.vy <= 0 && prevY >= Q.h - tol && c.y <= Q.h) {
      const impact = -c.vy;
      c.y = Q.h; c.vy = 0; c.grounded = true; c.squash = 0.22;
      if (impact > 6) {
        burst(c.x, c.y + 0.2, c.z, 12, 0.7, 0.8, 1, 5, 0.4, 8);
        if (c.isLocal) { SFX.land(impact); G.shake = Math.max(G.shake, clamp(impact / 40, 0.1, 0.4)); }
      }
    } else if (c.y < Q.h - tol && c.vy <= 0) {
      c.voidFall = true; c.drifting = false; c.driftT = 0; c.driftLevel = 0; c.boostT = 0; c.boostPow = 0;
      c.s = Q.s; c.v = Q.v; c.prog = pieceStart[c.pi] + clamp(Q.s, 0, Pc.len);
      return;
    }
  }
  // mureta unilateral: só empurra de dentro para fora, na faixa entre o limite interno e o centro da parede.
  // Se o centro do carro já passou do limite externo (pulou ou saiu pela borda), cai livre — sem teleporte.
  const inner = Q.hw - CAR_R, outer = Q.hw + 0.25;
  if (c.y > Q.h - 0.7 && c.y < Q.h + WALL_H + 0.25) {
    if (Q.wallR && Q.v > inner && Q.v <= outer) pushOut(c, -Q.rx, -Q.rz, Q.v - inner, dt);
    else if (Q.wallL && Q.v < -inner && Q.v >= -outer) pushOut(c, Q.rx, Q.rz, -inner - Q.v, dt);
    if (Math.abs(Q.v) <= outer) {
      if (Pc.type === 'start' && Q.s < CAR_R + 0.6) pushOut(c, Q.fx, Q.fz, CAR_R + 0.6 - Q.s, dt);
      if (Pc.type === 'finish' && Q.s > Pc.len - 0.8 - CAR_R) pushOut(c, -Q.fx, -Q.fz, Q.s - (Pc.len - 0.8 - CAR_R), dt);
    }
  }
  if (Pc.type === 'chicane' && c.y > Q.h - 0.5 && c.y < Q.h + 1.5) for (const b of BARRIERS) boxPushLocal(c, Q, b.s, (b.v0 + b.v1) / 2, 0.6, (b.v1 - b.v0) / 2, dt);
  obstacleContact(c, dt);
  c.padCool -= dt; c.hitCool -= dt;
  if (Pc.type === 'boost' && c.grounded && c.padCool <= 0 && Q.s > PAD.s0 && Q.s < PAD.s1 && Math.abs(Q.v) < PAD.hv) {
    giveBoost(c, PAD.pow, PAD.dur, PAD.kick); c.padCool = 0.6;
    if (c.isLocal) { SFX.pad(); toast('BOOST!', '#a6ff3b', 0.6); G.shake = Math.max(G.shake, 0.15); }
  }
  const RP = RAMP_PADS[Pc.type];
  if (RP && c.grounded && c.padCool <= 0 && Q.s > RP[0] && Q.s < RP[1] && Math.abs(Q.v) < PAD.hv) {
    giveBoost(c, 0.5, 1.3, 5); c.padCool = 0.8;
    if (c.isLocal) { SFX.boost(2); toast('MEGA TURBO!', '#ff2e88', 0.8); G.shake = Math.max(G.shake, 0.25); }
  }
  if (Pc.type === 'finish' && Q.s >= FINISH_S && !c.finished && c.pi === track.length - 1 && c.alive && !c.voidFall) {
    c.finished = true; c.finishT = G.R.t;
    burst(c.x, c.y + 1, c.z, 30, 1, 0.85, 0.3, 9, 0.8, 8);
    if (isHost()) hooks.hostRegisterFinish(c);
    if (c.isLocal) { SFX.finish(true); if (!isHost()) toast('CHEGADA!', '#ffd23f', 1.2); }
  }
  c.s = Q.s; c.v = Q.v;
  c.prog = pieceStart[c.pi] + clamp(Q.s, 0, Pc.len);
  if (c.y < -20 && c.alive) {
    c.alive = false; c.fallProg = c.prog;
    if (c.isLocal) { SFX.fall(); toast('CAIU NO ABISMO!', '#ff2e55', 2); G.R.spectateT = 1.6; }
  }
}
export function carCollisions() {
  const D = CAR_R * 2, D2 = D * D;
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (!a.owned && !b.owned) continue;
    if (!a.alive || !b.alive || a.voidFall || b.voidFall || Math.abs(a.y - b.y) > 1.4) continue;
    // carro remoto colide pela posição "presente" (extrapolada), não pela desenhada (atrasada)
    const ax = a.owned ? a.x : (a.cpx ?? a.x), az = a.owned ? a.z : (a.cpz ?? a.z);
    const bx = b.owned ? b.x : (b.cpx ?? b.x), bz = b.owned ? b.z : (b.cpz ?? b.z);
    const dx = bx - ax, dz = bz - az, d2 = dx * dx + dz * dz;
    if (d2 >= D2 || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, ov = D - d;
    // cada lado resolve só o próprio carro (no multiplayer o outro jogador resolve o dele)
    if (a.owned) { a.x -= nx * ov * 0.5; a.z -= nz * ov * 0.5; }
    if (b.owned) { b.x += nx * ov * 0.5; b.z += nz * ov * 0.5; }
    const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (rel > 0) {
      const imp = rel * (1 + 0.6) / 2;
      if (a.owned) { a.vx -= nx * imp; a.vz -= nz * imp; }
      if (b.owned) { b.vx += nx * imp; b.vz += nz * imp; }
      if (rel > 9) for (const c of [a, b]) if (c.owned && c.grounded) { c.grounded = false; c.vy = 3.2; }
      if (rel > 4 && (a.hitCool || 0) <= 0 && (b.hitCool || 0) <= 0) {
        if (a.owned) a.hitCool = 0.25;
        if (b.owned) b.hitCool = 0.25;
        burst((a.x + b.x) / 2, a.y + 0.5, (a.z + b.z) / 2, 8, 1, 1, 1, 6, 0.35, 10);
        if (a.isLocal || b.isLocal) { SFX.thump(rel); G.shake = Math.max(G.shake, clamp(rel / 30, 0.1, 0.4)); }
      }
    }
  }
}
