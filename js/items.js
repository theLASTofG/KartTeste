// Itens de corrida: Caixa de Poder, inventário (1 item por carro) e 3 poderes originais.
// O HOST é a autoridade: sorteia, valida coleta/uso, move projéteis, detecta acertos e aplica efeitos.
// Clientes só SOLICITAM (item_pickup / item_use) e espelham o que o host confirma (item_granted, item_state,
// item_spawn, item_despawn, item_effect). Nenhum item escreve x/y/z de um carro: só timers, velocidade e giro.
import * as THREE from 'three';
import { G } from './state.js';
import { CAR_R, POWER } from './config.js';
import { SFX } from './audio.js';
import { scene, texGlow } from './scene.js';
import { burst } from './fx.js';
import { obstacles, track } from './track.js';
import { carById, cars, isHost, myCar, NET } from './cars.js';
import { toast } from './hud.js';
import { broadcast, toHost } from './net.js';
import { aiWantsItem } from './ai.js';

// box: key -> (host) s restantes | (cliente) true; objs: id -> projétil/casca; seen: eventos de uso já processados
export const IT = { box: {}, objs: new Map(), seen: new Set(), seq: 0, uid: 0, useLock: 0 };
const QQ = {};

// ------------------------------------------------------------------ util
const carPos = c => c.owned ? c : { x: c.cpx ?? c.x, z: c.cpz ?? c.z };
const canRace = c => !!c && c.alive && !c.finished && !c.voidFall;
function rollItem() {
  const keys = Object.keys(POWER.types);
  let r = Math.random() * keys.reduce((s, k) => s + POWER.types[k].w, 0);
  for (const k of keys) { r -= POWER.types[k].w; if (r <= 0) return k; }
  return keys[0];
}
export function resetCarItems(c) {
  c.item = null; c.itemReadyAt = 0; c.itemRollEnd = 0; c.itemCool = 0; c.pickCool = 0;
  c.freezeT = 0; c.slowT = 0; c.stunT = 0; c.spinT = 0; c.spinDir = 1; c.immuneT = 0;
}
// limpa TUDO (fim de rodada, nova rodada, sair da sala, host encerrando, desconexão definitiva)
export function resetItems() {
  for (const o of IT.objs.values()) scene.remove(o.mesh);
  IT.objs.clear(); IT.box = {}; IT.seen.clear(); IT.useLock = 0;
  for (const c of cars) resetCarItems(c);
  for (const o of obstacles) if (o.type === 'itembox') o.group.visible = true;
}

// ------------------------------------------------------- malhas (neon originais)
const matFrost = new THREE.MeshBasicMaterial({ color: 0x7df3ff });
const matPeel = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x6a4a00 });
const matDot = new THREE.MeshBasicMaterial({ color: 0xff2e88 });
function makeMesh(k) {
  const g = new THREE.Group();
  if (k === 'frost') {
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), matFrost));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: 0x4df3ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.scale.set(4.2, 4.2, 1); g.add(sp);
  } else {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.28, 16), matPeel); d.position.y = 0.14; g.add(d);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), matDot); dot.position.y = 0.45; g.add(dot);
  }
  scene.add(g); return g;
}
function spawnObj(m) {
  if (IT.objs.has(m.id)) return;
  const o = { id: m.id, k: m.k, owner: m.owner, x: m.x, y: m.y, z: m.z, a: m.a, sp: m.sp, ttl: m.ttl, pi: m.pi, age: 0, mesh: makeMesh(m.k) };
  o.mesh.position.set(o.x, o.y, o.z); IT.objs.set(o.id, o);
}
function despawnObj(id, hit) {
  const o = IT.objs.get(id); if (!o) return;
  if (hit !== undefined && hit !== null) burst(o.x, o.y + 0.4, o.z, 14, 1, 1, 1, 7, 0.4, 6);
  scene.remove(o.mesh); IT.objs.delete(id);
}
const objInfo = o => ({ id: o.id, k: o.k, owner: o.owner, x: +o.x.toFixed(2), y: +o.y.toFixed(2), z: +o.z.toFixed(2), a: o.a, sp: o.sp, ttl: +o.ttl.toFixed(2), pi: o.pi });

// ------------------------------------------------------------- efeitos (todos os peers aplicam o mesmo item_effect)
export function applyEffect(c, m) {
  if (!c) return;
  c.immuneT = Math.max(c.immuneT || 0, m.dur + (m.slow || 0) + (m.imm || 0));
  if (m.fx === 'freeze') { c.freezeT = m.dur; c.slowT = m.dur + m.slow; }
  else if (m.fx === 'spin') { c.spinT = m.dur; c.spinDir = m.dir < 0 ? -1 : 1; }
  else if (m.fx === 'shock') c.stunT = m.dur;
  c.drifting = false; c.driftT = 0; c.driftLevel = 0;
  if (c.owned && m.fx === 'spin') {                        // só velocidade/giro do próprio carro: nunca posição
    c.kick += c.spinDir * 6;
    c.vx += -Math.sin(c.a) * c.spinDir * m.kick; c.vz += Math.cos(c.a) * c.spinDir * m.kick;
  }
  const col = m.fx === 'freeze' ? [0.5, 0.95, 1] : m.fx === 'spin' ? [1, 0.85, 0.25] : [0.75, 0.5, 1];
  burst(c.x, c.y + 0.7, c.z, 22, col[0], col[1], col[2], 9, 0.6, 5);
  if (c.isLocal) {
    if (m.fx === 'spin') SFX.splat(); else SFX.thump(14);
    toast(m.fx === 'freeze' ? 'CONGELADO!' : m.fx === 'spin' ? 'DERRAPOU!' : 'CHOQUE!', m.fx === 'freeze' ? '#4df3ff' : m.fx === 'spin' ? '#ffd23f' : '#c084ff', 1);
  }
}
function hostEffect(c, m) {                               // host: aplica local + avisa todos
  m.t = 'item_effect'; m.pid = c.pid;
  broadcast(m); applyEffect(c, m);
}
function eligible(c, except) { return canRace(c) && c.pid !== except && !(c.immuneT > 0); }

// ------------------------------------------------------------- HOST: coleta e uso
export function hostPickup(pid, key) {
  if (!G.R || G.state !== 'race') return;
  const c = carById.get(pid);
  if (!canRace(c) || c.item) return;                      // inventário cheio / morto / terminou / queda livre: não consome a caixa
  const o = obstacles.find(x => x.type === 'itembox' && x.key === key);
  if (!o || IT.box[key]) return;                          // caixa inexistente ou já levada (primeiro a chegar ao host vence)
  const p = carPos(c), lim = c.owned ? POWER.boxRadius + CAR_R : POWER.pickupSlack;
  if (Math.hypot(p.x - o.x, p.z - o.z) > lim) return;
  const m = { t: 'item_granted', pid, item: rollItem(), key, roll: POWER.rollTime };
  IT.box[key] = POWER.boxRespawn;
  doGranted(m); broadcast(m);
}
function execItem(c, item) {
  const P = POWER, p = carPos(c);
  if (item === 'frost') {
    const m = { id: 'i' + (++IT.uid), k: 'frost', owner: c.pid, x: p.x + Math.cos(c.a) * (CAR_R + 1.2), y: c.y + 0.7, z: p.z + Math.sin(c.a) * (CAR_R + 1.2), a: c.a, sp: P.frost.speed, ttl: P.frost.ttl, pi: c.pi };
    spawnObj(m); broadcast({ t: 'item_spawn', kind: 'obj', ...m }); return true;
  }
  if (item === 'peel') {
    if (!c.grounded) return false;
    const x = p.x - Math.cos(c.a) * P.peel.back, z = p.z - Math.sin(c.a) * P.peel.back;
    track[c.pi].query(x, z, QQ);
    if (!QQ.floor) return false;                          // só solta sobre piso
    const m = { id: 'i' + (++IT.uid), k: 'peel', owner: c.pid, x, y: QQ.h + 0.05, z, a: c.a, sp: 0, ttl: P.peel.ttl, pi: c.pi };
    spawnObj(m); broadcast({ t: 'item_spawn', kind: 'obj', ...m }); return true;
  }
  if (item === 'pulse') {
    for (const o of cars) if (eligible(o, c.pid)) hostEffect(o, { fx: 'shock', dur: P.pulse.stun, imm: P.pulse.immune });
    burst(c.x, c.y + 0.8, c.z, 40, 0.8, 0.55, 1, 16, 0.7, 2);
    return true;
  }
  return false;
}
export function hostUse(pid, eid) {
  const c = carById.get(pid);
  if (!c || !G.R || G.state !== 'race') return;
  if (eid) { if (IT.seen.has(eid)) return; IT.seen.add(eid); }          // evento duplicado: ignora
  const ready = c.item && canRace(c) && c.itemCool <= 0 && G.R.t >= c.itemReadyAt;
  if (!ready || !execItem(c, c.item)) { resync(pid); return; }
  c.item = null; c.itemCool = POWER.useCool;
  const m = { t: 'item_state', inv: { [pid]: null } };
  doState(m); broadcast(m);
  if (c.isLocal) SFX.boost(1);
}
function resync(pid) {                                    // pedido inválido: devolve o inventário verdadeiro
  const c = carById.get(pid); if (!c) return;
  const m = { t: 'item_state', inv: { [pid]: c.item || null } };
  if (pid === G.myId) doState(m);
  else for (const v of NET.conns.values()) if (v.pid === pid && v.conn.open) v.conn.send(m);
}

// ----------------------------------------- handlers (iguais em todos os peers; o host chama direto, clientes via rede)
function doGranted(m) {
  const c = carById.get(m.pid); if (!c) return;
  c.item = m.item; c.itemRollEnd = performance.now() + m.roll * 1000; c.itemReadyAt = G.R ? G.R.t + m.roll : 0;
  if (!isHost()) IT.box[m.key] = true;
  if (c.isLocal) SFX.grab();
}
function doState(m) {
  if (m.inv) for (const k in m.inv) { const c = carById.get(+k); if (c) { c.item = m.inv[k] || null; if (!c.item) c.itemRollEnd = 0; } }
  if (m.full) {                                           // snapshot de reconexão
    IT.box = {}; for (const k in m.box) IT.box[k] = isHost() ? m.box[k] : true;
    for (const o of IT.objs.values()) scene.remove(o.mesh);
    IT.objs.clear(); for (const o of m.objs) spawnObj(o);
    for (const k in m.fx) { const c = carById.get(+k), f = m.fx[k]; if (c) { c.freezeT = f.f; c.slowT = f.s; c.stunT = f.u; c.spinT = f.p; c.immuneT = f.i; } }
  }
}
export function itemSnapshot() {
  const inv = {}, fx = {}, box = {};
  for (const c of cars) { inv[c.pid] = c.item || null; fx[c.pid] = { f: +c.freezeT.toFixed(2), s: +c.slowT.toFixed(2), u: +c.stunT.toFixed(2), p: +c.spinT.toFixed(2), i: +c.immuneT.toFixed(2) }; }
  for (const k in IT.box) box[k] = IT.box[k];
  return { t: 'item_state', full: true, inv, box, fx, objs: [...IT.objs.values()].map(objInfo) };
}
export function itemClientMsg(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'item_granted': doGranted(m); break;
    case 'item_state': doState(m); break;
    case 'item_spawn': if (m.kind === 'box') delete IT.box[m.id]; else spawnObj(m); break;
    case 'item_despawn': if (m.kind === 'box') IT.box[m.id] = true; else despawnObj(m.id, m.hit); break;
    case 'item_effect': applyEffect(carById.get(m.pid), m); break;
  }
}
export function itemHostMsg(pid, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'item_pickup' && typeof m.key === 'string') hostPickup(pid, m.key);
  else if (m.t === 'item_use') hostUse(pid, typeof m.eid === 'string' ? m.eid.slice(0, 40) : null);
}

// ------------------------------------------------------------- JOGADOR: usar (Q / botão)
export function useItem() {
  const c = myCar(); const now = performance.now();
  if (!c || G.state !== 'race' || !c.item || !canRace(c) || now < c.itemRollEnd || now < IT.useLock) return;
  IT.useLock = now + 600;                                 // um acionamento = um pedido, mesmo com toques/eventos duplicados
  const eid = G.myId + '-' + (++IT.seq) + '-' + ((Math.random() * 1e6) | 0);
  if (isHost()) hostUse(G.myId, eid); else toHost({ t: 'item_use', eid, item: c.item });
}
function tryPickup(c, dt) {
  c.pickCool = Math.max(0, (c.pickCool || 0) - dt);
  if (c.item || c.pickCool > 0 || !canRace(c)) return;
  for (const o of obstacles) {
    if (o.type !== 'itembox' || IT.box[o.key]) continue;
    if (Math.hypot(c.x - o.x, c.z - o.z) < POWER.boxRadius + CAR_R * 0.5 && Math.abs(c.y - o.y) < 2.5) {
      c.pickCool = 0.5;
      if (isHost()) hostPickup(c.pid, o.key); else toHost({ t: 'item_pickup', key: o.key });
      return;
    }
  }
}

// ------------------------------------------------------------- laço (todo frame, todos os estados)
export function updateItems(dt) {
  for (const c of cars) {
    c.freezeT = Math.max(0, c.freezeT - dt); c.slowT = Math.max(0, c.slowT - dt); c.stunT = Math.max(0, c.stunT - dt);
    c.spinT = Math.max(0, c.spinT - dt); c.immuneT = Math.max(0, c.immuneT - dt); c.itemCool = Math.max(0, c.itemCool - dt);
  }
  for (const o of obstacles) if (o.type === 'itembox') {
    o.group.visible = !IT.box[o.key];
    if (o.bar) { o.bar.rotation.y += dt * 1.8; o.bar.position.y = 1.5 + Math.sin(G.clockT * 3 + o.ph) * 0.18; }
  }
  const race = G.state === 'race' && G.R;
  for (const o of [...IT.objs.values()]) {
    o.age += dt; o.ttl -= dt;
    if (o.sp) { o.x += Math.cos(o.a) * o.sp * dt; o.z += Math.sin(o.a) * o.sp * dt; o.mesh.rotation.y += dt * 9; o.mesh.rotation.x += dt * 5; }
    else o.mesh.rotation.y += dt * 1.5;
    o.mesh.position.set(o.x, o.y, o.z);
    if (!isHost()) { if (o.ttl < -0.6) despawnObj(o.id); continue; }     // cliente: só visual; o host manda o despawn
    if (!race || o.ttl <= 0) { despawnObj(o.id); broadcast({ t: 'item_despawn', kind: 'obj', id: o.id }); continue; }
    let P = track[o.pi]; P.query(o.x, o.z, QQ);
    for (let k = 0; k < 3; k++) {
      if (QQ.s > P.len && o.pi < track.length - 1) { o.pi++; P = track[o.pi]; P.query(o.x, o.z, QQ); }
      else if (QQ.s < 0 && o.pi > 0) { o.pi--; P = track[o.pi]; P.query(o.x, o.z, QQ); }
      else break;
    }
    if (Math.abs(QQ.v) > QQ.hw + 0.8 || (QQ.s > P.len && o.pi >= track.length - 1)) {       // saiu da pista
      despawnObj(o.id); broadcast({ t: 'item_despawn', kind: 'obj', id: o.id }); continue;
    }
    const R = (o.k === 'frost' ? POWER.frost.radius : POWER.peel.radius) + CAR_R * 0.6;
    for (const c of cars) {
      if (!eligible(c, o.owner)) continue;
      const p = carPos(c);
      if (Math.hypot(p.x - o.x, p.z - o.z) > R || Math.abs(c.y - o.y) > 2.2) continue;
      if (o.k === 'frost') hostEffect(c, { fx: 'freeze', dur: POWER.frost.freeze, slow: POWER.frost.slow, imm: POWER.frost.immune });
      else hostEffect(c, { fx: 'spin', dur: POWER.peel.spin, dir: Math.random() < 0.5 ? -1 : 1, kick: POWER.peel.kick, imm: POWER.peel.immune });
      broadcast({ t: 'item_despawn', kind: 'obj', id: o.id, hit: c.pid }); despawnObj(o.id, c.pid);
      break;
    }
  }
  if (!race) return;
  for (const c of cars) if (c.owned) tryPickup(c, dt);
  if (!isHost()) return;
  for (const k in IT.box) if (typeof IT.box[k] === 'number' && (IT.box[k] -= dt) <= 0) { delete IT.box[k]; broadcast({ t: 'item_spawn', kind: 'box', id: k }); }
  for (const c of cars) if (c.owned && c.bot && c.item && c.itemCool <= 0 && G.R.t >= c.itemReadyAt && aiWantsItem(c, dt)) hostUse(c.pid, 'b' + (++IT.uid));
}
