// Malha dos carros, jogadores e registro de carros.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, rnd, store } from './utils.js';
import { BOT_NAMES, MAXP, PALETTE } from './config.js';
import { box, scene, texGlow } from './scene.js';

// --------------------------------------------------------------- carros
function makeCarMesh(color, isLocal) {
  const root = new THREE.Group(); root.rotation.order = 'YZX';
  const body = new THREE.Group(); root.add(body);
  const col = new THREE.Color(color);
  const mBody = new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.12) });
  const mDark = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.4) });
  const mGlass = new THREE.MeshLambertMaterial({ color: 0x0d1424, emissive: 0x0a1838 });
  box(2.2, 0.42, 1.24, mBody, 0, 0.47, 0, body);
  box(0.55, 0.26, 1.05, mBody, 1.25, 0.4, 0, body);
  box(2.24, 0.12, 1.28, mDark, 0, 0.3, 0, body);
  box(0.98, 0.44, 0.98, mGlass, -0.15, 0.88, 0, body);
  box(0.74, 0.08, 0.92, mBody, -0.2, 1.12, 0, body);
  box(0.3, 0.07, 1.4, mDark, -1.06, 1.08, 0, body);
  for (const z of [-0.42, 0.42]) box(0.1, 0.36, 0.08, mDark, -1.0, 0.86, z, body, false);
  const mHead = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  const mTail = new THREE.MeshBasicMaterial({ color: 0x8a1020 });
  for (const z of [-0.4, 0.4]) { box(0.06, 0.12, 0.26, mHead, 1.53, 0.42, z, body, false); box(0.06, 0.12, 0.3, mTail, -1.12, 0.5, z, body, false); }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 8),
    new THREE.MeshBasicMaterial({ color: isLocal ? 0x66f6ff : 0xffa030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.z = Math.PI / 2; flame.position.set(-1.7, 0.45, 0); flame.visible = false; body.add(flame);
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flameCore.rotation.z = Math.PI / 2; flameCore.position.set(-1.45, 0.45, 0); flameCore.visible = false; body.add(flameCore);
  const wheels = [];
  const tg = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12); tg.rotateX(Math.PI / 2);
  const mTire = new THREE.MeshLambertMaterial({ color: 0x15151c });
  const mHub = new THREE.MeshLambertMaterial({ color: 0xdfe6f5 });
  for (const [x, z, front] of [[0.74, 0.66, 1], [0.74, -0.66, 1], [-0.74, 0.66, 0], [-0.74, -0.66, 0]]) {
    const piv = new THREE.Group(); piv.position.set(x, 0.34, z); root.add(piv);
    const spin = new THREE.Group(); piv.add(spin);
    const tire = new THREE.Mesh(tg, mTire); tire.castShadow = true; spin.add(tire);
    spin.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.3), mHub));
    wheels.push({ piv, spin, front });
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4),
    new THREE.MeshBasicMaterial({ map: texGlow, color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05; root.add(glow);
  let marker = null;
  if (isLocal) {
    marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    marker.rotation.x = Math.PI; marker.position.y = 2.3; root.add(marker);
  }
  root.visible = false;
  return { root, body, wheels, flame, flameCore, mTail, marker, glow };
}

// ---------------------------------------------------- jogadores / rede
G.myName = store.get('name', '') || ('Piloto' + Math.floor(rnd(10, 99)));
G.myDevice = store.get('device', (('ontouchstart' in window) || navigator.maxTouchPoints > 0) ? 'mobile' : 'pc');
G.players = [];                    // [{id,name,color,device,bot,score,connected}]
G.myId = 0; G.nextId = 1; G.botCount = 4;
export const cars = [], carById = new Map();
export const NET = { role: 'none', peer: null, conns: new Map(), host: null, hostFast: null, fastPending: new Map(), code: '', joinTimer: 0 };
export const isHost = () => NET.role === 'host' || NET.role === 'solo';
export const isMP = () => NET.role === 'host' || NET.role === 'client';
export const playerById = id => G.players.find(p => p.id === id);
export const plist = () => G.players.map(p => ({ id: p.id, name: p.name, color: p.color, device: p.device, bot: p.bot, score: p.score, connected: p.connected }));

function createCar(p) {
  const c = {
    pid: p.id, name: p.name, color: p.color, mesh: makeCarMesh(p.color, p.id === G.myId), isLocal: p.id === G.myId, owned: false, bot: p.bot,
    ai: { skill: p.bot ? rnd(0.9, 0.99) : 0.92, lane: 0, wob: 0, wf: rnd(0.6, 1.4), ph: rnd(0, 6), side: Math.random() < 0.5 ? 1 : -1, err: null },
    inp: { steer: 0, throttle: 0, brake: 0, drift: false, gasRaw: false }, Q: {}, net: null,
    x: 0, y: 0, z: 0, a: 0, vx: 0, vy: 0, vz: 0, vf: 0, vl: 0, alive: true, finished: false, finishOrder: 0, prog: 0, pi: 0, grounded: true, voidFall: false,
    item: null, itemReadyAt: 0, itemRollEnd: 0, itemCool: 0, pickCool: 0, freezeT: 0, slowT: 0, stunT: 0, spinT: 0, spinDir: 1, immuneT: 0
  };
  c.ai.wob = 0.3 + (1 - c.ai.skill) * 5;
  scene.add(c.mesh.root);
  return c;
}
export function syncCars() {
  for (const p of G.players) {
    let c = carById.get(p.id);
    if (c && c.isLocal !== (p.id === G.myId)) { scene.remove(c.mesh.root); cars.splice(cars.indexOf(c), 1); carById.delete(p.id); c = null; }
    if (!c) { c = createCar(p); cars.push(c); carById.set(p.id, c); }
    c.name = p.name; c.bot = p.bot;
  }
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    if (!G.players.some(p => p.id === c.pid)) { scene.remove(c.mesh.root); cars.splice(i, 1); carById.delete(c.pid); }
  }
  cars.sort((a, b) => G.players.findIndex(p => p.id === a.pid) - G.players.findIndex(p => p.id === b.pid));
  for (const c of cars) c.owned = c.isLocal || (isHost() && c.bot);
}
export function myCar() { return carById.get(G.myId); }
export function freeColor() { return PALETTE.find(c => !G.players.some(p => p.color === c)) || PALETTE[G.players.length % PALETTE.length]; }
export function applyBots() {                          // host: ajusta a quantidade de bots no lobby
  G.players = G.players.filter(p => !p.bot);
  G.botCount = clamp(G.botCount, 0, MAXP - G.players.length);
  for (let k = 0; k < G.botCount; k++) {
    const used = new Set(G.players.map(p => p.name));
    const nm = BOT_NAMES.find(n => !used.has(n)) || ('Bot' + k);
    G.players.push({ id: G.nextId++, name: nm, color: freeColor(), device: 'bot', bot: true, score: 0, connected: true });
  }
}
