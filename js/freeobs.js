// Obstáculos de posicionamento LIVRE (armadilhas): malhas, lista ativa, Bola de Demolição pendular e Barreira.
// Ciclo de vida: o host guarda a armadilha escondida durante a montagem e só a revela no início da rodada (fase "countdown");
// ela vale por exatamente 1 rodada (rounds = 1) e some quando a rodada termina (freeOnRoundEnd / clearFree).
import * as THREE from 'three';
import { GSTRIP, WRECK } from './config.js';
import { disposeObject3D, keepResource, M } from './scene.js';
import { buildGeyserParts } from './obstacles.js';
import { trackRoot } from './track.js';

export const freeObs = [];          // armadilhas reveladas (todos os peers): {id,type,x,y,z,a,ph,spd,owner,rounds,group,...}
let own = null;                     // a armadilha que EU acabei de posicionar (só eu a vejo até a rodada começar)

const matBall = keepResource(new THREE.MeshLambertMaterial({ color: 0x4a505e, emissive: 0x10141c }));
const matChain = keepResource(new THREE.MeshLambertMaterial({ color: 0x9aa3b8 }));
const matSpike = keepResource(new THREE.MeshLambertMaterial({ color: 0xff5a1a, emissive: 0x401400 }));
const matShadow = keepResource(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
const geoPost = keepResource(new THREE.CylinderGeometry(0.35, 0.45, WRECK.H + 0.6, 10));
const geoBeam = keepResource(new THREE.BoxGeometry(0.6, 0.6, 7.2));
const geoCap = keepResource(new THREE.SphereGeometry(0.5, 12, 10));
const geoChain = keepResource(new THREE.CylinderGeometry(0.09, 0.09, WRECK.L - WRECK.R, 6));
const geoBall = keepResource(new THREE.SphereGeometry(WRECK.R, 20, 16));
const geoSpike = keepResource(new THREE.ConeGeometry(0.22, 0.55, 6));
const geoShadow = keepResource(new THREE.CircleGeometry(WRECK.R * 1.2, 20));
const geoStrip = keepResource(new THREE.PlaneGeometry(GSTRIP.len, GSTRIP.w));
const matScorch = keepResource(new THREE.MeshBasicMaterial({ color: 0x1a0c06, transparent: true, opacity: 0.45, depthWrite: false }));
const geoBarrier = keepResource(new THREE.BoxGeometry(WRECK.barrierLen, 1.5, WRECK.barrierW));

// monta a malha de uma armadilha (o.pend / o.shadow ficam guardados para a animação)
export function buildFree(type, o) {
  const g = new THREE.Group();
  if (type === 'wrecking') {
    const { L, H } = WRECK;
    for (const sd of [-1, 1]) { const p = new THREE.Mesh(geoPost, M.post); p.position.set(0, (H + 0.6) / 2, sd * 3.4); p.castShadow = true; g.add(p); }
    const beam = new THREE.Mesh(geoBeam, M.hazard); beam.position.set(0, H + 0.3, 0); g.add(beam);
    const cap = new THREE.Mesh(geoCap, matSpike); cap.position.set(0, H, 0); g.add(cap);
    const pend = new THREE.Group(); pend.position.set(0, H, 0); g.add(pend);
    const chain = new THREE.Mesh(geoChain, matChain); chain.position.y = -(L - WRECK.R) / 2; pend.add(chain);
    const ball = new THREE.Mesh(geoBall, matBall); ball.position.y = -L; ball.castShadow = true; pend.add(ball);
    for (let k = 0; k < 8; k++) {                                          // pontas ao redor da esfera (leitura de perigo)
      const a = k / 8 * Math.PI * 2, sp = new THREE.Mesh(geoSpike, matSpike);
      sp.position.set(Math.cos(a) * WRECK.R * 0.95, -L + Math.sin(a * 2) * 0.4, Math.sin(a) * WRECK.R * 0.95);
      sp.rotation.set(Math.sin(a) * Math.PI / 2, 0, -Math.cos(a) * Math.PI / 2); pend.add(sp);
    }
    const sh = new THREE.Mesh(geoShadow, matShadow.clone()); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.05; g.add(sh);   // sombra no chão acompanha a esfera
    if (o) { o.pend = pend; o.shadow = sh; }
  } else if (type === 'geyserstrip') {
    const scorch = new THREE.Mesh(geoStrip, matScorch); scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.035; g.add(scorch);   // faixa chamuscada: mostra o corredor
    if (o) o.gs = [];
    for (const [u, w, ph] of GSTRIP.list) { const parts = buildGeyserParts(g, u, w, true); if (o) o.gs.push({ lu: u, lw: w, ph, ...parts, gst: -1, x: 0, y: 0, z: 0 }); }
  } else if (type === 'barrier') {
    const b = new THREE.Mesh(geoBarrier, M.hazard); b.position.y = 0.75; b.castShadow = true; g.add(b);
    for (const sd of [-1, 1]) { const p = new THREE.Mesh(geoCap, matSpike); p.position.set(0, 1.6, sd * WRECK.barrierLen / 2); g.add(p); }
  }
  return g;
}

// posição/velocidade (mundo) da esfera: angulo(t) = maxAng * sin(ω·t + fase); ω = o.spd, fase = o.ph. Eixo de oscilação = direção o.a (yaw escolhido).
export function wreckBall(o, tc, out) {
  const arg = o.spd * tc + o.ph, th = WRECK.maxAng * Math.sin(arg), dth = WRECK.maxAng * o.spd * Math.cos(arg);
  const dx = Math.cos(o.a), dz = Math.sin(o.a), sx = WRECK.L * Math.sin(th), v = WRECK.L * Math.cos(th) * dth;
  out.x = o.x + dx * sx; out.z = o.z + dz * sx; out.y = o.y + WRECK.H - WRECK.L * Math.cos(th);
  out.vx = dx * v; out.vz = dz * v; out.th = th;
  return out;
}
const WB = { x: 0, y: 0, z: 0, vx: 0, vz: 0, th: 0 };
function animateOne(o, tc) {
  if (o.type !== 'wrecking' || !o.pend) return;
  wreckBall(o, tc, WB);
  o.pend.rotation.z = WB.th;
  const rel = WRECK.L * Math.sin(WB.th), hgt = WB.y - o.y;
  o.shadow.position.x = rel;                                              // sombra no chão, sob a esfera
  const k = Math.min(1, Math.max(0, (hgt - WRECK.R) / 5));
  o.shadow.scale.setScalar(1 - 0.35 * k); o.shadow.material.opacity = 0.55 - 0.3 * k;
}
// itera os gêiseres do(s) corredor(es) ativos (para animação/partículas/colisão)
export function eachFreeGeyser(fn) { for (const o of freeObs) if (o.gs) for (const s of o.gs) fn(s); if (own && own.gs) for (const s of own.gs) fn(s); }
export function animateFree(tc) { for (const o of freeObs) animateOne(o, tc); if (own) animateOne(own, tc); }

function place(o) {
  o.group = buildFree(o.type, o);
  o.group.position.set(o.x, o.y, o.z); o.group.rotation.y = -o.a;
  if (o.gs) { const ca = Math.cos(o.a), sa = Math.sin(o.a); for (const s of o.gs) { s.x = o.x + s.lu * ca - s.lw * sa; s.z = o.z + s.lu * sa + s.lw * ca; s.y = o.y; } }   // posição de MUNDO de cada gêiser
  trackRoot.add(o.group);
}
// revela a lista do host (início da rodada); substitui qualquer prévia minha
export function applyFree(list) {
  clearFree();
  for (const m of list || []) { const o = { ...m, rounds: m.rounds ?? 1, pulse: 0 }; place(o); freeObs.push(o); }
}
export function showOwnFree(m) {                     // só para o dono, entre o posicionamento e o início da rodada
  clearOwn();
  own = { ...m, rounds: m.rounds ?? 1, pulse: 0 }; place(own);
}
function clearOwn() { if (own) { disposeObject3D(own.group); own = null; } }
export function clearFree() {
  for (const o of freeObs) disposeObject3D(o.group);
  freeObs.length = 0; clearOwn();
}
// fim da rodada: cada armadilha perde 1 rodada de vida e some ao chegar a 0 (as atuais têm exatamente 1)
export function freeOnRoundEnd() {
  for (let i = freeObs.length - 1; i >= 0; i--) { const o = freeObs[i]; if (--o.rounds <= 0) { disposeObject3D(o.group); freeObs.splice(i, 1); } }
  clearOwn();
}
