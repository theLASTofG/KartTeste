// Rede P2P (PeerJS): salas, host autoritativo, sincronização e interpolação.
import { G, HST, hooks } from './state.js';
import { $, clamp, lerp, r2, r3, store, wrapA } from './utils.js';
import { GRAV, MAXP, NET_DT, PALETTE } from './config.js';
import { SFX } from './audio.js';
import { applyTheme, themeKey } from './scene.js';
import { applyTrack, PRESETS, track, trackTypes } from './track.js';
import { obsData } from './obstacles.js';
import { applyBots, carById, freeColor, isHost, NET, playerById, plist, syncCars } from './cars.js';
import { placeToast, toast, updateBoard, updateNetHud } from './hud.js';
export function broadcast(msg) { if (NET.role !== 'host') return; for (const v of NET.conns.values()) if (v.conn.open) { try { v.conn.send(msg); } catch (e) { } } }
// canal rápido (não ordenado): estado dos carros não fica preso atrás de pacote perdido
export function broadcastFast(msg) {
  if (NET.role !== 'host') return;
  for (const v of NET.conns.values()) { const c = v.fast && v.fast.open ? v.fast : v.conn; if (c.open) { try { c.send(msg); } catch (e) { } } }
}
export function toHostFast(msg) {
  if (NET.role !== 'client') return;
  const c = NET.hostFast && NET.hostFast.open ? NET.hostFast : NET.host;
  if (c && c.open) { try { c.send(msg); } catch (e) { } }
}
export function sendTo(pid, msg) { if (pid === G.myId) { onClientMsg(msg); return; } for (const v of NET.conns.values()) if (v.pid === pid && v.conn.open) v.conn.send(msg); }
export function toHost(msg) {
  if (NET.role === 'client') { if (NET.host && NET.host.open) NET.host.send(msg); }
  else hostHandle(G.myId, msg);
}
const ROOM_PREFIX = 'microrush3d-v1-';
// STUN (descobre o IP público) + TURN público (retransmite quando a conexão direta é bloqueada: 4G, NAT simétrico, redes de empresa)
const PEER_OPTS = { debug: 0, config: { iceServers: [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
] } };
// token por aba: permite voltar pra mesma vaga se a conexão cair no meio da partida
const myToken = (() => {
  try { let t = sessionStorage.getItem('microrush.token'); if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('microrush.token', t); } return t; }
  catch (e) { return Math.random().toString(36).slice(2); }
})();
const HTOK = {};                              // host: pid -> token (não é enviado aos outros jogadores)
function genCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
export function setStatus(t) { $('status').textContent = t || ''; }
function readName() { G.myName = ($('nameInp').value || '').trim().slice(0, 12) || G.myName; store.set('name', G.myName); }

export function startSolo() {
  readName();
  NET.role = 'solo'; G.myId = 0; G.nextId = 1; G.botCount = 4;
  G.players = [{ id: 0, name: G.myName, color: PALETTE[0], device: G.myDevice, bot: false, score: 0, connected: true }];
  applyBots(); syncCars();
  hooks.enterPhase('lobby', {});                 // solo também passa pelo lobby (bots + meta de pontos)
}
export function createRoom() {
  readName();
  if (!window.Peer) { setStatus('Multiplayer indisponível (biblioteca de rede não carregou — sem internet?)'); return; }
  setStatus('Criando sala...');
  const code = genCode();
  const peer = new Peer(ROOM_PREFIX + code, PEER_OPTS);
  NET.peer = peer;
  peer.on('open', () => {
    NET.role = 'host'; NET.code = code; G.myId = 0; G.nextId = 1; G.botCount = 0;
    G.players = [{ id: 0, name: G.myName, color: PALETTE[0], device: G.myDevice, bot: false, score: 0, connected: true }];
    syncCars(); setStatus('');
    hooks.enterPhase('lobby', {});
  });
  peer.on('connection', onHostConn);
  peer.on('error', err => {
    if (err.type === 'unavailable-id') { peer.destroy(); createRoom(); return; }
    if (NET.role !== 'host') setStatus('Erro de rede: ' + err.type);
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
}
function onHostConn(conn) {
  if (conn.metadata && conn.metadata.fast) {               // segundo canal (rápido) do mesmo jogador
    const e = NET.conns.get(conn.peer);
    if (e) e.fast = conn; else NET.fastPending.set(conn.peer, conn);
    conn.on('data', msg => {
      if (!msg) return;
      if (msg.t === 'ping') { try { conn.send({ t: 'pong', c: msg.c }); } catch (e) { } return; }
      const en = NET.conns.get(conn.peer); if (en && msg.t === 'st') hostHandle(en.pid, msg);
    });
    conn.on('error', () => { });
    return;
  }
  conn.on('data', msg => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const back = msg.token && G.players.find(p => HTOK[p.id] === msg.token && !p.connected);
      if (back) { hostRejoin(conn, back); return; }
      if (G.state !== 'lobby') { conn.send({ t: 'full', reason: 'Partida já em andamento. Aguarde terminar.' }); setTimeout(() => conn.close(), 400); return; }
      if (G.players.filter(p => !p.bot).length >= MAXP) { conn.send({ t: 'full', reason: 'Sala cheia (máx. ' + MAXP + ').' }); setTimeout(() => conn.close(), 400); return; }
      const id = G.nextId++;
      NET.conns.set(conn.peer, { conn, pid: id, fast: NET.fastPending.get(conn.peer) || null });
      NET.fastPending.delete(conn.peer);
      const nm = String(msg.name || 'Piloto').slice(0, 12);
      G.players.splice(G.players.filter(p => !p.bot).length, 0, { id, name: nm, color: freeColor(), device: msg.device === 'mobile' ? 'mobile' : 'pc', bot: false, score: 0, connected: true });
      if (msg.token) HTOK[id] = String(msg.token).slice(0, 40);
      if (G.players.length > MAXP) { const bi = G.players.map(p => p.bot).lastIndexOf(true); if (bi >= 0) { G.players.splice(bi, 1); G.botCount = Math.max(0, G.botCount - 1); } }
      conn.send({ t: 'welcome', id, code: NET.code });
      hostLobbyChanged();
      SFX.grab();
      return;
    }
    const e = NET.conns.get(conn.peer);
    if (e) hostHandle(e.pid, msg);
  });
  conn.on('close', () => { const e = NET.conns.get(conn.peer); NET.conns.delete(conn.peer); if (e) playerLeft(e.pid); });
  conn.on('error', () => { });
}
// jogador que caiu e voltou: reassume a vaga (o bot devolve o carro na próxima rodada)
function hostRejoin(conn, p) {
  NET.conns.set(conn.peer, { conn, pid: p.id, fast: NET.fastPending.get(conn.peer) || null });
  NET.fastPending.delete(conn.peer);
  p.connected = true; p.name = p.name.replace(/ 🤖$/, '');
  const racing = G.state === 'countdown' || G.state === 'race';
  if (racing) p.rejoin = true; else { p.bot = false; delete HST.botAt[p.id]; }
  conn.send({ t: 'welcome', id: p.id, code: NET.code, rejoin: true });
  conn.send({ t: 'lobby', players: plist(), target: G.TARGET, theme: themeKey, preset: G.presetKey });
  const L = HST.last;
  if (L && !racing) {
    conn.send({ t: 'phase', ph: L.ph, d: Object.assign({}, L.d, { players: plist(), tray: G.state === 'pick' ? G.tray : L.d.tray }) });
  }
  conn.send({ t: 'track', types: trackTypes(), obs: obsData(), placed: G.placed });
  hostLobbyChanged();
  toast(p.name + ' VOLTOU!', '#a6ff3b', 1.4);
}
function playerLeft(pid) {
  const p = playerById(pid); if (!p) return;
  if (G.state === 'lobby') G.players = G.players.filter(x => x.id !== pid);
  else { p.bot = true; p.connected = false; toast(p.name + ' saiu (virou bot)', '#ff9a1f', 1.8); p.name = p.name + ' 🤖'; const c = carById.get(pid); if (c) c.ai.err = null; }
  hostLobbyChanged();
}
export function hostLobbyChanged() {
  syncCars();
  if (G.state === 'lobby') hooks.renderLobby();
  updateBoard();
  broadcast({ t: 'lobby', players: plist(), target: G.TARGET, theme: themeKey, preset: G.presetKey });
}
// conexão caiu no meio da partida: tenta voltar pra mesma vaga algumas vezes
function tryReconnect(code) {
  const n = (NET.retries || 0) + 1; NET.retries = n;
  if (n > 5) { NET.retries = 0; leaveRoom('Conexão com o host perdida.'); return; }
  toast('RECONECTANDO... (' + n + '/5)', '#ff9a1f', 1.8);
  NET.role = 'rejoining';
  try { if (NET.peer) NET.peer.destroy(); } catch (e) { }
  NET.peer = null; NET.host = null; NET.hostFast = null;
  setTimeout(() => { if (NET.role === 'rejoining') joinRoom(code, true); }, 900 * n);
}
export function joinRoom(codeArg, retry) {
  if (!retry) readName();
  const code = (codeArg || $('codeInp').value || '').trim().toUpperCase();
  if (code.length < 4) { setStatus('Digite o código da sala.'); return; }
  if (!window.Peer) { setStatus('Multiplayer indisponível (sem internet?)'); return; }
  if (!retry) setStatus('Conectando à sala ' + code + '...');
  NET.lastCode = code;
  const peer = new Peer(PEER_OPTS);
  NET.peer = peer;
  clearTimeout(NET.joinTimer);
  NET.joinTimer = setTimeout(() => {
    if (NET.role === 'client') return;
    if (retry) { tryReconnect(code); return; }
    setStatus('Não foi possível conectar. Confira o código (ou a rede bloqueou a conexão).'); try { peer.destroy(); } catch (e) { }
  }, 15000);
  peer.on('open', () => {
    const conn = peer.connect(ROOM_PREFIX + code, { serialization: 'json', reliable: true });
    NET.host = conn;
    conn.on('open', () => {
      conn.send({ t: 'hello', name: G.myName, device: G.myDevice, token: myToken });
      const fast = peer.connect(ROOM_PREFIX + code, { serialization: 'json', reliable: false, label: 'fast', metadata: { fast: true } });
      NET.hostFast = fast;
      fast.on('data', onClientMsg);
      fast.on('error', () => { });
    });
    conn.on('data', onClientMsg);
    conn.on('close', () => { if (NET.role === 'client' && !NET.leaving) tryReconnect(code); });
  });
  peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { } });
  peer.on('error', err => {
    if (retry || NET.role === 'client' || NET.role === 'rejoining') { clearTimeout(NET.joinTimer); if (!NET.leaving) tryReconnect(code); return; }
    clearTimeout(NET.joinTimer);
    setStatus(err.type === 'peer-unavailable' ? 'Sala não encontrada. Confira o código.' : 'Erro de rede: ' + err.type);
  });
}
export function leaveRoom(msg) {
  const role = NET.role;
  NET.leaving = true; NET.retries = 0;
  clearTimeout(NET.joinTimer);
  NET.role = 'none';
  try { if (NET.peer) NET.peer.destroy(); } catch (e) { }
  NET.peer = null; NET.host = null; NET.hostFast = null; NET.conns.clear(); NET.fastPending.clear(); NET.code = '';
  G.players = []; syncCars();
  G.R = null;
  hooks.goTitle();
  if (msg && role !== 'none') setStatus(msg);
  setTimeout(() => { NET.leaving = false; }, 300);
}
function onClientMsg(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome':
      clearTimeout(NET.joinTimer);
      NET.role = 'client'; G.myId = msg.id; NET.code = msg.code; NET.retries = 0; setStatus('');
      if (msg.rejoin) {
        const lw = $('lobbyWait'); lw.dataset.rejoin = '1'; lw.textContent = 'Reconectado! Você volta a correr na próxima rodada.';
        toast('RECONECTADO!', '#a6ff3b', 1.4);
        if (G.state !== 'results' && G.state !== 'pick' && G.state !== 'champion') hooks.enterPhase('lobby', {});
      } else hooks.enterPhase('lobby', {});
      break;
    case 'wait': break;
    case 'pong': NET.rtt = Math.round(performance.now() - msg.c); NET.pongAt = performance.now(); updateNetHud(); break;
    case 'lobby':
      if (msg.target) G.TARGET = msg.target;
      if (msg.theme && msg.theme !== themeKey) applyTheme(msg.theme);
      if (msg.preset && PRESETS[msg.preset]) G.presetKey = msg.preset;
      G.players = msg.players; syncCars(); updateBoard();
      if (G.state === 'lobby') hooks.renderLobby();
      break;
    case 'phase': hooks.enterPhase(msg.ph, msg.d); break;
    case 'snap':
      if (isHost()) break;
      for (const arr of msg.c) {
        const c = carById.get(arr[0]); if (!c) continue;
        if (c.isLocal) { if (arr[12] && !c.finishOrder) { c.finishOrder = arr[12]; placeToast(c); } }
        else applyNet(c, arr, true);
      }
      break;
    case 'tray': hooks.applyTray(msg.tray); break;
    case 'track': applyTrack(msg.types, msg.obs, true); G.placed = msg.placed || {}; hooks.renderBuild(); break;
    case 'msg': toast(msg.text, msg.color || '#fff', 1.6); if (msg.deny) SFX.deny(); break;
    case 'full':
      clearTimeout(NET.joinTimer);
      if (G.state !== 'title') { leaveRoom(msg.reason); break; }
      setStatus(msg.reason); NET.role = 'none'; NET.leaving = true; try { NET.peer.destroy(); } catch (e) { } setTimeout(() => { NET.leaving = false; }, 300);
      break;
  }
}
function hostHandle(pid, msg) {
  switch (msg.t) {
    case 'st': { const c = carById.get(pid); if (c && !c.owned) applyNet(c, msg.s, false); break; }
    case 'ping': sendTo(pid, { t: 'pong', c: msg.c }); break;
    case 'pick': hooks.hostPick(pid, msg.id); break;
    case 'place': hooks.hostPlace(pid, msg.key); break;
    case 'unpick': hooks.hostUnpick(pid); break;
  }
}
// ---- estado de carro na rede
export function packCar(c) {
  const f = (c.alive ? 1 : 0) | (c.finished ? 2 : 0) | (c.grounded ? 4 : 0) | (c.drifting ? 8 : 0) | (c.boostT > 0 ? 16 : 0) | (c.braking ? 32 : 0);
  // ts = relógio de quem SIMULA o carro (host repassa sem mudar) -> interpolação por tempo de origem
  const ts = c.owned ? Math.round(performance.now()) : (c.netTs || 0);
  return [c.pid, r2(c.x), r2(c.y), r2(c.z), r3(c.a), r2(c.vx), r2(c.vy), r2(c.vz), r2(c.steer || 0), f, c.driftLevel || 0, r2(c.prog), c.finishOrder || 0, c.pi, r2(c.boostPow || 0), ts];
}
function applyNet(c, a, fromHost) {
  const off = fromHost ? 0 : -1;  // o cliente manda o pacote sem o pid
  const g = i => a[i + off];
  const ts = g(15) || 0, now = performance.now();
  if (c.netTs && ts && ts <= c.netTs) return;          // canal não ordenado: descarta pacote velho
  c.netTs = ts;
  // offset de relógio estimado = menor (chegada - envio) visto; sobe devagar para acompanhar deriva
  const o = now - ts;
  if (c.netOff === undefined || o < c.netOff) c.netOff = o;
  const ex = o - c.netOff;                                   // atraso extra (jitter) acima do mínimo visto
  c.jit = c.jit === undefined ? ex : c.jit + (ex - c.jit) * 0.08;
  if (!c.buf) c.buf = [];
  c.buf.push({ t: ts, x: g(1), y: g(2), z: g(3), a: g(4), vx: g(5), vy: g(6), vz: g(7) });
  if (c.buf.length > 24) c.buf.shift();
  if (!c.net) { c.x = g(1); c.y = g(2); c.z = g(3); c.a = g(4); }
  c.net = { x: g(1), y: g(2), z: g(3), a: g(4), vx: g(5), vy: g(6), vz: g(7), t: now, ts };
  c.steer = g(8);
  const f = g(9);
  const wasAlive = c.alive, wasFin = c.finished;
  c.alive = !!(f & 1); c.finished = !!(f & 2); c.grounded = !!(f & 4); c.drifting = !!(f & 8);
  c.boostT = f & 16 ? 0.3 : 0; c.braking = !!(f & 32); c.driftLevel = g(10); c.prog = g(11);
  c.pi = clamp(g(13), 0, track.length - 1); c.boostPow = g(14);
  if (fromHost) c.finishOrder = a[12];
  else if (G.R && (G.state === 'race' || G.state === 'countdown')) {           // host detecta chegada/queda de clientes
    if (c.finished && !wasFin) hooks.hostRegisterFinish(c);
    if (!c.alive && wasAlive) c.fallProg = c.prog;
  }
}
// carro remoto: interpolação entre amostras com atraso fixo (suave, sem tranco),
// e uma posição "presente" extrapolada (cpx/cpz) usada só para colisão
export function updateRemote(c, dt) {
  const b = c.buf;
  if (!b || !b.length) return;
  c.netOff += dt * 1000 * 0.01;                              // deriva lenta do offset
  // buffer adaptativo: rede estável = atraso mínimo; rede instável = mais folga (sem trancos)
  const want = clamp(40 + (c.jit || 0) * 1.8 + NET_DT * 1000, 70, 240);
  c.interp = c.interp === undefined ? want : c.interp + (want - c.interp) * Math.min(1, dt * 1.5);
  const now = performance.now(), rt = now - c.netOff - c.interp;
  let s0 = b[0], s1 = b[b.length - 1], x, y, z, a, vx, vy, vz;
  if (rt >= s1.t) {                                           // sem amostra futura: extrapola um pouco
    const e = Math.min(0.2, (rt - s1.t) / 1000);
    x = s1.x + s1.vx * e; z = s1.z + s1.vz * e; y = s1.y + (c.grounded ? 0 : s1.vy * e - 0.5 * GRAV * e * e);
    a = s1.a; vx = s1.vx; vy = s1.vy; vz = s1.vz;
  } else if (rt <= s0.t) { ({ x, y, z, a, vx, vy, vz } = s0); }
  else {
    let i = b.length - 2;
    while (i > 0 && b[i].t > rt) i--;
    s0 = b[i]; s1 = b[i + 1];
    const k = clamp((rt - s0.t) / Math.max(1, s1.t - s0.t), 0, 1);
    x = lerp(s0.x, s1.x, k); y = lerp(s0.y, s1.y, k); z = lerp(s0.z, s1.z, k);
    a = s0.a + wrapA(s1.a - s0.a) * k;
    vx = lerp(s0.vx, s1.vx, k); vy = lerp(s0.vy, s1.vy, k); vz = lerp(s0.vz, s1.vz, k);
  }
  // amortece micro-correções sem atrasar (teleporte grande = snap)
  const jump = Math.hypot(x - c.x, z - c.z) > 8;
  const k2 = jump ? 1 : 1 - Math.exp(-dt * 30);
  c.x += (x - c.x) * k2; c.y += (y - c.y) * k2; c.z += (z - c.z) * k2; c.a += wrapA(a - c.a) * k2;
  c.vx = vx; c.vy = vy; c.vz = vz;
  c.vf = c.vx * Math.cos(c.a) + c.vz * Math.sin(c.a);
  const last = b[b.length - 1], e2 = clamp((now - c.netOff - last.t) / 1000, 0, 0.25);
  c.cpx = last.x + last.vx * e2; c.cpz = last.z + last.vz * e2;
  if (!c.alive) { c.tumbleX = (c.tumbleX || 0) + dt * 3.1; c.tumbleZ = (c.tumbleZ || 0) + dt * 2.3; }
}
setInterval(() => { if (NET.role === 'client') toHostFast({ t: 'ping', c: Math.round(performance.now()) }); updateNetHud(); }, 1500);
