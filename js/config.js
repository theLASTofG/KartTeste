// Constantes do jogo: física, pontuação, peças de pista, obstáculos e cartas.
import { G } from './state.js';
import { clamp, lerp } from './utils.js';

// ------------------------------------------------------------ constantes
export const CELL = 26, HW = 6.5, RC = CELL / 2;         // HW = meia-largura da pista (m)
export const WALL_H = 0.9, CAR_R = 1.05, GRAV = 26, FINISH_S = 7, MAXP = 8;
// muretas laterais das pistas comuns (visual E física). Chicane, obstáculos, largada e chegada têm barreiras próprias.
export const SIDE_WALLS = false;
export const MAX_DEATHS = 3;          // vidas por rodada: quedas no abismo antes de ser eliminado
export const TARGET_OPTS = [1000, 2500, 5000, 10000];
G.TARGET = 10000;                       // meta de pontos (o host escolhe no lobby)
export const fmtPts = n => n.toLocaleString('pt-BR');
export const SUBSTEP = 1 / 120, NET_DT = 1 / 20;      // 20 envios/s de estado (a interpolação cobre o resto)
const INTERP_MS = 90;                          // atraso de interpolação dos carros remotos (buffer anti-tranco)
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const PH = {
  maxSpeed: 27, maxRev: 8, accel: 30, brake: 44, revAccel: 16, coast: 2.4, coastK: 0.17,        // solta o acelerador: perde velocidade mais suave
  turn: 2.7, grip: 12, gripDrift: 3.8, gripOil: 1.4, overDecay: 2.2, boostAccel: 70, airTurn: 0.5
};
// Gêiser: ciclo determinístico de 3 fases pelo relógio da rodada (ph = defasagem em segundos). Só a fase 1 (erupção) lança o carro.
export const GEY = { warn: 1.1, erupt: 1.8, rest: 2.5, radius: 2.1, height: 15, launch: 13 };
GEY.cycle = GEY.warn + GEY.erupt + GEY.rest;
// out = { st: 0 aviso | 1 erupção | 2 repouso, k: progresso 0..1 da fase }
export function geyserState(ph, tc, out) {
  let t = (tc + ph) % GEY.cycle; if (t < 0) t += GEY.cycle;
  if (t < GEY.warn) { out.st = 0; out.k = t / GEY.warn; }
  else if (t < GEY.warn + GEY.erupt) { out.st = 1; out.k = (t - GEY.warn) / GEY.erupt; }
  else { out.st = 2; out.k = (t - GEY.warn - GEY.erupt) / GEY.rest; }
  return out;
}
// Armadilhas livres: Bola de Demolição (pêndulo) e Barreira. L = corrente, R = raio da esfera, H = altura do pivô, maxAng = amplitude (rad)
export const WRECK = { L: 6.5, R: 1.3, H: 7.8, maxAng: 1.08, hit: 2.2, knock: 17, cool: 0.9, barrierLen: 7.4, barrierW: 0.9 };
// Corredor de Gêiseres (armadilha livre, 1 rodada): 70 m de comprimento x ~13 m de largura, ~30 gêiseres em 3 trechos.
// [u ao longo do corredor, w lateral, ph defasagem em s]: slalom (pares alternados) -> centro + bordas -> onda sequencial (1,0 s entre gêiseres).
export const GSTRIP = { len: 70, w: 13, list: [] };
{
  const L = GSTRIP.list, cyc = GEY.cycle;
  for (let k = 0; k < 3; k++) { const u = -31.5 + k * 7, a = k % 2; L.push([u, -2.6, a ? 2.7 : 0], [u, 2.6, a ? 0 : 2.7]); }                            // slalom
  for (let k = 0; k < 3; k++) { const u = -10.5 + k * 7; L.push([u, -4.6, (k * 1.8) % cyc], [u, 0, (k * 1.8 + 2.7) % cyc], [u, 4.6, (k * 1.8 + 1.35) % cyc]); }   // centro + bordas
  [14, 22.75, 31.5].forEach((u, r) => [-5.2, -2.6, 0, 2.6, 5.2].forEach((w, j) => L.push([u, w, ((r % 2 ? 4 - j : j) * 1.0 + r * 0.6) % cyc])));        // onda
}
export const JUMP = { vy: 9.5, cool: 1.0 };                     // pulo: ~1,7 m de altura, ~0,7 s no ar, recarga de 1 s
// ajuda de borda (pistas sem mureta): perto da borda, a velocidade PARA FORA é amortecida; batida forte/arremesso ainda derruba
export const EDGE = { band: 1.4, k: 9, maxOut: 10 };
export const DRIFT = {
  minSpeed: 10.5, stopSpeed: 6.5, T: [0.55, 1.2, 2.0], pow: [0.25, 0.38, 0.52], dur: [0.7, 1.0, 1.4], kick: [3, 5, 7.5],
  col: [[0.23, 0.63, 1], [1, 0.6, 0.12], [0.82, 0.3, 1]], css: ['#3aa0ff', '#ff9a1f', '#d24bff'],
  name: ['MINI TURBO', 'SUPER TURBO', 'ULTRA TURBO!']
};
export const PAD = { pow: 0.42, dur: 1.0, kick: 4, s0: 8, s1: 18, hv: HW * 0.65 };
// perfis de rampa/buraco por peça: [s0, s1, tipo, h0, h1] (data-driven: rampa, buraco e trecho plano)
export const PROFILES = {
  jump: [[0, 18, 'ramp', 0, 3], [18, 29, 'gap'], [29, 52, 'flat']],
  bigjump: [[0, 24, 'ramp', 0, 5], [24, 44, 'gap'], [44, 78, 'flat']],
  doublejump: [[0, 12, 'ramp', 0, 2.4], [12, 21, 'gap'], [21, 40, 'flat'], [40, 52, 'ramp', 0, 2.4], [52, 61, 'gap'], [61, 78, 'flat']],
  // Salto Curto: 1 célula, rampinha + buraco pequeno | Salto Triplo: 3 rampinhas seguidas (3 células)
  minijump: [[0, 9, 'ramp', 0, 1.8], [9, 14, 'gap'], [14, 26, 'flat']],
  tripjump: [[0, 8, 'ramp', 0, 1.6], [8, 13, 'gap'], [13, 26, 'flat'], [26, 34, 'ramp', 0, 1.6], [34, 39, 'gap'], [39, 52, 'flat'], [52, 60, 'ramp', 0, 1.6], [60, 65, 'gap'], [65, 78, 'flat']]
};
export const RAMP_PADS = { bigjump: [2, 12] };                // Mega Salto tem turbo embutido na rampa
export const profileSeg = (t, s) => { const p = PROFILES[t]; if (!p) return null; for (const g of p) if (s < g[1]) return g; return p[p.length - 1]; };
// chicane: barreiras alternadas (s, faixa lateral v0..v1) que obrigam o zigue-zague
export const BARRIERS = [{ s: 12, v0: -HW, v1: -1.2 }, { s: 26, v0: 1.2, v1: HW }, { s: 40, v0: -HW, v1: -1.2 }];
export const HOLES = [{ s0: 10, s1: 16, v0: -HW - 0.1, v1: -0.8 }, { s0: 24, s1: 30, v0: 0.8, v1: HW + 0.1 }, { s0: 38, s1: 44, v0: -2.2, v1: 2.2 }];
export const WIND_ACC = 8;                       // empurrão lateral do vento (m/s²)
export const bumpH = s => (s > 2 && s < 24) ? 0.55 * Math.pow(Math.sin(Math.PI * (s - 2) / 5.5), 2) : 0;
export const bumpSlope = s => (s > 2 && s < 24) ? 0.55 * Math.PI / 5.5 * Math.sin(2 * Math.PI * (s - 2) / 5.5) : 0;
export const PTS = [300, 220, 150, 110, 80, 60, 45, 30];
export const PALETTE = ['#00e5ff', '#ff3b5c', '#ffd23f', '#7dff6b', '#c471ff', '#ff8a1f', '#ff6bd6', '#e8ecff'];
export const BOT_NAMES = ['Rex', 'Nova', 'Blaze', 'Viper', 'Turbo', 'Faísca', 'Bolt', 'Zíper'];
export const GRID_SLOTS = [[20, -4], [20, 0], [20, 4], [15, -4], [15, 0], [15, 4], [10, -4], [10, 0], [10, 3.9]];
export const PT = {
  start: { cells: 1 }, straight: { cells: 1 }, finish: { cells: 1 }, boost: { cells: 1 },
  curveL: { cells: 1, curve: -1 }, curveR: { cells: 1, curve: 1 }, jump: { cells: 2 }, bridge: { cells: 2 },
  bumps: { cells: 1 }, ice: { cells: 1 }, wind: { cells: 1 }, holes: { cells: 2 }, bigjump: { cells: 3 },
  chicane: { cells: 2 }, doublejump: { cells: 3 },
  minijump: { cells: 1 }, tripjump: { cells: 3 },
  minefield: { cells: 2 },                                   // 2 células com 21 espaços de mina (só em pistas prontas, não vira carta)
  curveIceL: { cells: 1, curve: -1, ice: true }, curveIceR: { cells: 1, curve: 1, ice: true },     // curvas de gelo: pouco atrito, freie antes
  serpentina: { cells: 4, special: 'serp' },        // ocupa 2x2 células: sobe em S, retorna 180° e desce (sai ao lado, no sentido oposto)
  megafunnel: { cells: 8, special: 'funnel' },        // automática: junta as 4 faixas da Mega Pista numa pista só (nunca vira carta)
  spiralup: { cells: 2, special: 'spiral', dh: 6 },  // meia-volta subindo +6 m: as peças seguintes (e a chegada) ficam no andar de cima
  megablock: { cells: 12, special: 'mega' }         // 3 células de comprimento x 4 de largura, com 4 saídas frontais
};
// espaços delimitados onde obstáculos podem ser posicionados (s ao longo, v lateral)
// Campo Minado: 7 fileiras de 2 minas deixando um corredor de ~3,3 m que serpenteia + 7 minas-isca nas laterais entre as fileiras
const MINE_ROWS = [[5, 0], [12, 2.4], [19, 3.6], [26, 1.2], [33, -2], [40, -3.6], [47, -1]];         // [s, centro do corredor]
const MINE_SLOTS = MINE_ROWS.flatMap(([s, g]) => [[s, clamp(g - 4.3, -5.8, 5.8)], [s, clamp(g + 4.3, -5.8, 5.8)]])
  .concat(MINE_ROWS.map(([s, g]) => [s + 3.5, g >= 0 ? -4.6 : 4.6]));
export const SLOTS = {
  minefield: MINE_SLOTS,
  straight: [[8, -3.1], [8, 3.1], [18, 0]], boost: [[22.5, -3.1], [22.5, 3.1]],
  curveL: [[RC * Math.PI / 4, 0]], curveR: [[RC * Math.PI / 4, 0]], jump: [[40, -2.9], [40, 2.9]],
  ice: [[8, -3.1], [8, 3.1], [18, 0]], wind: [[13, 0]], bigjump: [[66, -2.9], [66, 2.9]], doublejump: [[30, -2.9], [30, 2.9], [70, 0]],
  minijump: [[20, 0]], tripjump: [[19, 0], [45, 0], [71, 0]], curveIceL: [[RC * Math.PI / 4, 0]], curveIceR: [[RC * Math.PI / 4, 0]],
  start: [], finish: [], bridge: [], bumps: [], holes: [], chicane: [],
  serpentina: [[22, 0], [58, 0], [100, 0]], spiralup: [[8, 0], [34, 0], [58, 0]],
  megablock: [[16, -27], [16, 1], [34, -39], [34, 13], [50, -13], [62, 0]]       // v lateral já no eixo do bloco (centro = coluna do meio)
};
const ROAD = '<rect x="18" y="2" width="28" height="60" rx="3" fill="#2b3048" stroke="#00e5ff" stroke-width="2"/>';
// ---- Serpentina Elevada: caminho central (coordenadas locais: s ao longo da entrada, lv lateral p/ a direita)
export const SERP = { L1: 39, R: 13, L3: 39, H: 5, A: 4, N1: 26, N2: 28, N3: 18 };
// ---- Espiral de Andar: sobe H m (novo andar) em reta + meia-volta + reta; ocupa 2 células (sai ao lado, no sentido oposto)
export const SPIRAL = { S: 13, R: 13, H: 6, N1: 8, N2: 28, N3: 8 };
// ---- Mega Pista: plataforma 3x4 células; entrada na coluna 1 (lv=0) e 4 saídas em lv = -26, 0, 26, 52
// tudo derivado de HW: cada saída tem a largura da pista e 1 m de folga até a barreira
const MG = 1, MX = [-26, 0, 26, 52];
export const MEGA = {
  len: 78, shift: 13, hw: 45, taper: 20, lvMin: MX[0] - HW - MG, lvMax: MX[3] + HW + MG,
  exitLv: [-26, 0, 26, 52], exitV: [-39, -13, 13, 39],            // v centrado (v = lv - shift)
  gaps: [[MX[0] + HW + MG, MX[1] - HW - MG], [MX[1] + HW + MG, MX[2] - HW - MG], [MX[2] + HW + MG, MX[3] - HW - MG]], gapS: [73, 78],  // barreiras fixas entre as saídas
  ice: [{ s0: 30, s1: 76, l0: MX[0] - HW - MG, l1: MX[0] + HW + MG }, { s0: 30, s1: 76, l0: MX[3] - HW - MG, l1: MX[3] + HW + MG }],
  pads: [{ s0: 24, s1: 32, l0: -HW, l1: HW }, { s0: 58, s1: 64, l0: -HW, l1: HW }, { s0: 58, s1: 64, l0: 26 - HW, l1: 26 + HW }],
  bumps: [38, 52], bumpHalf: 2, bumpH: 0.5,                         // lombadas na largura toda
  bumpers: [{ s: 46, l: 13, r: 1.4 }, { s: 46, l: 39, r: 1.4 }],   // bumpers de mola fixos
  colors: [0x00e5ff, 0xff2e88, 0xa6ff3b, 0xffd23f],
  branchCells: 2,                                                    // as 4 faixas paralelas têm o mesmo comprimento (2 células = 52 m)
  funnelLen: 52, funnelPad: { s0: 34, s1: 46, l0: -HW, l1: HW }   // funil: 4 faixas -> 1 pista central, piso turbo na saída
};
// cartas aceitas nas 4 saídas (retas, sem curva, até 2 células; as de 1 célula ganham um trecho reto automático)
export const EXIT_TYPES = ['straight', 'boost', 'bumps', 'ice', 'wind', 'bridge', 'holes', 'chicane', 'jump', 'minijump'];
export const ITEMS = {
  straight: { kind: 'piece', name: 'Reta', w: 0.9, svg: ROAD + '<path d="M32 8 V20 M32 28 V40 M32 48 V58" stroke="#fff" stroke-width="3"/>' },
  boost: { kind: 'piece', name: 'Reta Turbo', w: 1.0, svg: ROAD + '<path d="M24 42 L32 32 L40 42 M24 28 L32 18 L40 28" stroke="#a6ff3b" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
  curveL: { kind: 'piece', name: 'Curva Esq.', w: 1.1, svg: '<path d="M32 64 L32 44 A14 14 0 0 0 18 30 L0 30" stroke="#2b3048" stroke-width="24" fill="none"/><path d="M32 64 L32 44 A14 14 0 0 0 18 30 L0 30" stroke="#00e5ff" stroke-width="2" stroke-dasharray="5 5" fill="none"/><path d="M45 50 A27 27 0 0 0 18 17" stroke="#ff2e88" stroke-width="4" fill="none"/>' },
  curveR: { kind: 'piece', name: 'Curva Dir.', w: 1.1, svg: '<path d="M32 64 L32 44 A14 14 0 0 1 46 30 L64 30" stroke="#2b3048" stroke-width="24" fill="none"/><path d="M32 64 L32 44 A14 14 0 0 1 46 30 L64 30" stroke="#00e5ff" stroke-width="2" stroke-dasharray="5 5" fill="none"/><path d="M19 50 A27 27 0 0 1 46 17" stroke="#ff2e88" stroke-width="4" fill="none"/>' },
  jump: { kind: 'piece', name: 'Rampa + Salto', w: 0.9, svg: '<path d="M2 50 L26 38 L26 54 L2 54Z" fill="#ff9a1f"/><rect x="40" y="46" width="24" height="8" fill="#2b3048" stroke="#00e5ff" stroke-width="1.5"/><path d="M26 36 Q36 14 46 42" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 4" fill="none"/>' },
  bridge: { kind: 'piece', name: 'Ponte Estreita', w: 0.8, svg: '<path d="M18 2 L46 2 L38 14 L38 50 L46 62 L18 62 L26 50 L26 14Z" fill="#3b3f5c" stroke="#ffd23f" stroke-width="2"/>' },
  bumps: { kind: 'piece', name: 'Lombadas', w: 0.9, svg: ROAD + '<path d="M18 14 Q32 6 46 14 M18 30 Q32 22 46 30 M18 46 Q32 38 46 46" stroke="#ff9a1f" stroke-width="5" fill="none"/>' },
  ice: { kind: 'piece', name: 'Pista de Gelo', w: 0.9, svg: '<rect x="18" y="2" width="28" height="60" rx="3" fill="#9be8ff" stroke="#fff" stroke-width="2"/><path d="M32 18 V46 M20 32 H44 M23 23 L41 41 M41 23 L23 41" stroke="#fff" stroke-width="3"/>' },
  wind: { kind: 'piece', name: 'Vento Lateral', w: 0.8, svg: ROAD + '<path d="M4 20 H40 M4 32 H48 M4 44 H40" stroke="#bdf3ff" stroke-width="4" stroke-linecap="round"/><path d="M40 14 L50 20 L40 26 M48 26 L58 32 L48 38" stroke="#bdf3ff" stroke-width="3" fill="none"/>' },
  holes: { kind: 'piece', name: 'Ponte Quebrada', w: 0.7, svg: '<rect x="18" y="2" width="28" height="60" fill="#3b3f5c" stroke="#ffd23f" stroke-width="2"/><rect x="18" y="12" width="12" height="9" fill="#07031a"/><rect x="34" y="29" width="12" height="9" fill="#07031a"/><rect x="26" y="46" width="12" height="9" fill="#07031a"/>' },
  bigjump: { kind: 'piece', name: 'Mega Salto', w: 0.6, svg: '<path d="M2 54 L24 32 L24 56 L2 56Z" fill="#ff2e88"/><path d="M6 50 L12 44" stroke="#a6ff3b" stroke-width="4"/><rect x="46" y="48" width="18" height="8" fill="#2b3048" stroke="#00e5ff" stroke-width="1.5"/><path d="M24 30 Q38 0 50 44" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 4" fill="none"/>' },
  serpentina: { kind: 'piece', name: 'Serpentina 180°', w: 1.1, svg: '<path d="M14 60 C14 46 34 50 34 40 C34 30 14 34 14 24 C14 12 36 8 48 14 C58 20 52 36 48 42 L48 58" stroke="#2b3048" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M14 60 C14 46 34 50 34 40 C34 30 14 34 14 24 C14 12 36 8 48 14 C58 20 52 36 48 42 L48 58" stroke="#00e5ff" stroke-width="2" stroke-dasharray="4 4" fill="none"/><path d="M42 50 L48 60 L54 50Z" fill="#a6ff3b"/><text x="30" y="8" font-size="9" font-weight="900" fill="#ffd23f" font-family="Arial Black,sans-serif">5m</text>' },
  spiralup: { kind: 'piece', name: 'Espiral Subindo', w: 0.9, svg: '<path d="M16 58 L16 40 A14 14 0 0 1 44 40 L44 22" stroke="#2b3048" stroke-width="12" fill="none"/><path d="M16 58 L16 40 A14 14 0 0 1 44 40 L44 22" stroke="#00e5ff" stroke-width="2" stroke-dasharray="4 4" fill="none"/><path d="M36 26 L44 12 L52 26Z" fill="#a6ff3b"/><text x="50" y="58" text-anchor="middle" font-size="12" font-weight="900" fill="#ffd23f" font-family="Arial Black,sans-serif">+6m</text>' },
  megablock: { kind: 'piece', name: 'Mega Pista 4x', w: 1.0, svg: '<rect x="6" y="26" width="52" height="34" rx="4" fill="#2b3048" stroke="#00e5ff" stroke-width="2"/><rect x="26" y="50" width="12" height="14" fill="#2b3048" stroke="#00e5ff" stroke-width="2"/><g fill="none" stroke-width="5" stroke-linecap="round"><path d="M10 26 V6" stroke="#00e5ff"/><path d="M24 26 V6" stroke="#ff2e88"/><path d="M40 26 V6" stroke="#a6ff3b"/><path d="M54 26 V6" stroke="#ffd23f"/></g><circle cx="32" cy="38" r="4" fill="#ff2e88"/><circle cx="18" cy="40" r="3" fill="#9be8ff"/><circle cx="46" cy="40" r="3" fill="#9be8ff"/>' },
  chicane: { kind: 'piece', name: 'Chicane', w: 0.9, svg: ROAD + '<path d="M18 16 H38 M26 32 H46 M18 48 H38" stroke="#ff2e88" stroke-width="5"/><path d="M42 58 L42 44 L22 40 L22 24 L42 20 L42 6" stroke="#a6ff3b" stroke-width="2" stroke-dasharray="3 3" fill="none"/>' },
  doublejump: { kind: 'piece', name: 'Salto Duplo', w: 0.7, svg: '<path d="M0 52 L12 44 L12 56 L0 56Z M32 52 L44 44 L44 56 L32 56Z" fill="#ff9a1f"/><rect x="20" y="50" width="10" height="6" fill="#2b3048"/><rect x="52" y="50" width="12" height="6" fill="#2b3048"/><path d="M12 42 Q18 26 22 48 M44 42 Q50 26 54 48" stroke="#fff" stroke-width="2" stroke-dasharray="3 3" fill="none"/>' },
  minijump: { kind: 'piece', name: 'Salto Curto', w: 1.0, svg: '<path d="M2 50 L18 42 L18 54 L2 54Z" fill="#ffb347"/><rect x="34" y="48" width="28" height="6" fill="#2b3048" stroke="#00e5ff" stroke-width="1.5"/><path d="M18 40 Q26 24 34 46" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 4" fill="none"/>' },
  tripjump: { kind: 'piece', name: 'Salto Triplo', w: 0.6, svg: '<path d="M0 52 L8 46 L8 56 L0 56Z M22 52 L30 46 L30 56 L22 56Z M44 52 L52 46 L52 56 L44 56Z" fill="#ff9a1f"/><rect x="12" y="52" width="8" height="4" fill="#2b3048"/><rect x="34" y="52" width="8" height="4" fill="#2b3048"/><rect x="56" y="52" width="8" height="4" fill="#2b3048"/><path d="M8 44 Q14 30 20 50 M30 44 Q36 30 42 50 M52 44 Q58 30 64 50" stroke="#fff" stroke-width="2" stroke-dasharray="3 3" fill="none"/>' },
  curveIceL: { kind: 'piece', name: 'Curva de Gelo Esq.', w: 0.7, svg: '<path d="M32 64 L32 44 A14 14 0 0 0 18 30 L0 30" stroke="#9be8ff" stroke-width="24" fill="none"/><path d="M32 64 L32 44 A14 14 0 0 0 18 30 L0 30" stroke="#fff" stroke-width="2" stroke-dasharray="5 5" fill="none"/><path d="M44 14 V30 M36 22 H52" stroke="#fff" stroke-width="3"/>' },
  curveIceR: { kind: 'piece', name: 'Curva de Gelo Dir.', w: 0.7, svg: '<path d="M32 64 L32 44 A14 14 0 0 1 46 30 L64 30" stroke="#9be8ff" stroke-width="24" fill="none"/><path d="M32 64 L32 44 A14 14 0 0 1 46 30 L64 30" stroke="#fff" stroke-width="2" stroke-dasharray="5 5" fill="none"/><path d="M20 14 V30 M12 22 H28" stroke="#fff" stroke-width="3"/>' },
  mine: { kind: 'obs', name: 'Mina', w: 0.9, svg: '<circle cx="32" cy="34" r="17" fill="#2a2a38" stroke="#ff5a2a" stroke-width="3"/><circle cx="32" cy="34" r="6" fill="#ff2020"/><path d="M32 12V20M32 48V56M10 34H18M46 34H54M16 18L22 24M42 44L48 50M48 18L42 24M22 44L16 50" stroke="#ff5a2a" stroke-width="3" stroke-linecap="round"/>' },
  wrecking: { kind: 'free', name: 'Bola de Demolição', w: 1.0, svg: '<path d="M8 8H56" stroke="#e8ecff" stroke-width="5"/><path d="M32 8L46 36" stroke="#9aa3b8" stroke-width="3"/><circle cx="48" cy="44" r="11" fill="#4a505e" stroke="#ff5a1a" stroke-width="3"/><path d="M40 36L36 32M56 36L60 32M58 46H64M38 52L34 56" stroke="#ff5a1a" stroke-width="3" stroke-linecap="round"/><ellipse cx="22" cy="58" rx="10" ry="3" fill="#000" opacity=".4"/>' },
  barrier: { kind: 'free', name: 'Barreira', w: 0.9, svg: '<rect x="6" y="26" width="52" height="14" rx="2" fill="#ffd23f" stroke="#111" stroke-width="2"/><path d="M12 26L22 40M26 26L36 40M40 26L50 40" stroke="#111" stroke-width="4"/><circle cx="6" cy="33" r="4" fill="#ff5a1a"/><circle cx="58" cy="33" r="4" fill="#ff5a1a"/>' },
  geyserstrip: { kind: 'free', name: 'Corredor de Gêiseres', w: 0.8, svg: '<rect x="4" y="22" width="56" height="20" rx="3" fill="#2b2420" stroke="#ff6a1a" stroke-width="2"/><g fill="#7fdcff"><rect x="10" y="8" width="5" height="22" rx="2" opacity=".85"/><rect x="29" y="4" width="5" height="26" rx="2" opacity=".85"/><rect x="48" y="10" width="5" height="20" rx="2" opacity=".85"/></g><g fill="#ff9a1f"><ellipse cx="12.5" cy="38" rx="5" ry="2.5"/><ellipse cx="31.5" cy="30" rx="5" ry="2.5"/><ellipse cx="50.5" cy="38" rx="5" ry="2.5"/></g>' },
  kicker: { kind: 'obs', name: 'Rampinha', w: 0.9, svg: '<path d="M8 50 L56 50 L56 24 Z" fill="#ff9a1f"/><path d="M14 46 L50 46" stroke="#fff" stroke-width="3"/><path d="M50 18 Q56 6 62 14" stroke="#fff" stroke-width="2.5" fill="none"/>' },
  piston: { kind: 'obs', name: 'Pistão', w: 0.8, svg: '<rect x="20" y="10" width="24" height="30" fill="#ff2020"/><rect x="16" y="44" width="32" height="10" fill="#e8ecff"/><path d="M32 4 V10 M24 2 L32 8 L40 2" stroke="#fff" stroke-width="2.5" fill="none"/>' },
  block: { kind: 'obs', name: 'Bloco', w: 1.1, svg: '<rect x="14" y="14" width="36" height="36" rx="3" fill="#ff2020"/><rect x="14" y="25" width="36" height="6" fill="#fff"/>' },
  bumper: { kind: 'obs', name: 'Bumper Mola', w: 1.0, svg: '<circle cx="32" cy="32" r="20" fill="#ff2e88"/><circle cx="32" cy="32" r="11" fill="none" stroke="#00e5ff" stroke-width="5"/>' },
  spinner: { kind: 'obs', name: 'Hélice', w: 0.9, svg: '<rect x="4" y="28" width="56" height="8" rx="3" fill="#ffd23f" transform="rotate(-25 32 32)"/><circle cx="32" cy="32" r="6" fill="#e8ecff"/><path d="M46 8 A26 26 0 0 1 58 26" stroke="#fff" stroke-width="3" fill="none"/>' },
  oil: { kind: 'obs', name: 'Óleo', w: 1.0, svg: '<ellipse cx="32" cy="34" rx="25" ry="17" fill="#0b0b12" stroke="#5a3cff" stroke-width="2"/><ellipse cx="25" cy="29" rx="9" ry="4" fill="#7a5cff" opacity=".7"/>' },
  mboost: { kind: 'obs', name: 'Mini Boost', w: 0.6, svg: '<rect x="12" y="12" width="40" height="40" rx="5" fill="#1b3a0a" stroke="#a6ff3b" stroke-width="2"/><path d="M22 40 L32 28 L42 40" stroke="#a6ff3b" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
  itembox: { kind: 'obs', name: 'Caixa de Poder', w: 0.9, svg: '<rect x="14" y="14" width="36" height="36" rx="7" fill="#0c2a3a" stroke="#00e5ff" stroke-width="3"/><text x="32" y="43" text-anchor="middle" font-size="28" font-weight="900" fill="#ff2e88" font-family="Arial Black,sans-serif">?</text>' },
};
export function bridgeHW(s) {
  const L = 2 * CELL;
  if (s < 8) return lerp(HW, 2.8, clamp(s / 8, 0, 1));
  if (s > L - 8) return lerp(2.8, HW, clamp((s - (L - 8)) / 8, 0, 1));
  return 2.8;
}

// ---------------------------------------------------------- itens de corrida (js/items.js) — tudo centralizado aqui
export const POWER = {
  boxRespawn: 6,            // s até a Caixa de Poder reaparecer
  boxRadius: 2.2,           // raio de coleta (m)
  pickupSlack: 9,           // tolerância do host (m) ao validar coleta de carro remoto (latência)
  rollTime: 1.1,            // s da roleta antes do item ficar pronto
  useCool: 0.6,             // s entre usos
  types: {
    frost: { name: 'Raio Congelante', w: 45, color: '#4df3ff',
      svg: '<g stroke="#4df3ff" stroke-width="5" stroke-linecap="round"><path d="M32 8V56M11 20L53 44M11 44L53 20"/></g><circle cx="32" cy="32" r="7" fill="#e8fdff"/>' },
    peel: { name: 'Casca Derrapante', w: 40, color: '#ffd23f',
      svg: '<path d="M10 40C14 18 40 10 54 28C46 24 40 30 38 38C32 34 20 36 10 40Z" fill="#ffd23f" stroke="#b07a00" stroke-width="3"/><circle cx="46" cy="48" r="5" fill="#ff2e88"/>' },
    pulse: { name: 'Pulso Elétrico', w: 15, color: '#c084ff',
      svg: '<path d="M36 6L16 36H30L26 58L48 26H34Z" fill="#ffe14d" stroke="#8a4dff" stroke-width="3" stroke-linejoin="round"/>' },
    shield: { name: 'Escudo Protetor', w: 16, color: '#4df3ff',
      svg: '<path d="M32 6L54 14V32C54 46 44 56 32 60C20 56 10 46 10 32V14Z" fill="#12384a" stroke="#4df3ff" stroke-width="4" stroke-linejoin="round"/><path d="M32 16L44 21V32C44 40 39 46 32 50C25 46 20 40 20 32V21Z" fill="#4df3ff" opacity=".35"/>' },
    storm: { name: 'Raio Supremo', w: 4, color: '#d9b8ff',
      svg: '<path d="M14 24C6 24 4 14 12 12C14 4 26 4 30 10C38 6 48 12 46 20C54 22 54 32 46 32H16C10 32 8 26 14 24Z" fill="#6a4a9a" stroke="#c084ff" stroke-width="3"/><path d="M34 30L24 46H32L28 60L44 40H35L40 30Z" fill="#ffe14d" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' },
    // poderes raros: mudam a POSIÇÃO do carro (o dono aplica; o host decide e avisa todos)
    wings: { name: 'Asas', w: 12, color: '#7dffb0',
      svg: '<path d="M6 40C14 18 30 14 34 30C26 28 18 32 6 40Z M58 40C50 18 34 14 30 30C38 28 46 32 58 40Z" fill="#e8fff2" stroke="#2dd67a" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="38" r="6" fill="#2dd67a"/>' },
    skip: { name: 'Atalho', w: 8, color: '#ffa94d',
      svg: '<path d="M18 12L50 32L18 52Z" fill="#ffa94d" stroke="#b25a00" stroke-width="3" stroke-linejoin="round"/>' },
    swap: { name: 'Troca de Lugar', w: 6, color: '#ff6bd6',
      svg: '<path d="M10 22H44M34 12L46 22L34 32" stroke="#ff6bd6" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M54 42H20M30 32L18 42L30 52" stroke="#4df3ff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' }
  },
  // homing: cone de aquisição à frente (alcance m, ângulo °), curva máxima (°/s), tempo máximo de rastreio (s) e ângulo de quebra (°)
  frost: { speed: 46, ttl: 2.4, radius: 1.7, freeze: 0.7, slow: 1.5, slowMul: 0.6, steerMul: 0.55, immune: 1.2, homing: { range: 40, cone: 45, maxTurn: 75, maxTime: 1.8, breakAngle: 75 } },
  peel: { ttl: 14, radius: 1.5, back: 3.0, spin: 1.0, kick: 4.5, spinRate: 9, immune: 0.8 },
  pulse: { stun: 0.8, immune: 2.0 },
  wings: { dur: 4.5, lift: 3.2, speedMul: 1.12, grace: 2.0 },        // voa por cima de buracos/obstáculos; se acabar sobre o vazio, ganha até 2 s para achar chão
  skip: { steps: 1, s: 4, inv: 1.5 },                                // teleporta 1 peça à frente (para na chegada), invulnerável 1,5 s
  shield: { dur: 4.5 },                                              // bolha de 4,5 s ou até absorver 1 poder inimigo
  storm: { warn: 0.45, stun: 3.0 },                                 // aviso de 0,45 s e depois atordoa TODOS os rivais por 3 s (o Escudo anula)
  swap: { inv: 1.3, immune: 2.0 }                                    // troca de posição com o carro logo à frente
};
