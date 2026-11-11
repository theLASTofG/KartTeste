// Renderer, cena, câmera, luzes, texturas, materiais, cenário e temas.
import * as THREE from 'three';
import { G } from './state.js';
import { $, rnd } from './utils.js';
import { HW, WALL_H } from './config.js';

// ------------------------------------------------------ Three.js setup
G.PR = Math.min(window.devicePixelRatio || 1, 1.75);
export let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
} catch (e) { $('loading').textContent = 'Seu navegador não suporta WebGL :('; throw e; }
renderer.setPixelRatio(G.PR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
export const scene = new THREE.Scene();
const BG = 0x07031a;
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 70, 270);
export const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(-20, 20, 0);
const hemi = new THREE.HemisphereLight(0xc8d8ff, 0x3a1450, 1.25);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 160 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

export const fxc = $('fx'), fxg = fxc.getContext('2d');
export let W = 0, H = 0, portrait = false;
export function onResize() {
  W = window.innerWidth; H = window.innerHeight; portrait = H > W * 1.05;
  document.body.classList.toggle('portrait', portrait);
  renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
  fxc.width = W; fxc.height = H;
}
window.addEventListener('resize', onResize);
onResize();

// ------------------------------------------------------------ texturas
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}
const texLaneBase = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#2a2f47'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, h / 2 - 5, w * 0.45, 10);
});
const laneTexCache = {};
function laneTex(len) {
  const k = len.toFixed(1);
  if (!laneTexCache[k]) { const t = texLaneBase.clone(); t.repeat.set(len / 6.5, 1); t.needsUpdate = true; laneTexCache[k] = t; }
  return laneTexCache[k];
}
export const texChevron = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = 'rgba(20,60,10,0.85)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#a6ff3b'; g.lineWidth = 18; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(30, 22); g.lineTo(84, 64); g.lineTo(30, 106); g.stroke();
}, 3, 1);
export const texChevron1 = texChevron.clone(); texChevron1.repeat.set(1, 1); texChevron1.needsUpdate = true;
const texChecker = canvasTex(128, 32, (g, w, h) => {
  const s = 16;
  for (let y = 0; y < h / s; y++) for (let x = 0; x < w / s; x++) { g.fillStyle = (x + y) % 2 ? '#0b0d14' : '#f4f6ff'; g.fillRect(x * s, y * s, s, s); }
});
const texHazard = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.fillStyle = '#111';
  for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + 64, 64); g.lineTo(i * 32 + 64, 64); g.fill(); }
}, 6, 1);
const texHazard1 = texHazard.clone(); texHazard1.repeat.set(3, 1); texHazard1.needsUpdate = true;
function radialTex(stops) {
  const t = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
export const texGlow = radialTex([[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
export const texDot = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
const texOil = radialTex([[0, 'rgba(10,8,18,0.95)'], [0.55, 'rgba(25,15,50,0.92)'], [0.8, 'rgba(90,60,255,0.55)'], [1, 'rgba(90,60,255,0)']]);
const texSlot = canvasTex(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.setLineDash([18, 12]);
  g.strokeRect(10, 10, w - 20, h - 20);
  g.setLineDash([]); g.lineWidth = 12; g.lineCap = 'round';
  g.beginPath(); g.moveTo(64, 40); g.lineTo(64, 88); g.moveTo(40, 64); g.lineTo(88, 64); g.stroke();
});
texSlot.wrapS = texSlot.wrapT = THREE.ClampToEdgeWrapping;
const texIce = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#bff1ff'); gr.addColorStop(1, '#7fd3f5');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
  for (let i = 0; i < 14; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rnd(-40, 40); y += rnd(-40, 40); g.lineTo(x, y); } g.stroke(); }
}, 3, 1);
export const texWind = canvasTex(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(210,248,255,0.95)'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(34, 26); g.lineTo(80, 64); g.lineTo(34, 102); g.stroke();
}, 2, 4);

// ----------------------------------------------------------- materiais
export const M = {
  floor: new THREE.MeshLambertMaterial({ color: 0x232842 }),
  floorBridge: new THREE.MeshLambertMaterial({ color: 0x3b3f5c }),
  ramp: new THREE.MeshLambertMaterial({ color: 0xff8a1f, emissive: 0x401800 }),
  wall: new THREE.MeshLambertMaterial({ color: 0xff2e88, emissive: 0x3a0820 }),
  wallCap: new THREE.MeshBasicMaterial({ color: 0xffa0d0 }),
  edge: new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
  edgeY: new THREE.MeshBasicMaterial({ color: 0xffd23f }),
  block: new THREE.MeshLambertMaterial({ color: 0xff2020, emissive: 0x4a0000 }),
  white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  bumper: new THREE.MeshLambertMaterial({ color: 0xff2e88, emissive: 0x500020 }),
  bumperRing: new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
  spinBar: new THREE.MeshLambertMaterial({ map: texHazard1, emissive: 0x302000 }),
  pad: new THREE.MeshBasicMaterial({ map: texChevron, transparent: true, opacity: 0.95 }),
  pad1: new THREE.MeshBasicMaterial({ map: texChevron1, transparent: true, opacity: 0.95 }),
  oil: new THREE.MeshBasicMaterial({ map: texOil, transparent: true, depthWrite: false }),
  checker: new THREE.MeshBasicMaterial({ map: texChecker }),
  hazard: new THREE.MeshLambertMaterial({ map: texHazard }),
  post: new THREE.MeshLambertMaterial({ color: 0xe8ecff }),
  slot: new THREE.MeshBasicMaterial({ map: texSlot, color: 0x00e5ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  ice: new THREE.MeshLambertMaterial({ map: texIce, emissive: 0x1a3a4a }),
  bump: new THREE.MeshLambertMaterial({ color: 0xff9a1f, emissive: 0x3a1800 }),
  wind: new THREE.MeshBasicMaterial({ map: texWind, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
  piston: new THREE.MeshLambertMaterial({ color: 0xff3030, emissive: 0x4a0000 })
};
const laneMats = {};
function laneMat(len) { const k = len.toFixed(1); if (!laneMats[k]) laneMats[k] = new THREE.MeshLambertMaterial({ map: laneTex(len) }); return laneMats[k]; }

// --------------------------------------------------- abismo neon (cenário)
const SCN = {};
{
  const grid = new THREE.GridHelper(2400, 120, 0xff2e88, 0x3a1a7a);
  grid.position.y = -48; grid.material.transparent = true; grid.material.opacity = 0.55; scene.add(grid);
  SCN.grid = grid;
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ color: 0xff3a00, transparent: true, opacity: 0.32, fog: false }));
  lava.rotation.x = -Math.PI / 2; lava.position.y = -55; lava.visible = false; scene.add(lava);
  SCN.lava = lava;
  const n = 90, geo = new THREE.BoxGeometry(1, 1, 1);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const pal = [0x00e5ff, 0xff2e88, 0x7a3cff, 0xa6ff3b, 0xffd23f];
  for (let i = 0; i < n; i++) {
    const s = rnd(2, 9), x = rnd(-320, 320), z = rnd(-320, 320), y = rnd(-90, -22);
    q.setFromEuler(new THREE.Euler(rnd(0, 3), rnd(0, 3), rnd(0, 3)));
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * rnd(1, 3), s));
    inst.setMatrixAt(i, m4); inst.setColorAt(i, col.setHex(pal[i % pal.length]).multiplyScalar(0.55));
  }
  scene.add(inst);
  SCN.inst = inst;
  const sp = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) { sp[i * 3] = rnd(-500, 500); sp[i * 3 + 1] = rnd(-160, 120); sp[i * 3 + 2] = rnd(-500, 500); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfaaff, size: 1.2, map: texDot, transparent: true, depthWrite: false, fog: false })));
}

// ----------------------------------------------------- temas do abismo
export const THEMES = {
  neon: { name: 'NEON', bg: 0x07031a, grid: [0xff2e88, 0x3a1a7a], cubes: [0x00e5ff, 0xff2e88, 0x7a3cff, 0xa6ff3b, 0xffd23f], ground: 0x3a1450, lava: false },
  gelo: { name: 'GELO', bg: 0x06141f, grid: [0x9be8ff, 0x1d4a66], cubes: [0xffffff, 0x9be8ff, 0x5ab8ff, 0xd8f6ff, 0x7fd0ff], ground: 0x1d4a66, lava: false },
  lava: { name: 'LAVA', bg: 0x170402, grid: [0xff5a1a, 0x5a1408], cubes: [0xff3b1a, 0xff8a1f, 0xffd23f, 0x9a1a08, 0xff5a1a], ground: 0x5a1408, lava: true }
};
export let themeKey = 'neon';
export function applyTheme(k) {
  const T = THEMES[k] || THEMES.neon; themeKey = THEMES[k] ? k : 'neon';
  scene.background.setHex(T.bg); scene.fog.color.setHex(T.bg); hemi.groundColor.setHex(T.ground);
  scene.remove(SCN.grid); SCN.grid.geometry.dispose();
  const grid = new THREE.GridHelper(2400, 120, T.grid[0], T.grid[1]);
  grid.position.y = -48; grid.material.transparent = true; grid.material.opacity = 0.55; scene.add(grid); SCN.grid = grid;
  const col = new THREE.Color();
  for (let i = 0; i < SCN.inst.count; i++) SCN.inst.setColorAt(i, col.setHex(T.cubes[i % T.cubes.length]).multiplyScalar(0.55));
  SCN.inst.instanceColor.needsUpdate = true;
  SCN.lava.visible = T.lava;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', '#' + new THREE.Color(T.bg).getHexString());
}

// ----------------------------------------------------- helpers de malha
export function box(w, h, d, mat, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  parent.add(m); return m;
}
export function strip(x1, z1, x2, z2, y, w, h, mat, parent) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = box(len, h, w, mat, (x1 + x2) / 2, y, (z1 + z2) / 2, parent, false);
  m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  return m;
}
export function sector(cz, rIn, rOut, a0, a1, yTop, thick, mat, parent, shadow = true) {
  const s = new THREE.Shape(), cw = a1 < a0;
  s.moveTo(Math.cos(a0) * rOut, cz + Math.sin(a0) * rOut);
  s.absarc(0, cz, rOut, a0, a1, cw);
  s.lineTo(Math.cos(a1) * rIn, cz + Math.sin(a1) * rIn);
  s.absarc(0, cz, rIn, a1, a0, !cw);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(Math.PI / 2); g.translate(0, yTop, 0);
  const m = new THREE.Mesh(g, mat);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  parent.add(m); return m;
}
export function straightBase(g, s0, s1, walls = true, laneM = null) {
  const len = s1 - s0, cx = (s0 + s1) / 2;
  box(len, 1, 2 * HW, M.floor, cx, -0.5, 0, g);
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(len, 2 * HW), laneM || laneMat(len));
  pl.rotation.x = -Math.PI / 2; pl.position.set(cx, 0.012, 0); pl.receiveShadow = true; g.add(pl);
  box(len, 0.06, 0.22, M.edge, cx, 0.03, HW - 0.11, g, false);
  box(len, 0.06, 0.22, M.edge, cx, 0.03, -HW + 0.11, g, false);
  const wf = Array.isArray(walls) ? walls : [walls, walls];       // [esquerda, direita]
  for (const sd of [-1, 1]) if (wf[sd < 0 ? 0 : 1]) {
    box(len, WALL_H, 0.5, M.wall, cx, WALL_H / 2, sd * (HW + 0.25), g);
    box(len, 0.08, 0.54, M.wallCap, cx, WALL_H + 0.04, sd * (HW + 0.25), g, false);
  }
  box(len, 0.12, 0.12, M.edge, cx, -1.0, HW, g, false);
  box(len, 0.12, 0.12, M.edge, cx, -1.0, -HW, g, false);
}
export function disposeGroup(g) {
  if (!g) return;
  if (g.parent) g.parent.remove(g);
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}
