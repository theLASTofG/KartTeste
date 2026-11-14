// Obstáculos e espaços (slots) onde podem ser colocados.
import * as THREE from 'three';
import { G, hooks } from './state.js';
import { GEY, MEGA } from './config.js';
import { box, disposeGroup, M } from './scene.js';
import { addDrop, endPos, exitPos, freeExits, megaIndex, obstacles, slotGroup, tmpW, track, trackRoot } from './track.js';

// ---------------------------------------------------------- obstáculos
const matBoxGlass = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.32, depthWrite: false });
const matBoxEdge = new THREE.LineBasicMaterial({ color: 0xffffff });
const matBoxCore = new THREE.MeshBasicMaterial({ color: 0xff2e88 });
const matBoxRing = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
const geoMineBase = new THREE.CylinderGeometry(0.95, 1.1, 0.28, 14), geoMineLight = new THREE.SphereGeometry(0.3, 10, 8), geoMineSpike = new THREE.ConeGeometry(0.14, 0.5, 6);
const matMineBase = new THREE.MeshLambertMaterial({ color: 0x2a2a38, emissive: 0x120a08 }), matMineSpike = new THREE.MeshLambertMaterial({ color: 0x6a3a2a });
export const matMineOn = new THREE.MeshBasicMaterial({ color: 0xff2a1a }), matMineOff = new THREE.MeshBasicMaterial({ color: 0x5a0e0a });
// gêiser: cratera de basalto + brilho que muda de cor + coluna de água/vapor (animados em main.js)
const geoGeyRing = new THREE.RingGeometry(1.1, 2.0, 28), geoGeyPit = new THREE.CircleGeometry(1.1, 22), geoGeyGlow = new THREE.CircleGeometry(2.9, 28);
const geoGeyCol = new THREE.CylinderGeometry(1.0, 1.9, GEY.height, 16, 1, true), geoGeyRock = new THREE.BoxGeometry(0.7, 0.45, 0.55);
const matGeyPit = new THREE.MeshBasicMaterial({ color: 0x060302 }), matGeyRock = new THREE.MeshLambertMaterial({ color: 0x2b2420 });
// cratera + brilho + coluna de um gêiser no ponto local (lx,lz) do grupo g. lite = menos pedras (corredores têm dezenas de gêiseres)
export function buildGeyserParts(g, lx, lz, lite) {
  const pit = new THREE.Mesh(geoGeyPit, matGeyPit); pit.rotation.x = -Math.PI / 2; pit.position.set(lx, 0.045, lz); g.add(pit);
  const ring = new THREE.Mesh(geoGeyRing, new THREE.MeshBasicMaterial({ color: 0x00e5ff })); ring.rotation.x = -Math.PI / 2; ring.position.set(lx, 0.05, lz); g.add(ring);
  const glow = new THREE.Mesh(geoGeyGlow, new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(lx, 0.06, lz); g.add(glow);
  const n = lite ? 4 : 9;
  for (let k = 0; k < n; k++) { const r = new THREE.Mesh(geoGeyRock, matGeyRock), an = k / n * Math.PI * 2; r.position.set(lx + Math.cos(an) * 2.15, 0.2, lz + Math.sin(an) * 2.15); r.rotation.y = -an; if (!lite) r.castShadow = true; g.add(r); }
  const col = new THREE.Mesh(geoGeyCol, new THREE.MeshBasicMaterial({ color: 0xcdf6ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  col.position.set(lx, 0, lz); col.scale.y = 0.001; col.visible = false; g.add(col);
  return { ring, glow, col };
}
export const obsData = () => obstacles.map(o => ({ key: o.key, type: o.type, ph: o.ph, spd: o.spd }));
function makeObstacle(type, k, ph, spd) {
  const [pi, si] = k.split(':').map(Number);
  const p = track[pi]; if (!p || !p.slots[si] || p.type === 'finish') return null;
  const sl = p.slots[si];
  p.world(sl.s, sl.v, tmpW);
  const q = p.query(tmpW.x, tmpW.z, {});
  const o = { key: k, type, pi, si, x: tmpW.x, z: tmpW.z, a: tmpW.a, y: q.h, s: sl.s, v: sl.v, ph: ph || 0, spd: spd || 1.7, pulse: 0 };
  const g = new THREE.Group(); g.position.set(o.x, o.y, o.z); g.rotation.y = -o.a;
  if (type === 'block') {
    box(2.4, 2.6, 2.4, M.block, 0, 1.3, 0, g);
    box(2.45, 0.14, 2.45, M.white, 0, 2.0, 0, g, false);
  } else if (type === 'bumper') {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 1.2, 20), M.bumper); cyl.position.y = 0.6; cyl.castShadow = true; g.add(cyl);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.16, 8, 24), M.bumperRing); ring.rotation.x = Math.PI / 2; ring.position.y = 1.22; g.add(ring);
    o.bar = cyl;
  } else if (type === 'spinner') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.7, 12), M.post); post.position.y = 0.85; post.castShadow = true; g.add(post);
    const arm = new THREE.Group(); arm.position.y = 1.0; g.add(arm);
    box(6.0, 0.55, 0.55, M.spinBar, 0, 0, 0, arm);
    o.bar = arm;
  } else if (type === 'oil') {
    const m = new THREE.Mesh(new THREE.CircleGeometry(2.3, 28), M.oil); m.rotation.x = -Math.PI / 2; m.position.y = 0.035; g.add(m);
  } else if (type === 'mboost') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), M.pad1); m.rotation.x = -Math.PI / 2; m.position.y = 0.04; g.add(m);
    for (const sd of [-1, 1]) box(3.2, 0.05, 0.16, M.edgeY, 0, 0.04, sd * 1.65, g, false);
  } else if (type === 'kicker') {
    const ks = new THREE.Shape(); ks.moveTo(-1.3, 0); ks.lineTo(1.3, 0.9); ks.lineTo(1.3, 0); ks.lineTo(-1.3, 0);
    const kg = new THREE.ExtrudeGeometry(ks, { depth: 3.0, bevelEnabled: false }); kg.translate(0, 0, -1.5);
    const km = new THREE.Mesh(kg, M.ramp); km.castShadow = km.receiveShadow = true; g.add(km);
    box(0.2, 0.06, 3.0, M.edgeY, 1.2, 0.9, 0, g, false);
  } else if (type === 'itembox') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 8, 28), matBoxRing); ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; g.add(ring);
    const cube = new THREE.Group(); cube.position.y = 1.5; g.add(cube);
    cube.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), matBoxGlass));
    cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.72, 1.72, 1.72)), matBoxEdge));
    cube.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), matBoxCore));
    o.bar = cube;
  } else if (type === 'geyser') {
    const gp = buildGeyserParts(g, 0, 0, false);
    o.ring = gp.ring; o.glow = gp.glow; o.col = gp.col; o.bar = gp.col; o.gst = -1;
  } else if (type === 'mine') {
    const b = new THREE.Mesh(geoMineBase, matMineBase); b.position.y = 0.14; b.castShadow = true; g.add(b);
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(geoMineSpike, matMineSpike); const an = k * Math.PI / 2 + Math.PI / 4; sp.position.set(Math.cos(an) * 0.62, 0.36, Math.sin(an) * 0.62); sp.rotation.set(Math.sin(an) * 0.5, 0, -Math.cos(an) * 0.5); g.add(sp); }
    const lt = new THREE.Mesh(geoMineLight, matMineOn); lt.position.y = 0.42; g.add(lt);
    o.bar = lt;
  } else if (type === 'piston') {
    const base = box(2.8, 0.08, 2.8, M.hazard, 0, 0.03, 0, g, false);
    const arm = new THREE.Group(); g.add(arm);
    box(2.2, 2.4, 2.2, M.piston, 0, 1.2, 0, arm);
    box(2.25, 0.12, 2.25, M.white, 0, 2.0, 0, arm, false);
    o.bar = arm; o.lift = 1; void base;
  }
  o.group = g; trackRoot.add(g);
  return o;
}
export function syncObstacles(list, animate) {
  const want = new Set(list.map(o => o.key));
  for (let i = obstacles.length - 1; i >= 0; i--) if (!want.has(obstacles[i].key)) { disposeGroup(obstacles[i].group); obstacles.splice(i, 1); }
  for (const o of list) {
    if (obstacles.some(x => x.key === o.key)) continue;
    const ob = makeObstacle(o.type, o.key, o.ph, o.spd);
    if (ob) { obstacles.push(ob); if (animate) addDrop(ob.group, 0, null); }
  }
}
export function freeSlots() {
  const used = new Set(obstacles.map(o => o.key)), res = [];
  track.forEach((p, pi) => p.slots.forEach((s, si) => { const k = pi + ':' + si; if (!used.has(k)) res.push(k); }));
  return res;
}
// marcadores 3D de TODAS as zonas livres: placa + feixe vertical (fácil de achar e tocar de longe)
const slotPlate = new THREE.PlaneGeometry(4.2, 4.2), slotBeam = new THREE.CylinderGeometry(0.45, 0.45, 14, 10, 1, true);
export const beamMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
const exitPlate = new THREE.PlaneGeometry(11, 11);
const exitMats = MEGA.colors.map(c => { const m = M.slot.clone(); m.color.setHex(c); m.opacity = 0.95; return m; });
const endMat = (() => { const m = M.slot.clone(); m.color.setHex(0xffffff); m.opacity = 0.95; return m; })();
const endBeamMat = (() => { const m = beamMat.clone(); m.color.setHex(0xffffff); return m; })();
const exitBeamMats = MEGA.colors.map(c => { const m = beamMat.clone(); m.color.setHex(c); return m; });
export function rebuildSlots() {
  for (const g of [...slotGroup.children]) slotGroup.remove(g);
  for (const k of freeSlots()) {
    const [pi, si] = k.split(':').map(Number), p = track[pi], sl = p.slots[si];
    p.world(sl.s, sl.v, tmpW);
    const grp = new THREE.Group(); grp.position.set(tmpW.x, p.query(tmpW.x, tmpW.z, {}).h, tmpW.z);
    const plate = new THREE.Mesh(slotPlate, M.slot); plate.rotation.x = -Math.PI / 2; plate.rotation.z = -tmpW.a; plate.position.y = 0.07;
    const beam = new THREE.Mesh(slotBeam, beamMat); beam.position.y = 7;
    plate.userData.key = beam.userData.key = k; plate.userData.plate = true;
    grp.userData.kind = 'slot'; grp.visible = (G.slotKind || 'slot') === 'slot';
    grp.add(plate, beam); slotGroup.add(grp);
  }
  if (megaIndex() >= 0) for (const k of freeExits()) {                      // saídas livres da Mega Pista (cada uma com a cor do arco)
    exitPos(k, tmpW);
    const grp = new THREE.Group(); grp.position.set(tmpW.x, 0, tmpW.z);
    const plate = new THREE.Mesh(exitPlate, exitMats[k]); plate.rotation.x = -Math.PI / 2; plate.rotation.z = -tmpW.a; plate.position.y = 0.09;
    const beam = new THREE.Mesh(slotBeam, exitBeamMats[k]); beam.position.y = 7; beam.scale.set(2.2, 1, 2.2);
    plate.userData.key = beam.userData.key = 'x' + k; plate.userData.plate = true;
    grp.userData.kind = 'exit'; grp.visible = G.slotKind === 'exit';
    grp.add(plate, beam); slotGroup.add(grp);
  }
  if (megaIndex() >= 0) {                                                   // fim da pista principal (antes da chegada, depois do funil)
    endPos(tmpW);
    const grp = new THREE.Group(); grp.position.set(tmpW.x, tmpW.y, tmpW.z);
    const plate = new THREE.Mesh(exitPlate, endMat); plate.rotation.x = -Math.PI / 2; plate.position.y = 0.09;
    const beam = new THREE.Mesh(slotBeam, endBeamMat); beam.position.y = 7; beam.scale.set(2.2, 1, 2.2);
    plate.userData.key = beam.userData.key = 'end'; plate.userData.plate = true;
    grp.userData.kind = 'exit'; grp.visible = G.slotKind === 'exit';
    grp.add(plate, beam); slotGroup.add(grp);
  }
  slotGroup.visible = hooks.BC.active;
}
