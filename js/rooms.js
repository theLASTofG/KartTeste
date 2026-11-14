// Salas abertas: anúncio do host + lista no título (via /api/rooms, mesma origem do jogo).
// Sem o endpoint (rodando local, offline) a lista só some e o código continua funcionando.
import { G } from './state.js';
import { $, esc, store } from './utils.js';

const URL = '/api/rooms';
G.publicRoom = store.get('public', true);          // host: aparece na lista de salas?
let lastAnnounce = '';

// ---- host
export function announceRoom(info) {                // info: { code, name, n, max, state, preset }
  if (!G.publicRoom) return;
  lastAnnounce = info.code;
  try { fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info), keepalive: true }).catch(() => { }); } catch (e) { }
}
export function closeRoomAnnouncement(code) {
  code = code || lastAnnounce; if (!code) return;
  lastAnnounce = '';
  const body = JSON.stringify({ code, close: true });
  try { if (navigator.sendBeacon && navigator.sendBeacon(URL, new Blob([body], { type: 'application/json' }))) return; } catch (e) { }
  try { fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => { }); } catch (e) { }
}
window.addEventListener('pagehide', () => closeRoomAnnouncement());

// ---- título: lista de salas
let failed = 0;
function render(list, msg) {
  const el = $('roomList'); if (!el) return;
  if (msg) { el.innerHTML = `<div class="note">${esc(msg)}</div>`; return; }
  if (!list.length) { el.innerHTML = '<div class="note">Nenhuma sala aberta agora. Crie uma e chame os amigos!</div>'; return; }
  el.innerHTML = list.map(r => `<div class="rm"><span class="rn">${esc(r.host)}</span><span class="rp">${esc(r.preset || '')}</span>
    <span class="rc">${r.n}/${r.max}</span><button class="rj" data-join="${esc(r.code)}" ${r.open ? '' : 'disabled'}>${r.open ? 'ENTRAR' : r.n >= r.max ? 'CHEIA' : 'EM JOGO'}</button></div>`).join('');
}
export async function refreshRooms() {
  try {
    const r = await fetch(URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json(); failed = 0;
    render(Array.isArray(d.rooms) ? d.rooms : []);
  } catch (e) { if (++failed >= 2) render([], 'Lista de salas indisponível agora. Use o código da sala.'); }
}
$('roomList').addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-join]');
  if (b && !b.disabled) document.dispatchEvent(new CustomEvent('joinroom', { detail: b.dataset.join }));
});
$('roomRefresh').addEventListener('click', () => { render([], 'Atualizando...'); refreshRooms(); });
setInterval(() => { if (G.state === 'title' && !document.hidden) refreshRooms(); }, 6000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && G.state === 'title') refreshRooms(); });
setTimeout(refreshRooms, 600);
