// Peças de pista (classe Piece) e montagem da pista.
import * as THREE from 'three';
import { G, hooks } from './state.js';
import { clamp, lerp, store, wrapA } from './utils.js';
import { BARRIERS, bridgeHW, bumpH, bumpSlope, CELL, DIRS, FINISH_S, GRID_SLOTS, HOLES, HW, PAD, PROFILES, profileSeg, PT, RAMP_PADS, RC, SIDE_WALLS, SLOTS, WALL_H } from './config.js';
import { box, disposeGroup, M, scene, sector, straightBase, strip } from './scene.js';

// ------------------------------------------------------------- peças
export const tmpW = {};
class Piece {
  constructor(type, ci, cj, dir) {
    this.type = type; this.def = PT[type]; this.ci = ci; this.cj = cj; this.dir = dir;
    this.a = dir * Math.PI / 2;
    this.fx = Math.round(Math.cos(this.a)); this.fz = Math.round(Math.sin(this.a));
    this.rx = -this.fz; this.rz = this.fx;
    this.ex = ci * CELL - this.fx * CELL / 2; this.ez = cj * CELL - this.fz * CELL / 2;
    this.turn = this.def.curve || 0;
    if (this.turn) {
      this.len = RC * Math.PI / 2;
      this.cx = this.ex + this.rx * RC * this.turn; this.cz = this.ez + this.rz * RC * this.turn;
      this.a0 = Math.atan2(this.ez - this.cz, this.ex - this.cx);
      this.exitDir = (dir + this.turn + 4) % 4;
    } else { this.len = this.def.cells * CELL; this.exitDir = dir; }
    const [dx, dz] = DIRS[dir];
    this.cells = [];
    if (this.turn) this.cells.push([ci, cj]);
    else for (let k = 0; k < this.def.cells; k++) this.cells.push([ci + dx * k, cj + dz * k]);
    const last = this.cells[this.cells.length - 1], ed = DIRS[this.exitDir];
    this.next = [last[0] + ed[0], last[1] + ed[1]];
    this.slots = (SLOTS[type] || []).map(([s, v]) => ({ s, v }));
    this.windDir = ((ci + cj) & 1) ? 1 : -1;         // lado do vento: determinístico pela posição (igual para todos)
    this.group = null;
  }
  world(s, v, o) {
    if (this.turn) {
      const th = s / RC, ang = this.a0 + th * this.turn, d = RC - v * this.turn;
      o.x = this.cx + Math.cos(ang) * d; o.z = this.cz + Math.sin(ang) * d; o.a = this.a + th * this.turn;
    } else { o.x = this.ex + this.fx * s + this.rx * v; o.z = this.ez + this.fz * s + this.rz * v; o.a = this.a; }
    return o;
  }
  query(x, z, o) {
    if (this.turn) {
      const qx = x - this.cx, qz = z - this.cz, d = Math.hypot(qx, qz) || 1e-6;
      const th = wrapA(Math.atan2(qz, qx) - this.a0) * this.turn;
      o.s = th * RC; o.v = (RC - d) * this.turn;
      const ha = this.a + th * this.turn; o.fx = Math.cos(ha); o.fz = Math.sin(ha);
    } else {
      const dx = x - this.ex, dz = z - this.ez;
      o.s = dx * this.fx + dz * this.fz; o.v = dx * this.rx + dz * this.rz; o.fx = this.fx; o.fz = this.fz;
    }
    o.rx = -o.fz; o.rz = o.fx;
    let hw = HW, h = 0, slope = 0, floor = true, wl = true, wr = true, ice = false, wind = 0;
    const s = o.s, t = this.type;
    if (this.turn) { wl = this.turn > 0; wr = this.turn < 0; }
    else if (t === 'bridge') { hw = bridgeHW(s); wl = wr = false; }
    else if (PROFILES[t]) {
      const g = profileSeg(t, s);
      if (g[2] === 'gap') { floor = false; wl = wr = false; }
      else if (g[2] === 'ramp') { const k = clamp((s - g[0]) / (g[1] - g[0]), 0, 1); h = lerp(g[3], g[4], k); slope = (g[4] - g[3]) / (g[1] - g[0]); }
    }
    else if (t === 'bumps') { h = bumpH(s); slope = bumpSlope(s); }
    else if (t === 'ice') ice = true;
    else if (t === 'wind') { wind = this.windDir; if (wind > 0) wr = false; else wl = false; }
    else if (t === 'holes') {
      wl = wr = false;
      for (const hl of HOLES) if (s > hl.s0 && s < hl.s1 && o.v > hl.v0 && o.v < hl.v1) { floor = false; break; }
    }
    if (!SIDE_WALLS) wl = wr = false;
    o.hw = hw; o.h = h; o.slope = slope; o.wallL = wl; o.wallR = wr; o.ice = ice; o.wind = wind;
    o.floor = floor && Math.abs(o.v) <= hw;
    return o;
  }
  build() {
    const g = new THREE.Group();
    g.position.set(this.ex, 0, this.ez); g.rotation.y = -this.a;
    const t = this.type, L = this.len;
    if (this.turn) {
      const tn = this.turn, cz = RC * tn, a0 = -tn * Math.PI / 2, a1 = 0, rO = RC + HW;
      sector(cz, RC - HW, RC + HW, a0, a1, 0, 1, M.floor, g);
      sector(cz, RC + HW - 0.22, RC + HW, a0, a1, 0.06, 0.06, M.edge, g, false);
      sector(cz, RC - HW, RC - HW + 0.22, a0, a1, 0.06, 0.06, M.edgeY, g, false);
      if (SIDE_WALLS) {
        sector(cz, rO, rO + 0.5, a0, a1, WALL_H, WALL_H, M.wall, g);
        sector(cz, rO - 0.02, rO + 0.52, a0, a1, WALL_H + 0.08, 0.08, M.wallCap, g, false);
      }
      sector(cz, RC + HW - 0.06, RC + HW + 0.06, a0, a1, -0.94, 0.12, M.edge, g, false);
      sector(cz, RC - HW - 0.06, RC - HW + 0.06, a0, a1, -0.94, 0.12, M.edge, g, false);
      for (let k = 0; k < 3; k++) {
        const th = (k + 0.5) / 3 * Math.PI / 2, ang = a0 + th * tn;
        const m = box(2.8, 0.02, 0.32, M.white, Math.cos(ang) * RC, 0.015, cz + Math.sin(ang) * RC, g, false);
        m.rotation.y = -(th * tn);
      }
    } else if (PROFILES[t]) {                          // rampas/buracos montados a partir do perfil
      let lastH = 3;
      for (const [s0, s1, kind, h0, h1] of PROFILES[t]) {
        if (kind === 'flat') straightBase(g, s0, s1, true);
        else if (kind === 'ramp') {
          const rs = new THREE.Shape(); rs.moveTo(s0, h0 - 1); rs.lineTo(s0, h0); rs.lineTo(s1, h1); rs.lineTo(s1, h1 - 1);
          const rg = new THREE.ExtrudeGeometry(rs, { depth: 2 * HW, bevelEnabled: false }); rg.translate(0, 0, -HW);
          const rm = new THREE.Mesh(rg, M.ramp); rm.castShadow = rm.receiveShadow = true; g.add(rm);
          if (SIDE_WALLS) for (const sd of [-1, 1]) {
            const ws = new THREE.Shape(); ws.moveTo(s0, h0); ws.lineTo(s1, h1); ws.lineTo(s1, h1 + WALL_H); ws.lineTo(s0, h0 + WALL_H);
            const wg = new THREE.ExtrudeGeometry(ws, { depth: 0.5, bevelEnabled: false }); wg.translate(0, 0, sd > 0 ? HW : -HW - 0.5);
            const wm = new THREE.Mesh(wg, M.wall); wm.castShadow = true; g.add(wm);
          }
          box(0.9, 0.08, 2 * HW, M.hazard, s1 - 0.5, h1 - 0.05, 0, g, false).rotation.z = Math.atan((h1 - h0) / (s1 - s0));
          lastH = h1;
        } else {                                       // buraco: setas flutuando + faixa de perigo no pouso
          for (let k = 0; k < 3; k++) {
            const x = s0 + (s1 - s0) * (k + 0.7) / 3.5;
            for (const sd of [-1, 1]) strip(x - 1, sd * 1.4, x + 0.4, 0, lastH + 2.4, 0.3, 0.3, M.edgeY, g);
          }
          box(1.2, 0.05, 2 * HW, M.hazard, s1 + 0.6, 0.03, 0, g, false);
        }
      }
      const rp = RAMP_PADS[t], r0 = PROFILES[t][0];
      if (rp) {                                        // turbo inclinado na rampa (Mega Salto)
        const pg = new THREE.Group(), mid = (rp[0] + rp[1]) / 2, k = r0[4] / r0[1];
        pg.position.set(mid, mid * k + 0.04, 0); pg.rotation.z = Math.atan(k);
        const pd = new THREE.Mesh(new THREE.PlaneGeometry(rp[1] - rp[0], 2 * PAD.hv), M.pad);
        pd.rotation.x = -Math.PI / 2; pg.add(pd); g.add(pg);
      }
    } else if (t === 'holes') {
      const sh = new THREE.Shape();
      sh.moveTo(0, -HW); sh.lineTo(L, -HW); sh.lineTo(L, HW); sh.lineTo(0, HW); sh.lineTo(0, -HW);
      for (const hl of HOLES) {
        const v0 = Math.max(-HW + 0.01, hl.v0), v1 = Math.min(HW - 0.01, hl.v1);
        const hp = new THREE.Path(); hp.moveTo(hl.s0, v0); hp.lineTo(hl.s0, v1); hp.lineTo(hl.s1, v1); hp.lineTo(hl.s1, v0); hp.lineTo(hl.s0, v0);
        sh.holes.push(hp);
        for (const [a, b] of [[[hl.s0, v0], [hl.s1, v0]], [[hl.s1, v0], [hl.s1, v1]], [[hl.s1, v1], [hl.s0, v1]], [[hl.s0, v1], [hl.s0, v0]]])
          strip(a[0], a[1], b[0], b[1], 0.04, 0.2, 0.08, M.edgeY, g);
      }
      const hg = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); hg.rotateX(Math.PI / 2);
      const hm = new THREE.Mesh(hg, M.floorBridge); hm.castShadow = hm.receiveShadow = true; g.add(hm);
      for (const sd of [-1, 1]) { box(L, 0.06, 0.22, M.edgeY, L / 2, 0.03, sd * (HW - 0.11), g, false); box(0.2, 2.4, 0.2, M.post, 0.6, 1.2, sd * (HW + 0.6), g); box(0.15, 0.9, 1.4, M.hazard, 0.6, 2.4, sd * (HW + 0.6), g); }
    } else if (t === 'bridge') {
      const sh = new THREE.Shape(), pts = [];
      for (let s = 0; s <= L + 0.01; s += 2) pts.push([s, bridgeHW(s)]);
      sh.moveTo(0, -HW);
      for (const p of pts) sh.lineTo(p[0], -p[1]);
      for (let i = pts.length - 1; i >= 0; i--) sh.lineTo(pts[i][0], pts[i][1]);
      const bg = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); bg.rotateX(Math.PI / 2);
      const bm = new THREE.Mesh(bg, M.floorBridge); bm.castShadow = bm.receiveShadow = true; g.add(bm);
      for (let i = 0; i < pts.length - 1; i++) for (const sd of [-1, 1]) {
        const a = pts[i], b = pts[i + 1];
        strip(a[0], sd * (a[1] - 0.12), b[0], sd * (b[1] - 0.12), 0.04, 0.24, 0.08, M.edgeY, g);
      }
      box(L - 16, 0.02, 0.3, M.white, L / 2, 0.012, 0, g, false);
      for (const s of [10, L - 10]) box(1.2, 30, 1.2, M.post, s, -16, 0, g, false);
      for (const sd of [-1, 1]) { box(0.2, 2.4, 0.2, M.post, 0.6, 1.2, sd * (HW + 0.6), g); box(0.15, 0.9, 1.4, M.hazard, 0.6, 2.4, sd * (HW + 0.6), g); }
    } else {
      const wallsLR = t === 'wind' ? (this.windDir > 0 ? [true, false] : [false, true]) : true;
      straightBase(g, 0, L, wallsLR, t === 'ice' ? M.ice : null);
      if (t === 'bumps') {
        const bs = new THREE.Shape();
        bs.moveTo(2, -0.01);
        for (let s = 2; s <= 24.001; s += 0.5) bs.lineTo(s, bumpH(s));
        bs.lineTo(24, -0.01);
        const bg = new THREE.ExtrudeGeometry(bs, { depth: 2 * HW - 0.1, bevelEnabled: false }); bg.translate(0, 0, -HW + 0.05);
        const bm = new THREE.Mesh(bg, M.bump); bm.castShadow = bm.receiveShadow = true; g.add(bm);
      } else if (t === 'wind') {
        const wg = new THREE.Group(); wg.position.set(L / 2, 0.035, 0); wg.rotation.y = -this.windDir * Math.PI / 2;
        const wp = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW - 1, L - 4), M.wind); wp.rotation.x = -Math.PI / 2; wg.add(wp); g.add(wg);
        for (const s of [7, 19]) {                     // ventiladores do lado de onde vem o vento
          const zf = -this.windDir * (HW + 1.1);
          box(1.2, 2.6, 1.6, M.post, s, 1.3, zf, g);
          box(1.25, 1.8, 0.1, M.edge, s, 1.4, zf + this.windDir * 0.82, g, false);
        }
        for (let k = 0; k < 6; k++) box(1.4, 0.05, 0.25, M.edgeY, 3 + k * 4, 0.04, this.windDir * (HW - 0.2), g, false);
      } else if (t === 'chicane') {                    // barreiras alternadas com faixa de perigo
        for (const b of BARRIERS) {
          const w = b.v1 - b.v0, vc = (b.v0 + b.v1) / 2;
          box(1.2, 1.4, w, M.wall, b.s, 0.7, vc, g);
          box(1.24, 0.1, w, M.wallCap, b.s, 1.45, vc, g, false);
          box(1.26, 0.45, w + 0.02, M.hazard, b.s, 0.75, vc, g, false);
        }
      }
      if (t === 'boost') {
        const pd = new THREE.Mesh(new THREE.PlaneGeometry(PAD.s1 - PAD.s0, 2 * PAD.hv), M.pad);
        pd.rotation.x = -Math.PI / 2; pd.position.set((PAD.s0 + PAD.s1) / 2, 0.03, 0); g.add(pd);
        for (const sd of [-1, 1]) box(PAD.s1 - PAD.s0, 0.05, 0.2, M.edgeY, (PAD.s0 + PAD.s1) / 2, 0.04, sd * (PAD.hv + 0.1), g, false);
      } else if (t === 'start') {
        box(0.6, 1.4, 2 * HW + 1, M.wall, 0.3, 0.7, 0, g);
        for (const sl of GRID_SLOTS) box(0.12, 0.02, 2.0, M.white, sl[0] - 1.4, 0.02, sl[1], g, false);
        const st = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2 * HW), M.checker);
        st.rotation.x = -Math.PI / 2; st.position.set(L - 1, 0.02, 0); g.add(st);
      } else if (t === 'finish') {
        const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2 * HW), M.checker);
        fl.rotation.x = -Math.PI / 2; fl.rotation.z = Math.PI / 2; fl.position.set(FINISH_S, 0.025, 0); g.add(fl);
        for (const sd of [-1, 1]) box(0.6, 5.4, 0.6, M.post, FINISH_S, 2.7, sd * (HW + 0.7), g);
        box(0.5, 1.3, 2 * HW + 2, M.checker, FINISH_S, 5.6, 0, g);
        box(0.8, 1.4, 2 * HW + 1, M.hazard, L - 0.4, 0.7, 0, g);
      }
    }
    this.group = g;
    return g;
  }
}

// ------------------------------------------------------------- pista
export let track = [], pieceStart = [], occupied = new Set(), finishGlobal = 0;
export let obstacles = [];                       // {key,type,pi,si,x,z,y,a,s,v,ph,spd,group,bar,pulse}
export const trackRoot = new THREE.Group(); scene.add(trackRoot);
export const slotGroup = new THREE.Group(); scene.add(slotGroup);
export const INITIAL_TYPES = ['start', 'straight', 'straight', 'finish'];
// pistas iniciais que o host escolhe no lobby
export const PRESETS = {
  curta: { name: 'CURTA', types: INITIAL_TYPES, obs: [] },
  media: { name: 'MÉDIA', types: ['start', 'straight', 'curveL', 'boost', 'curveR', 'jump', 'straight', 'finish'],
    obs: [{ key: '1:2', type: 'mboost', ph: 0, spd: 1.7 }, { key: '6:0', type: 'block', ph: 0, spd: 1.7 }] },
  caos: { name: 'CAÓTICA', types: ['start', 'bumps', 'curveR', 'bridge', 'curveL', 'ice', 'wind', 'curveL', 'holes', 'straight', 'finish'],
    obs: [{ key: '2:0', type: 'bumper', ph: 0, spd: 1.7 }, { key: '5:2', type: 'spinner', ph: 0.7, spd: 1.6 }, { key: '9:0', type: 'piston', ph: 1.3, spd: 1.5 }, { key: '9:1', type: 'oil', ph: 0, spd: 1.7 }] }
};
G.presetKey = store.get('preset', 'curta');
if (!PRESETS[G.presetKey]) G.presetKey = 'curta';
const key = (i, j) => i + ',' + j;
export let dropAnims = [];
function layoutTypes(types) {
  const arr = []; let ci = 0, cj = 0, dir = 0;
  for (const t of types) { const p = new Piece(t, ci, cj, dir); arr.push(p); ci = p.next[0]; cj = p.next[1]; dir = p.exitDir; }
  return arr;
}
function recalcTrack() {
  pieceStart = []; let s = 0;
  for (const p of track) { pieceStart.push(s); s += p.len; }
  finishGlobal = pieceStart[track.length - 1] + FINISH_S;
  occupied = new Set();
  for (const p of track) for (const c of p.cells) occupied.add(key(c[0], c[1]));
}
export const trackTypes = () => track.map(p => p.type);
export function addDrop(g, delay, piece) { g.position.y += 30; dropAnims.push({ g, t: -delay, dur: 0.7, y0: g.position.y, yEnd: g.position.y - 30, piece, landed: false }); }
// aplica a pista (tipos em sequência) + obstáculos; anima peças/obstáculos novos
export function applyTrack(types, obsList, animate) {
  const cur = trackTypes();
  const same = cur.length === types.length && cur.every((t, i) => t === types[i]);
  if (!same) {
    const cb = cur.slice(0, -1), nb = types.slice(0, -1);
    const prefix = cur.length > 0 && cb.length < nb.length && cb.every((t, i) => t === nb[i]);
    if (prefix) {
      const fin = track.pop(); disposeGroup(fin.group);
      const all = layoutTypes(types);
      for (let i = track.length; i < all.length; i++) {
        const p = all[i], g = p.build(); trackRoot.add(g); track.push(p);
        if (animate) addDrop(g, (i - cb.length) * 0.12, p);
      }
    } else {
      for (const p of track) disposeGroup(p.group);
      for (const o of obstacles) disposeGroup(o.group);
      obstacles = [];
      track = layoutTypes(types);
      for (const p of track) trackRoot.add(p.build());
    }
    recalcTrack();
  }
  hooks.syncObstacles(obsList || [], animate);
  hooks.rebuildSlots();
}
export function canPlace(type) {
  const fin = track[track.length - 1];
  const p = new Piece(type, fin.ci, fin.cj, fin.dir);
  const occ = new Set(occupied); occ.delete(key(fin.ci, fin.cj));
  for (const c of p.cells) if (occ.has(key(c[0], c[1]))) return false;
  if (occ.has(key(p.next[0], p.next[1]))) return false;
  for (const c of p.cells) occ.add(key(c[0], c[1]));
  const f = new Piece('finish', p.next[0], p.next[1], p.exitDir);
  occ.add(key(f.ci, f.cj));
  const nx = [f.next, ...[1, 3].map(t => { const d = DIRS[(f.dir + t) % 4]; return [f.ci + d[0], f.cj + d[1]]; })];
  return nx.some(c => !occ.has(key(c[0], c[1])));
}
export function pieceAt(sG) { let i = track.length - 1; while (i > 0 && pieceStart[i] > sG) i--; return i; }
export function trackPoint(sG, v, o) { const i = pieceAt(sG), p = track[i]; return p.world(clamp(sG - pieceStart[i], 0, p.len), v, o); }
