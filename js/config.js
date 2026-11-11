// Constantes do jogo: física, pontuação, peças de pista, obstáculos e cartas.
import { G } from './state.js';
import { clamp, lerp } from './utils.js';

// ------------------------------------------------------------ constantes
export const CELL = 26, HW = 5.5, RC = CELL / 2;
export const WALL_H = 0.9, CAR_R = 1.05, GRAV = 26, FINISH_S = 7, MAXP = 8;
// muretas laterais das pistas comuns (visual E física). Chicane, obstáculos, largada e chegada têm barreiras próprias.
export const SIDE_WALLS = false;
export const MAX_DEATHS = 3;          // vidas por rodada: quedas no abismo antes de ser eliminado
export const TARGET_OPTS = [1000, 2500, 5000, 10000];
G.TARGET = 10000;                       // meta de pontos (o host escolhe no lobby)
export const fmtPts = n => n.toLocaleString('pt-BR');
export const SUBSTEP = 1 / 120, NET_DT = 1 / 30;      // 30 envios/s de estado
const INTERP_MS = 90;                          // atraso de interpolação dos carros remotos (buffer anti-tranco)
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const PH = {
  maxSpeed: 27, maxRev: 8, accel: 30, brake: 44, revAccel: 16, coast: 3.5, coastK: 0.25,
  turn: 2.7, grip: 12, gripDrift: 3.8, gripOil: 1.4, overDecay: 2.2, boostAccel: 70, airTurn: 0.35
};
export const DRIFT = {
  minSpeed: 10.5, stopSpeed: 6.5, T: [0.55, 1.2, 2.0], pow: [0.25, 0.38, 0.52], dur: [0.7, 1.0, 1.4], kick: [3, 5, 7.5],
  col: [[0.23, 0.63, 1], [1, 0.6, 0.12], [0.82, 0.3, 1]], css: ['#3aa0ff', '#ff9a1f', '#d24bff'],
  name: ['MINI TURBO', 'SUPER TURBO', 'ULTRA TURBO!']
};
export const PAD = { pow: 0.42, dur: 1.0, kick: 4, s0: 8, s1: 18, hv: 3.6 };
// perfis de rampa/buraco por peça: [s0, s1, tipo, h0, h1] (data-driven: rampa, buraco e trecho plano)
export const PROFILES = {
  jump: [[0, 18, 'ramp', 0, 3], [18, 29, 'gap'], [29, 52, 'flat']],
  bigjump: [[0, 24, 'ramp', 0, 5], [24, 44, 'gap'], [44, 78, 'flat']],
  doublejump: [[0, 12, 'ramp', 0, 2.4], [12, 21, 'gap'], [21, 40, 'flat'], [40, 52, 'ramp', 0, 2.4], [52, 61, 'gap'], [61, 78, 'flat']]
};
export const RAMP_PADS = { bigjump: [2, 12] };                // Mega Salto tem turbo embutido na rampa
export const profileSeg = (t, s) => { const p = PROFILES[t]; if (!p) return null; for (const g of p) if (s < g[1]) return g; return p[p.length - 1]; };
// chicane: barreiras alternadas (s, faixa lateral v0..v1) que obrigam o zigue-zague
export const BARRIERS = [{ s: 12, v0: -HW, v1: -1.2 }, { s: 26, v0: 1.2, v1: HW }, { s: 40, v0: -HW, v1: -1.2 }];
export const HOLES = [{ s0: 10, s1: 16, v0: -5.6, v1: -0.8 }, { s0: 24, s1: 30, v0: 0.8, v1: 5.6 }, { s0: 38, s1: 44, v0: -2.2, v1: 2.2 }];
export const WIND_ACC = 8;                       // empurrão lateral do vento (m/s²)
export const bumpH = s => (s > 2 && s < 24) ? 0.55 * Math.pow(Math.sin(Math.PI * (s - 2) / 5.5), 2) : 0;
export const bumpSlope = s => (s > 2 && s < 24) ? 0.55 * Math.PI / 5.5 * Math.sin(2 * Math.PI * (s - 2) / 5.5) : 0;
export const PTS = [300, 220, 150, 110, 80, 60, 45, 30];
export const PALETTE = ['#00e5ff', '#ff3b5c', '#ffd23f', '#7dff6b', '#c471ff', '#ff8a1f', '#ff6bd6', '#e8ecff'];
export const BOT_NAMES = ['Rex', 'Nova', 'Blaze', 'Viper', 'Turbo', 'Faísca', 'Bolt', 'Zíper'];
export const GRID_SLOTS = [[20, -3.4], [20, 0], [20, 3.4], [15, -3.4], [15, 0], [15, 3.4], [10, -3.4], [10, 0], [10, 3.4]];
export const PT = {
  start: { cells: 1 }, straight: { cells: 1 }, finish: { cells: 1 }, boost: { cells: 1 },
  curveL: { cells: 1, curve: -1 }, curveR: { cells: 1, curve: 1 }, jump: { cells: 2 }, bridge: { cells: 2 },
  bumps: { cells: 1 }, ice: { cells: 1 }, wind: { cells: 1 }, holes: { cells: 2 }, bigjump: { cells: 3 },
  chicane: { cells: 2 }, doublejump: { cells: 3 },
  serpentina: { cells: 4, special: 'serp' },        // ocupa 2x2 células: sobe em S, retorna 180° e desce (sai ao lado, no sentido oposto)
  spiralup: { cells: 2, special: 'spiral', dh: 6 },  // meia-volta subindo +6 m: as peças seguintes (e a chegada) ficam no andar de cima
  megablock: { cells: 12, special: 'mega' }         // 3 células de comprimento x 4 de largura, com 4 saídas frontais
};
// espaços delimitados onde obstáculos podem ser posicionados (s ao longo, v lateral)
export const SLOTS = {
  straight: [[8, -2.6], [8, 2.6], [18, 0]], boost: [[22.5, -2.6], [22.5, 2.6]],
  curveL: [[RC * Math.PI / 4, 0]], curveR: [[RC * Math.PI / 4, 0]], jump: [[40, -2.4], [40, 2.4]],
  ice: [[8, -2.6], [8, 2.6], [18, 0]], wind: [[13, 0]], bigjump: [[66, -2.4], [66, 2.4]], doublejump: [[30, -2.4], [30, 2.4], [70, 0]],
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
export const MEGA = {
  len: 78, shift: 13, hw: 45, taper: 20, lvMin: -32.5, lvMax: 58.5,
  exitLv: [-26, 0, 26, 52], exitV: [-39, -13, 13, 39],            // v centrado (v = lv - shift)
  gaps: [[-19.5, -6.5], [6.5, 19.5], [32.5, 45.5]], gapS: [73, 78],  // barreiras fixas entre as saídas
  ice: [{ s0: 30, s1: 76, l0: -32.5, l1: -19.5 }, { s0: 30, s1: 76, l0: 45.5, l1: 58.5 }],
  pads: [{ s0: 24, s1: 32, l0: -5.5, l1: 5.5 }, { s0: 58, s1: 64, l0: -5.5, l1: 5.5 }, { s0: 58, s1: 64, l0: 20.5, l1: 31.5 }],
  bumps: [38, 52], bumpHalf: 2, bumpH: 0.5,                         // lombadas na largura toda
  bumpers: [{ s: 46, l: 13, r: 1.4 }, { s: 46, l: 39, r: 1.4 }],   // bumpers de mola fixos
  colors: [0x00e5ff, 0xff2e88, 0xa6ff3b, 0xffd23f]
};
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
  if (s < 8) return lerp(HW, 2.5, clamp(s / 8, 0, 1));
  if (s > L - 8) return lerp(2.5, HW, clamp((s - (L - 8)) / 8, 0, 1));
  return 2.5;
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
      svg: '<path d="M36 6L16 36H30L26 58L48 26H34Z" fill="#ffe14d" stroke="#8a4dff" stroke-width="3" stroke-linejoin="round"/>' }
  },
  frost: { speed: 46, ttl: 2.4, radius: 1.7, freeze: 0.7, slow: 1.5, slowMul: 0.6, steerMul: 0.55, immune: 1.2 },
  peel: { ttl: 14, radius: 1.5, back: 3.0, spin: 1.0, kick: 4.5, spinRate: 9, immune: 0.8 },
  pulse: { stun: 0.8, immune: 2.0 }
};
