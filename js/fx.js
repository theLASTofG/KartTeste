// Partículas (faíscas, fumaça, confete).
import * as THREE from 'three';
import { G } from './state.js';
import { rnd } from './utils.js';
import { scene, texDot } from './scene.js';

// --------------------------------------------------------------- partículas
const PMAX = 900;
const P = { x: new Float32Array(PMAX), y: new Float32Array(PMAX), z: new Float32Array(PMAX), vx: new Float32Array(PMAX), vy: new Float32Array(PMAX),
  vz: new Float32Array(PMAX), l: new Float32Array(PMAX), m: new Float32Array(PMAX), r: new Float32Array(PMAX), g: new Float32Array(PMAX),
  b: new Float32Array(PMAX), gr: new Float32Array(PMAX) };
let pHead = 0;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
for (let i = 0; i < PMAX; i++) pPos[i * 3 + 1] = -9999;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const ptsMesh = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, map: texDot, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
ptsMesh.frustumCulled = false; scene.add(ptsMesh);
export function emit(x, y, z, vx, vy, vz, life, r, g, b, grav = 0) {
  if (G.fxLow && Math.random() < 0.5) return;                  // modo leve: corta metade das partículas
  const i = pHead; pHead = (pHead + 1) % PMAX;
  P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz; P.l[i] = life; P.m[i] = life;
  P.r[i] = r; P.g[i] = g; P.b[i] = b; P.gr[i] = grav;
}
export function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (P.l[i] <= 0) continue;
    P.l[i] -= dt;
    if (P.l[i] <= 0) { pPos[i * 3 + 1] = -9999; continue; }
    P.vy[i] -= P.gr[i] * dt;
    const d = Math.exp(-2.5 * dt); P.vx[i] *= d; P.vz[i] *= d;
    P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
    const k = P.l[i] / P.m[i];
    pPos[i * 3] = P.x[i]; pPos[i * 3 + 1] = P.y[i]; pPos[i * 3 + 2] = P.z[i];
    pCol[i * 3] = P.r[i] * k; pCol[i * 3 + 1] = P.g[i] * k; pCol[i * 3 + 2] = P.b[i] * k;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
export function burst(x, y, z, n, r, g, b, sp = 8, life = 0.5, grav = 10) {
  for (let k = 0; k < n; k++) emit(x, y, z, rnd(-sp, sp), rnd(0, sp), rnd(-sp, sp), rnd(life * 0.5, life), r, g, b, grav);
}
