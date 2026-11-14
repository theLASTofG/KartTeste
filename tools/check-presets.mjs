// Valida as pistas iniciais (js/presets.js) sem abrir o jogo: node tools/check-presets.mjs
// Reproduz a geometria de células de Piece/layoutTypes (js/track.js) e confere sobreposição, slots dos obstáculos e andares.
import { PRESETS } from '../js/presets.js';
import { DIRS, EXIT_TYPES, ITEMS, MEGA, PT, PROFILES, SLOTS } from '../js/config.js';

const EXIT_TOKEN = /^x([0-3]):(\w+)$/;
function mk(type, ci, cj, dir, baseH) {
  const def = PT[type]; if (!def) throw new Error('tipo desconhecido: ' + type);
  const p = { type, ci, cj, dir, baseH, def, nextH: baseH + (def.dh || 0), special: def.special || null };
  const [dx, dz] = DIRS[dir], fx = dx, fz = dz, rx = -fz, rz = fx;
  p.turn = def.curve || 0;
  p.exitDir = p.turn ? (dir + p.turn + 4) % 4 : dir;
  p.cells = p.turn ? [[ci, cj]] : Array.from({ length: def.cells }, (_, k) => [ci + dx * k, cj + dz * k]);
  const last = p.cells[p.cells.length - 1], ed = DIRS[p.exitDir];
  p.next = [last[0] + ed[0], last[1] + ed[1]];
  if (p.special === 'funnel') {
    p.cells = []; for (let row = 0; row < 2; row++) for (let col = -1; col <= 2; col++) p.cells.push([ci + dx * row + rx * col, cj + dz * row + rz * col]);
    p.next = [ci + dx * 2, cj + dz * 2];
  } else if (p.special === 'spiral') {
    p.exitDir = (dir + 2) % 4; p.cells = [[ci, cj], [ci + rx, cj + rz]]; p.next = [ci + rx - dx, cj + rz - dz];
  } else if (p.special === 'serp') {
    p.exitDir = (dir + 2) % 4; p.cells = [[ci, cj], [ci + dx, cj + dz], [ci + rx, cj + rz], [ci + dx + rx, cj + dz + rz]]; p.next = [ci + rx - dx, cj + rz - dz];
  } else if (p.special === 'mega') {
    p.cells = []; for (let row = 0; row < 3; row++) for (let col = -1; col <= 2; col++) p.cells.push([ci + dx * row + rx * col, cj + dz * row + rz * col]);
    p.exitCells = [0, 1, 2, 3].map(k => [ci + dx * 3 + rx * (k - 1), cj + dz * 3 + rz * (k - 1)]); p.next = p.exitCells[1];
  }
  p.nslots = (SLOTS[type] || []).length;
  return p;
}
function layout(types) {
  const arr = [], ex = [null, null, null, null], main = [];
  for (const t of types) { const m = EXIT_TOKEN.exec(t); if (m) ex[+m[1]] = m[2]; else if (t !== 'megafunnel') main.push(t); }
  let ci = 0, cj = 0, dir = 0, bh = 0;
  for (const t of main) {
    const p = mk(t, ci, cj, dir, bh); arr.push(p);
    ci = p.next[0]; cj = p.next[1]; dir = p.exitDir; bh = p.nextH;
    if (p.special !== 'mega') continue;
    const [dx, dz] = DIRS[p.dir];
    for (let k = 0; k < 4; k++) {
      let [c0, c1] = p.exitCells[k], left = MEGA.branchCells, first = true;
      const add = type => { const x = mk(type, c0, c1, p.dir, p.nextH); x.lane = k; arr.push(x); c0 = x.next[0]; c1 = x.next[1]; left -= x.def.cells; };
      if (ex[k] && EXIT_TYPES.includes(ex[k])) add(ex[k]);
      while (left > 0) add('straight');
    }
    const [ec0, ec1] = p.exitCells[1];
    const fn = mk('megafunnel', ec0 + dx * MEGA.branchCells, ec1 + dz * MEGA.branchCells, p.dir, p.nextH); arr.push(fn);
    ci = fn.next[0]; cj = fn.next[1]; dir = fn.exitDir; bh = fn.nextH;
  }
  return arr;
}
const spanOf = p => [p.baseH, Math.max(p.baseH, p.nextH) + 0.6 + (p.special === 'serp' ? 5 : 0) + ((PROFILES[p.type] || []).some(g => g[2] === 'ramp') ? 6 : 0)];

let bad = 0;
for (const [key, P] of Object.entries(PRESETS)) {
  const errs = [];
  try {
    if (P.types[0] !== 'start') errs.push('não começa em start');
    if (P.types[P.types.length - 1] !== 'finish') errs.push('não termina em finish');
    const arr = layout(P.types), occ = new Map();
    arr.forEach((p, i) => {
      for (const c of p.cells) {
        const k = c.join(',');
        for (const q of occ.get(k) || []) {
          const [a0, a1] = spanOf(arr[q]), [b0, b1] = spanOf(p);
          const diffFloor = !(b0 > a1 + 4.5 || a0 > b1 + 4.5);
          if (diffFloor || !P.cross) errs.push(`célula ${k}: peça ${q} (${arr[q].type}) x peça ${i} (${p.type})`);
        }
        if (!occ.has(k)) occ.set(k, []); occ.get(k).push(i);
      }
    });
    for (const o of P.obs) {
      const [pi, si] = o.key.split(':').map(Number), p = arr[pi];
      if (!p) errs.push(`obstáculo ${o.key}: peça inexistente`);
      else if (si >= p.nslots) errs.push(`obstáculo ${o.key}: ${p.type} só tem ${p.nslots} espaço(s)`);
      if (!ITEMS[o.type] || ITEMS[o.type].kind !== 'obs') errs.push(`obstáculo ${o.key}: tipo inválido ${o.type}`);
    }
    const seen = new Set(); for (const o of P.obs) { if (seen.has(o.key)) errs.push('obstáculo repetido ' + o.key); seen.add(o.key); }
    const xs = [...occ.keys()].map(k => k.split(',').map(Number));
    const w = Math.max(...xs.map(c => c[0])) - Math.min(...xs.map(c => c[0])) + 1, h = Math.max(...xs.map(c => c[1])) - Math.min(...xs.map(c => c[1])) + 1;
    console.log(`${errs.length ? '✗' : '✓'} ${key.padEnd(12)} ${String(arr.length).padStart(2)} peças · ${w}x${h} células · final a ${arr[arr.length - 1].baseH} m`);
  } catch (e) { errs.push(e.message); console.log('✗', key); }
  for (const e of errs) console.log('    -', e);
  if (errs.length) bad++;
}
console.log(bad ? `\n${bad} pista(s) com problema` : `\nTodas as ${Object.keys(PRESETS).length} pistas OK`);
process.exit(bad ? 1 : 0);
