// Obstáculos e espaços (slots) onde podem ser colocados.
import * as THREE from 'three';
import { hooks } from './state.js';
import { box, disposeGroup, M } from './scene.js';
import { addDrop, obstacles, slotGroup, tmpW, track, trackRoot } from './track.js';

// ---------------------------------------------------------- obstáculos
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
export function rebuildSlots() {
  for (const g of [...slotGroup.children]) slotGroup.remove(g);
  for (const k of freeSlots()) {
    const [pi, si] = k.split(':').map(Number), p = track[pi], sl = p.slots[si];
    p.world(sl.s, sl.v, tmpW);
    const grp = new THREE.Group(); grp.position.set(tmpW.x, p.query(tmpW.x, tmpW.z, {}).h, tmpW.z);
    const plate = new THREE.Mesh(slotPlate, M.slot); plate.rotation.x = -Math.PI / 2; plate.rotation.z = -tmpW.a; plate.position.y = 0.07;
    const beam = new THREE.Mesh(slotBeam, beamMat); beam.position.y = 7;
    plate.userData.key = beam.userData.key = k; plate.userData.plate = true;
    grp.add(plate, beam); slotGroup.add(grp);
  }
  slotGroup.visible = hooks.BC.active;
}
