// Estado compartilhado: G (variáveis mutáveis usadas por vários módulos) e hooks
// (funções de módulos superiores, registradas pelo main.js — evita dependência circular).

export const G = {};
export const hooks = {};

// ------------------------------------------------------------- estado
G.state = 'title'; G.prevState = 'race';
G.round = 0; G.R = null; G.phaseT = 0; G.phaseDur = 0;
G.tray = []; G.holds = {}; G.placed = {};
export const HST = { free: [], fid: 0, round: 0, pickEnd: -1, placeEnd: -1, botAt: {}, botPlaceAt: {}, champ: null };
