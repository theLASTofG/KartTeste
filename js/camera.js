// Câmeras: perseguição na corrida, visão geral e câmera manual da montagem; linhas de velocidade.
import * as THREE from 'three';
import { G } from './state.js';
import { $, clamp, lerp, rnd, TAU, wrapA } from './utils.js';
import { CELL } from './config.js';
import { camera, fxg, H, portrait, scene, sun, W } from './scene.js';
import { endPos, exitPos, freeExits, megaIndex, slotGroup, tmpW, track } from './track.js';
import { freeSlots } from './obstacles.js';
import { cars, myCar } from './cars.js';
import { cmpRace } from './hud.js';
// ---- câmera manual da montagem: estado próprio (alvo, distância, limites, modo manual)
export const BC = { active: false, manual: false, x: 0, z: 0, d: 60, ax: 0, az: 0, autoD: 60, b: null };
export const PTRS = new Map();
G.pinch = null;
function bcClamp() {
  const b = BC.b;
  if (b) { BC.x = clamp(BC.x, b.x0 - 30, b.x1 + 30); BC.z = clamp(BC.z, b.z0 - 30, b.z1 + 30); }
  BC.d = clamp(BC.d, 22, Math.max(45, BC.autoD * 1.3));
}
function bcManual() { if (!BC.manual) { BC.x = BC.ax; BC.z = BC.az; BC.d = BC.autoD; BC.manual = true; } }
// enquadramento inicial perto das zonas livres (começa pelas mais novas, no fim da pista)
function focusSlots() {
  const pts = G.slotKind === 'exit'
    ? [...freeExits().map(k => { exitPos(k, tmpW); return { x: tmpW.x, z: tmpW.z, pi: 0 }; }), ...(megaIndex() >= 0 ? [(endPos(tmpW), { x: tmpW.x, z: tmpW.z, pi: 1 })] : [])]
    : freeSlots().map(k => { const [pi, si] = k.split(':').map(Number), p = track[pi], sl = p.slots[si]; p.world(sl.s, sl.v, tmpW); return { x: tmpW.x, z: tmpW.z, pi }; });
  if (!pts.length) { BC.manual = false; return; }
  pts.sort((u, v) => v.pi - u.pi);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const q of pts) {
    const nx0 = Math.min(x0, q.x), nx1 = Math.max(x1, q.x), nz0 = Math.min(z0, q.z), nz1 = Math.max(z1, q.z);
    if (x0 < 1e9 && Math.max(nx1 - nx0, nz1 - nz0) > 90) break;
    x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
  }
  BC.x = (x0 + x1) / 2; BC.z = (z0 + z1) / 2; BC.d = Math.max(32, Math.max(x1 - x0, (z1 - z0) * 1.3) * 0.9 + 26);
  BC.manual = true; bcClamp();
}
export function setSlotMode(on, kind = 'slot') {
  const kchanged = G.slotKind !== kind;
  G.slotKind = kind;
  slotGroup.visible = on;
  for (const g of slotGroup.children) g.visible = g.userData.kind === kind;
  $('camHint').classList.toggle('show', on);
  if (on && BC.active && kchanged) focusSlots();
  if (on && !BC.active) { BC.active = true; focusSlots(); }
  if (!on && BC.active) { BC.active = false; BC.manual = false; PTRS.clear(); G.pinch = null; }
}
export function panBy(dx, dy) {
  bcManual();
  const wpp = 2 * Math.hypot(BC.d, BC.d * 0.5) * Math.tan(camera.fov * Math.PI / 360) / H;   // metros por pixel
  BC.x -= dx * wpp; BC.z -= dy * wpp * 1.12; bcClamp();
}
export function zoomBy(k) { bcManual(); BC.d *= k; bcClamp(); }
export function pinchInfo() { const [a, b] = [...PTRS.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// --------------------------------------------------------------- update
G.camSnap = true; let camYaw = 0; G.clockT = 0;
const camLook = new THREE.Vector3(), camDesired = new THREE.Vector3(), vLook = new THREE.Vector3();
// espectador: quem já terminou ou perdeu as 3 vidas escolhe qual carro vivo assistir (Tab/setas no PC, toque no #info no celular)
G.specId = -1;
export function isSpectating() {
  const p = myCar();
  return !!(p && G.state === 'race' && (p.finished || !p.alive) && !(G.R && G.R.spectateT > 0));
}
function specList() {
  let l = cars.filter(c => c.alive && !c.finished && c.pid !== G.myId);        // ainda correndo
  if (!l.length) l = cars.filter(c => c.alive && c.pid !== G.myId);
  return l.sort((a, b) => cmpRace(a, b));
}
export function specTarget() {
  const l = specList();
  return l.find(c => c.pid === G.specId) || l[0] || null;
}
export function cycleSpectate(dir) {
  const l = specList(); if (!l.length) return;
  const i = l.indexOf(specTarget());
  G.specId = l[((i < 0 ? 0 : i + dir) % l.length + l.length) % l.length].pid;
  G.camSnap = true;
}
function camTarget() {
  const p = myCar();
  if (p && p.alive && !p.finished) return p;
  if (p && (G.R && G.R.spectateT > 0)) return p;
  if (p && p.finished && p.alive) { const t = specTarget(); return t || p; }
  return specTarget() || p || cars[0];
}
export function followCamera(dt) {
  const c = camTarget(); if (!c) return;
  const sp = Math.hypot(c.vx, c.vz);
  let yawT = c.a;
  if (sp > 4) yawT = c.a + wrapA(Math.atan2(c.vz, c.vx) - c.a) * 0.5;
  const falling = !c.alive || c.y < -2;
  if (G.camSnap) camYaw = yawT;
  camYaw += wrapA(yawT - camYaw) * (1 - Math.exp(-dt * 4));
  const dist = (portrait ? 12 : 9.5) + sp * 0.07, hgt = (portrait ? 6.2 : 4.6) + sp * 0.03;
  if (!falling) camDesired.set(c.x - Math.cos(camYaw) * dist, Math.max(c.y, 0) + hgt, c.z - Math.sin(camYaw) * dist);
  vLook.set(c.x + Math.cos(camYaw) * 6, c.y + 1, c.z + Math.sin(camYaw) * 6);
  if (falling) vLook.set(c.x, c.y, c.z);
  if (G.camSnap) { camera.position.copy(camDesired); camLook.copy(vLook); G.camSnap = false; scene.fog.near = 70; scene.fog.far = 270; }
  camera.position.lerp(camDesired, 1 - Math.exp(-dt * 7));
  camLook.lerp(vLook, 1 - Math.exp(-dt * 10));
  G.shake = Math.max(0, G.shake - dt * 1.2);
  camera.position.x += rnd(-1, 1) * G.shake; camera.position.y += rnd(-1, 1) * G.shake * 0.6; camera.position.z += rnd(-1, 1) * G.shake;
  camera.lookAt(camLook);
  const fovT = 66 + clamp(sp / 27, 0, 1.4) * 9 + (c.boostT > 0 ? 6 : 0);
  camera.fov += (fovT - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix();
  sun.position.set(c.x + 18, 40, c.z + 10); sun.target.position.set(c.x, 0, c.z);
  scene.fog.near = lerp(scene.fog.near, 70, 1 - Math.exp(-dt * 3)); scene.fog.far = lerp(scene.fog.far, 270, 1 - Math.exp(-dt * 3));
}
export function overviewCamera(dt) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const p of track) for (const cc of p.cells) { x0 = Math.min(x0, cc[0] * CELL); x1 = Math.max(x1, cc[0] * CELL); z0 = Math.min(z0, cc[1] * CELL); z1 = Math.max(z1, cc[1] * CELL); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const ex = x1 - x0 + CELL * 1.6, ez = z1 - z0 + CELL * 1.6;
  const th = Math.tan(30 * Math.PI / 180), aspect = W / H;
  const top = G.state === 'pick' ? 0.1 : 0;
  const bottom = G.state === 'pick' && $('placebar').classList.contains('show') ? Math.min(0.4, ($('placebar').offsetHeight + 20) / H) : 0;
  const visH = Math.max(0.3, 1 - top - bottom - 0.08);
  const d = Math.max(ez / (2 * th * visH), ex / (2 * th * aspect * 0.92)) * 1.05 + 12;
  const ang = G.state === 'title' || G.state === 'lobby' ? G.clockT / 9 : 0;
  const off = (bottom - top) * th * d;
  BC.ax = cx; BC.az = cz + off; BC.autoD = d; BC.b = { x0, x1, z0, z1 };
  if (BC.active && BC.manual) {                       // câmera manual da montagem (pan/zoom do jogador)
    camDesired.set(BC.x, BC.d, BC.z + BC.d * 0.5); vLook.set(BC.x, 0, BC.z);
  } else {
    camDesired.set(cx + Math.sin(ang) * d * 0.5, d, cz + Math.cos(ang) * d * 0.5 + off * 0.9);
    vLook.set(cx, 0, cz + off);
  }
  scene.fog.near = lerp(scene.fog.near, d * 0.9, 1 - Math.exp(-dt * 3)); scene.fog.far = lerp(scene.fog.far, d * 2.6 + 60, 1 - Math.exp(-dt * 3));
  camera.far = Math.max(800, d * 3);
  const kf = BC.active && BC.manual ? 12 : 2.5;
  camera.position.lerp(camDesired, 1 - Math.exp(-dt * kf));
  camLook.lerp(vLook, 1 - Math.exp(-dt * kf * 1.2));
  G.shake = Math.max(0, G.shake - dt * 1.2);
  camera.position.x += rnd(-1, 1) * G.shake; camera.position.y += rnd(-1, 1) * G.shake;
  camera.lookAt(camLook);
  camera.fov += (60 - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix();
  sun.position.set(cx + 30, 60, cz + 20); sun.target.position.set(cx, 0, cz);
}

// ----------------------------------------------------- linhas de velocidade
const speedLines = [];
for (let i = 0; i < 46; i++) speedLines.push({ a: rnd(0, TAU), r: rnd(0.2, 1), k: rnd(0.6, 1.4) });
let fxDirty = false;
export function drawFx(dt) {
  const p = G.state === 'race' ? camTarget() : null;
  const sp = p ? Math.hypot(p.vx || 0, p.vz || 0) : 0;
  const inten = p ? clamp((sp - 24) / 12, 0, 1) * 0.5 + (p.boostT > 0 ? 0.7 * clamp(p.boostT / 0.4, 0, 1) : 0) : 0;
  if (inten <= 0.02) { if (fxDirty) { fxg.clearRect(0, 0, W, H); fxDirty = false; } return; }
  fxg.clearRect(0, 0, W, H); fxDirty = true;
  const cx = W / 2, cy = H * 0.45, md = Math.min(W, H) * 0.32, mx = Math.hypot(W, H) * 0.6;
  fxg.strokeStyle = '#fff'; fxg.lineCap = 'round';
  for (const s of speedLines) {
    s.r += dt * 2.6 * s.k * (0.5 + inten);
    if (s.r > 1) { s.r = rnd(0, 0.15); s.a = rnd(0, TAU); }
    const r0 = md + s.r * (mx - md), len = 30 + 120 * inten * s.k;
    const x0 = cx + Math.cos(s.a) * r0, y0 = cy + Math.sin(s.a) * r0;
    fxg.globalAlpha = clamp(inten * 0.55 * s.r * 1.6, 0, 0.6); fxg.lineWidth = 2 * s.k;
    fxg.beginPath(); fxg.moveTo(x0, y0); fxg.lineTo(x0 + Math.cos(s.a) * len, y0 + Math.sin(s.a) * len); fxg.stroke();
  }
  fxg.globalAlpha = 1;
}
