// Peças especiais: Serpentina Elevada (caminho 3D por polilinha) e Mega Pista (plataforma com 4 saídas).
// Coordenadas locais da peça: ls = ao longo da direção de entrada, lv = lateral (para a direita); y = altura.
import * as THREE from 'three';
import { MEGA, SERP, SPIRAL, HW, CELL } from './config.js';
import { clamp, lerp, wrapA } from './utils.js';
import { box, M } from './scene.js';

const matFloor = new THREE.MeshLambertMaterial({ color: 0x232842, side: THREE.DoubleSide });
const matEdge = new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide });
const matEdgeY = new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide });
const arcMats = MEGA.colors.map(c => new THREE.MeshBasicMaterial({ color: c }));
const glowMats = MEGA.colors.map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false }));

// ============================================================ SERPENTINA
const smooth = u => u * u * (3 - 2 * u);
function makeSerpPath() {
  const pts = [];
  for (let i = 0; i < SERP.N1; i++) {                                        // subida em S (duas curvas alternadas)
    const u = i / SERP.N1;
    pts.push({ ls: SERP.L1 * u, lv: SERP.A * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u), h: SERP.H * smooth(u) });
  }
  for (let i = 0; i < SERP.N2; i++) {                                        // retorno de 180° no topo (h = 5)
    const th = Math.PI * i / (SERP.N2 - 1);
    pts.push({ ls: SERP.L1 + SERP.R * Math.sin(th), lv: SERP.R * (1 - Math.cos(th)), h: SERP.H });
  }
  for (let i = 1; i <= SERP.N3; i++) {                                       // descida reta de volta até h = 0 (sai no sentido oposto)
    const u = i / SERP.N3;
    pts.push({ ls: SERP.L1 - SERP.L3 * u, lv: 2 * SERP.R, h: SERP.H * (1 - smooth(u)) });
  }
  pts[0].ps = 0;
  for (let i = 1; i < pts.length; i++) pts[i].ps = pts[i - 1].ps + Math.hypot(pts[i].ls - pts[i - 1].ls, pts[i].lv - pts[i - 1].lv);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    pts[i].ang = Math.atan2(b.lv - a.lv, b.ls - a.ls);
    pts[i].sl = (b.h - a.h) / ((b.ps - a.ps) || 1);                 // inclinação por amostra (interpolada: sem degraus que virariam "decolagem")
  }
  return pts;
}
export const SERP_PATH = makeSerpPath();
export const SERP_LEN = SERP_PATH[SERP_PATH.length - 1].ps;
// ---- Espiral de Andar: reta + meia-volta (raio 13) + reta de volta, subindo SPIRAL.H m de forma suave (novo andar)
function makeSpiralPath() {
  const pts = [], R = SPIRAL.R, S = SPIRAL.S;
  for (let i = 0; i < SPIRAL.N1; i++) pts.push({ ls: S * i / SPIRAL.N1, lv: 0 });                    // reta de entrada
  for (let i = 0; i < SPIRAL.N2; i++) { const th = Math.PI * i / (SPIRAL.N2 - 1); pts.push({ ls: S + R * Math.sin(th), lv: R * (1 - Math.cos(th)) }); }
  for (let i = 1; i <= SPIRAL.N3; i++) pts.push({ ls: S - S * i / SPIRAL.N3, lv: 2 * R });            // reta de volta (sai no sentido oposto)
  pts[0].ps = 0;
  for (let i = 1; i < pts.length; i++) pts[i].ps = pts[i - 1].ps + Math.hypot(pts[i].ls - pts[i - 1].ls, pts[i].lv - pts[i - 1].lv);
  const L = pts[pts.length - 1].ps;
  for (const p of pts) p.h = SPIRAL.H * smooth(p.ps / L);
  return finishPath(pts);
}
function finishPath(pts) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    pts[i].ang = Math.atan2(b.lv - a.lv, b.ls - a.ls);
    pts[i].sl = (b.h - a.h) / ((b.ps - a.ps) || 1);                 // inclinação por amostra (interpolada: sem degraus que virariam "decolagem")
  }
  return pts;
}
export const SPIRAL_PATH = makeSpiralPath();
export const SPIRAL_LEN = SPIRAL_PATH[SPIRAL_PATH.length - 1].ps;

// ---- funções genéricas sobre uma polilinha 3D (serpentina e espiral)
export function pathWorld(P, len, p, s, v, o) {
  s = clamp(s, 0, len);
  let i = 0; while (i < P.length - 2 && P[i + 1].ps < s) i++;
  const A = P[i], B = P[i + 1], t = (s - A.ps) / ((B.ps - A.ps) || 1);
  const ang = A.ang + wrapA(B.ang - A.ang) * t;
  const ls = lerp(A.ls, B.ls, t) - v * Math.sin(ang), lv = lerp(A.lv, B.lv, t) + v * Math.cos(ang);
  o.x = p.ex + p.fx * ls + p.rx * lv; o.z = p.ez + p.fz * ls + p.rz * lv; o.a = p.a + ang;
  return o;
}
// segmento mais próximo da polilinha (2D). Nas pontas aceita extrapolação para o s sair de [0, len] e trocar de peça
export function pathQuery(P, p, x, z, o) {
  const dx = x - p.ex, dz = z - p.ez, ls = dx * p.fx + dz * p.fz, lv = dx * p.rx + dz * p.rz;
  let bi = 0, bd = 1e18, bt = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const A = P[i], B = P[i + 1], ex = B.ls - A.ls, ev = B.lv - A.lv, l2 = ex * ex + ev * ev;
    let t = ((ls - A.ls) * ex + (lv - A.lv) * ev) / l2;
    if (!(i === 0 && t < 0) && !(i === P.length - 2 && t > 1)) t = clamp(t, 0, 1);
    const qx = A.ls + ex * t - ls, qv = A.lv + ev * t - lv, d = qx * qx + qv * qv;
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  const A = P[bi], B = P[bi + 1], ex = B.ls - A.ls, ev = B.lv - A.lv, sl = Math.hypot(ex, ev);
  const tl = ex / sl, tv = ev / sl, nl = -tv, nv = tl;                       // normal à direita
  const pl = A.ls + ex * bt, pv = A.lv + ev * bt;
  o.s = A.ps + (B.ps - A.ps) * bt;
  o.v = (ls - pl) * nl + (lv - pv) * nv;
  o.fx = tl * p.fx + tv * p.rx; o.fz = tl * p.fz + tv * p.rz; o.rx = -o.fz; o.rz = o.fx;
  const k = clamp(bt, 0, 1);
  o.h = lerp(A.h, B.h, k); o.slope = lerp(A.sl, B.sl, k);
  o.hw = HW; o.wallL = o.wallR = false; o.ice = false; o.wind = 0;
  o.floor = Math.abs(o.v) <= HW;
  return o;
}
export const serpWorld = (p, s, v, o) => pathWorld(SERP_PATH, SERP_LEN, p, s, v, o);
export const serpQuery = (p, x, z, o) => pathQuery(SERP_PATH, p, x, z, o);
export const spiralWorld = (p, s, v, o) => pathWorld(SPIRAL_PATH, SPIRAL_LEN, p, s, v, o);
export const spiralQuery = (p, x, z, o) => pathQuery(SPIRAL_PATH, p, x, z, o);
// fita 3D ao longo da polilinha (piso com espessura, bordas neon, travessas nas curvas e pilares até o abismo)
function pathBuild(P, p, arcFrom, arcTo) {
  const g = new THREE.Group(); g.position.set(p.ex, 0, p.ez); g.rotation.y = -p.a;
  const n = P.length, top = [], bot = [], idx = [];
  const nrm = i => [-Math.sin(P[i].ang), Math.cos(P[i].ang)];
  for (let i = 0; i < n; i++) {
    const [nl, nv] = nrm(i);
    for (const sd of [-1, 1]) {
      top.push(P[i].ls + nl * HW * sd, P[i].h, P[i].lv + nv * HW * sd);
      bot.push(P[i].ls + nl * HW * sd, P[i].h - 1, P[i].lv + nv * HW * sd);
    }
  }
  const pos = top.concat(bot);
  for (let i = 0; i < n - 1; i++) {
    const a = 2 * i, b = 2 * i + 1, c = 2 * i + 2, d = 2 * i + 3, off = 2 * n;
    idx.push(a, b, d, a, d, c);
    idx.push(off + a, off + d, off + b, off + a, off + c, off + d);
    idx.push(a, c, off + c, a, off + c, off + a);
    idx.push(b, off + b, off + d, b, off + d, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, matFloor); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
  for (const sd of [-1, 1]) {
    const ep = [], ei = [];
    for (let i = 0; i < n; i++) {
      const [nl, nv] = nrm(i);
      for (const w of [HW - 0.22, HW]) ep.push(P[i].ls + nl * w * sd, P[i].h + 0.04, P[i].lv + nv * w * sd);
    }
    for (let i = 0; i < n - 1; i++) { const a = 2 * i; ei.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)); eg.setIndex(ei);
    g.add(new THREE.Mesh(eg, sd < 0 ? matEdgeY : matEdge));
  }
  for (let i = arcFrom; i < arcTo; i += 3) {
    const m = box(0.7, 0.06, HW * 1.5, M.edgeY, P[i].ls, P[i].h + 0.05, P[i].lv, g, false); m.rotation.y = -P[i].ang;
  }
  for (let i = 0; i < n; i += 5) if (P[i].h + p.baseH > 0.6) {          // pilares até o abismo (inclui a altura do andar)
    const topY = P[i].h - 1, hgt = topY + 30 + p.baseH;
    box(1.4, hgt, 1.4, M.post, P[i].ls, topY - hgt / 2, P[i].lv, g);
  }
  return g;
}
export const serpBuild = p => pathBuild(SERP_PATH, p, SERP.N1, SERP.N1 + SERP.N2);
export const spiralBuild = p => pathBuild(SPIRAL_PATH, p, SPIRAL.N1, SPIRAL.N1 + SPIRAL.N2);

// ============================================================ MEGA PISTA
const lvOf = v => v + MEGA.shift;
export function megaWorld(p, s, v, o) {
  const lv = lvOf(v);
  o.x = p.ex + p.fx * s + p.rx * lv; o.z = p.ez + p.fz * s + p.rz * lv; o.a = p.a; return o;
}
export function megaBounds(s) { const t = clamp(s / MEGA.taper, 0, 1); return [-HW + (MEGA.lvMin + HW) * t, HW + (MEGA.lvMax - HW) * t]; }
export function megaBumpH(s) {
  let h = 0, sl = 0;
  for (const c of MEGA.bumps) {
    const d = s - c;
    if (Math.abs(d) < MEGA.bumpHalf) { const x = Math.PI * d / (2 * MEGA.bumpHalf); h += MEGA.bumpH * Math.cos(x) ** 2; sl += -MEGA.bumpH * Math.sin(2 * x) * Math.PI / (2 * MEGA.bumpHalf); }
  }
  return [h, sl];
}
export function megaQuery(p, x, z, o) {
  const dx = x - p.ex, dz = z - p.ez, s = dx * p.fx + dz * p.fz, lv = dx * p.rx + dz * p.rz;
  o.s = s; o.v = lv - MEGA.shift; o.fx = p.fx; o.fz = p.fz; o.rx = p.rx; o.rz = p.rz;
  const [lo, hi] = megaBounds(s), [h, sl] = megaBumpH(s);
  o.h = h; o.slope = sl; o.hw = MEGA.hw; o.wallL = o.wallR = false; o.wind = 0;
  o.ice = false;
  for (const z2 of MEGA.ice) if (s > z2.s0 && s < z2.s1 && lv > z2.l0 && lv < z2.l1) o.ice = true;
  o.floor = s >= 0 && s <= MEGA.len && lv >= lo && lv <= hi;
  return o;
}
function prism(poly, y0, y1, mat, g) {
  const n = poly.length, pos = [];
  for (const [a, b] of poly) pos.push(a, y1, b);
  for (const [a, b] of poly) pos.push(a, y0, b);
  const idx = [];
  for (let i = 1; i < n - 1; i++) { idx.push(0, i, i + 1); idx.push(n, n + i + 1, n + i); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + j, i, n + j, n + i); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m;
}
export function megaBuild(p) {
  const g = new THREE.Group(); g.position.set(p.ex, 0, p.ez); g.rotation.y = -p.a;
  const L = MEGA.len, T = MEGA.taper;
  prism([[0, -HW], [T, MEGA.lvMin], [L, MEGA.lvMin], [L, MEGA.lvMax], [T, MEGA.lvMax], [0, HW]], -1, 0, matFloor, g);
  for (const z of MEGA.ice) {                                                 // gelo nas saídas 0 e 3
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(z.s1 - z.s0, z.l1 - z.l0), M.ice); pl.rotation.x = -Math.PI / 2;
    pl.position.set((z.s0 + z.s1) / 2, 0.025, (z.l0 + z.l1) / 2); g.add(pl);
  }
  for (const z of MEGA.pads) {                                                // piso turbo
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(z.s1 - z.s0, z.l1 - z.l0), M.pad1); pl.rotation.x = -Math.PI / 2;
    pl.position.set((z.s0 + z.s1) / 2, 0.035, (z.l0 + z.l1) / 2); g.add(pl);
  }
  const lw = MEGA.lvMax - MEGA.lvMin;
  for (const c of MEGA.bumps) {                                               // lombadas
    const sh = new THREE.Shape(); sh.moveTo(-MEGA.bumpHalf, 0);
    for (let k = -MEGA.bumpHalf; k <= MEGA.bumpHalf + 1e-6; k += 0.25) sh.lineTo(k, MEGA.bumpH * Math.cos(Math.PI * k / (2 * MEGA.bumpHalf)) ** 2);
    sh.lineTo(MEGA.bumpHalf, 0);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: lw, bevelEnabled: false }); bg.translate(0, 0, MEGA.lvMin);
    const bm = new THREE.Mesh(bg, M.bump); bm.position.set(c, 0.01, 0); bm.castShadow = true; g.add(bm);
  }
  for (const b of MEGA.bumpers) {                                             // bumpers de mola fixos
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 1.2, 20), M.bumper); cyl.position.set(b.s, 0.6, b.l); cyl.castShadow = true; g.add(cyl);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.16, 8, 24), M.bumperRing); ring.rotation.x = Math.PI / 2; ring.position.set(b.s, 1.22, b.l); g.add(ring);
  }
  for (const [l0, l1] of MEGA.gaps) {                                         // barreiras entre as saídas
    const w = l1 - l0, c = (l0 + l1) / 2, sl = MEGA.gapS[1] - MEGA.gapS[0], sc = (MEGA.gapS[0] + MEGA.gapS[1]) / 2;
    box(sl, 1.4, w, M.wall, sc, 0.7, c, g); box(sl + 0.04, 0.1, w + 0.04, M.wallCap, sc, 1.45, c, g, false);
  }
  for (let k = 0; k < 4; k++) {                                               // arcos coloridos nas saídas
    const lv = MEGA.exitLv[k], hs = HW + 1;
    for (const sd of [-1, 1]) box(0.5, 4.4, 0.5, arcMats[k], L - 0.5, 2.2, lv + sd * hs, g, false);
    box(0.5, 0.5, 2 * hs + 0.5, arcMats[k], L - 0.5, 4.4, lv, g, false);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(8, 2 * hs), glowMats[k]); gl.rotation.x = -Math.PI / 2; gl.position.set(L - 4.5, 0.05, lv); g.add(gl);
  }
  box(L - T, 0.06, 0.3, M.edge, (L + T) / 2, 0.03, MEGA.lvMin + 0.15, g, false);
  box(L - T, 0.06, 0.3, M.edge, (L + T) / 2, 0.03, MEGA.lvMax - 0.15, g, false);
  for (const [s, lv] of [[0, HW], [0, -HW], [L, MEGA.lvMin], [L, MEGA.lvMax], [T + 20, MEGA.lvMin], [T + 20, MEGA.lvMax]]) box(1.4, 30, 1.4, M.post, s, -16, lv, g);
  return g;
}

// ============================================================ FUNIL (4 faixas -> 1 pista)
export const FUNNEL_LEN = MEGA.funnelLen;
export function funnelBounds(s) {
  const t = smooth(clamp(s / FUNNEL_LEN, 0, 1));
  return [MEGA.lvMin + (-HW - MEGA.lvMin) * t, MEGA.lvMax + (HW - MEGA.lvMax) * t];
}
export const funnelWorld = (p, s, v, o) => megaWorld(p, s, v, o);
export function funnelQuery(p, x, z, o) {
  const dx = x - p.ex, dz = z - p.ez, s = dx * p.fx + dz * p.fz, lv = dx * p.rx + dz * p.rz;
  o.s = s; o.v = lv - MEGA.shift; o.fx = p.fx; o.fz = p.fz; o.rx = p.rx; o.rz = p.rz;
  const [lo, hi] = funnelBounds(s);
  o.h = 0; o.slope = 0; o.hw = MEGA.hw; o.wallL = o.wallR = false; o.wind = 0; o.ice = false;
  o.floor = s >= 0 && s <= FUNNEL_LEN && lv >= lo && lv <= hi;
  return o;
}
// faixa 3D entre duas listas de pontos [ls, lv]
function ribbon(Lp, Rp, y0, y1, mat, g) {
  const n = Lp.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) pos.push(Lp[i][0], y1, Lp[i][1], Rp[i][0], y1, Rp[i][1]);
  if (y0 !== y1) for (let i = 0; i < n; i++) pos.push(Lp[i][0], y0, Lp[i][1], Rp[i][0], y0, Rp[i][1]);
  for (let i = 0; i < n - 1; i++) {
    const a = 2 * i, b = a + 1, c = a + 2, d = a + 3, o = 2 * n;
    idx.push(a, b, d, a, d, c);
    if (y0 !== y1) { idx.push(o + a, o + d, o + b, o + a, o + c, o + d, a, c, o + c, a, o + c, o + a, b, o + b, o + d, b, o + d, d); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m;
}
export function funnelBuild(p) {
  const g = new THREE.Group(); g.position.set(p.ex, 0, p.ez); g.rotation.y = -p.a;
  const N = 26, Lp = [], Rp = [];
  for (let i = 0; i <= N; i++) { const s = FUNNEL_LEN * i / N, [lo, hi] = funnelBounds(s); Lp.push([s, lo]); Rp.push([s, hi]); }
  ribbon(Lp, Rp, -1, 0, matFloor, g);
  const edgeL = Lp.map(([s, lo]) => [s, lo + 0.35]), edgeR = Rp.map(([s, hi]) => [s, hi - 0.35]);   // guias neon nas bordas anguladas
  ribbon(Lp.map(q => [q[0], q[1]]), edgeL.map((q, i) => [q[0], q[1]]), 0.04, 0.04, matEdgeY, g);
  ribbon(edgeR, Rp, 0.04, 0.04, matEdge, g);
  const P = MEGA.funnelPad;                                                  // piso turbo central na saída
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(P.s1 - P.s0, P.l1 - P.l0), M.pad1); pl.rotation.x = -Math.PI / 2;
  pl.position.set((P.s0 + P.s1) / 2, 0.035, (P.l0 + P.l1) / 2); g.add(pl);
  for (let k = 0; k < 4; k++) for (let s = 8; s < FUNNEL_LEN - 6; s += 10) {   // setas apontando para o centro, em cada faixa
    const t0 = smooth(s / FUNNEL_LEN), t1 = smooth((s + 1) / FUNNEL_LEN), lv0 = MEGA.exitLv[k] * (1 - t0), lv1 = MEGA.exitLv[k] * (1 - t1);
    const m = box(2.6, 0.05, 0.55, M.edgeY, s, 0.05, lv0, g, false); m.rotation.y = -Math.atan2(lv1 - lv0, 1);
  }
  for (const [s, lv] of [[0, MEGA.lvMin], [0, MEGA.lvMax], [FUNNEL_LEN, -HW], [FUNNEL_LEN, HW]]) box(1.4, 30, 1.4, M.post, s, -16, lv, g);
  return g;
}
export const CELL_SZ = CELL;
