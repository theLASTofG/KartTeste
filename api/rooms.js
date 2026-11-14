// Lista de salas abertas (Vercel Function, mesma origem do jogo). Memória do processo + TTL curto:
// os hosts re-anunciam a cada ~15 s, então se a instância reiniciar a lista se refaz sozinha.
// POST {code,name,n,max,state,preset}  -> anuncia/atualiza a sala   |  POST {code,close:true} -> remove
// GET                                  -> { rooms: [{code,host,n,max,open,preset}] }
const TTL = 45_000, MAX_ROOMS = 200;
const rooms = globalThis.__mrRooms || (globalThis.__mrRooms = new Map());

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>"'`&]/g, '').trim().slice(0, n);
const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? Math.round(+v) : lo));
function prune() { const now = Date.now(); for (const [k, r] of rooms) if (now - r.t > TTL) rooms.delete(k); }

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  prune();
  if (req.method === 'GET') {
    const list = [...rooms.values()].sort((a, b) => b.t - a.t).slice(0, 40)
      .map(r => ({ code: r.code, host: r.host, n: r.n, max: r.max, open: r.state === 'lobby' && r.n < r.max, preset: r.preset }));
    res.status(200).json({ rooms: list });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object' || !/^[A-Z2-9]{5}$/.test(String(b.code))) { res.status(400).json({ error: 'bad' }); return; }
  if (b.close) { rooms.delete(b.code); res.status(200).json({ ok: true }); return; }
  if (!rooms.has(b.code) && rooms.size >= MAX_ROOMS) { res.status(429).json({ error: 'full' }); return; }
  rooms.set(b.code, {
    code: b.code, host: clean(b.name, 12) || 'Piloto', n: int(b.n, 1, 8), max: int(b.max, 1, 8),
    state: b.state === 'lobby' ? 'lobby' : 'race', preset: clean(b.preset, 24), t: Date.now()
  });
  res.status(200).json({ ok: true });
}
