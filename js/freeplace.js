// Posicionamento LIVRE de armadilhas na montagem: ghost translúcido (verde = válido, vermelho = proibido), raycast do cursor/toque
// sobre a superfície real da pista (sem grade), base alinhada à normal da pista e rotação 360° (roda/Q/E/R no PC; slider e botões no celular).
// Nada é enviado aos outros jogadores até CONFIRMAR; o host guarda a armadilha escondida e a revela no início da rodada.
import * as THREE from 'three';
import { G } from './state.js';
import { $, TAU } from './utils.js';
import { GSTRIP, WRECK } from './config.js';
import { SFX } from './audio.js';
import { camera, keepResource, scene } from './scene.js';
import { freeSpot, trackRoot } from './track.js';
import { buildFree } from './freeobs.js';
import { toast } from './hud.js';
import { toHost } from './net.js';

export const FP = { active: false, type: null, yaw: 0, x: 0, y: 0, z: 0, valid: false, hit: false, ptr: null, ghost: null, spot: null, lastValid: null };
const gOk = keepResource(new THREE.MeshBasicMaterial({ color: 0x35ff7a, transparent: true, opacity: 0.5, depthWrite: false }));
const gBad = keepResource(new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.5, depthWrite: false }));
const gSweep = keepResource(new THREE.MeshBasicMaterial({ color: 0xffa13a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), qN = new THREE.Quaternion(), qY = new THREE.Quaternion(), nrm = new THREE.Vector3();

function ghostify(g, mat) { g.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; } }); }
function startFree(type) {
  FP.active = true; FP.type = type; FP.valid = false; FP.hit = false; FP.lastValid = null;
  const g = buildFree(type, null);
  if (type === 'wrecking') {                                             // faixa mostra por onde a esfera varre
    const w = 2 * WRECK.L * Math.sin(WRECK.maxAng) + 2 * WRECK.R, sw = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.8), gSweep);
    sw.rotation.x = -Math.PI / 2; sw.position.y = 0.09; sw.userData.sweep = true; g.add(sw);
  }
  if (type === 'geyserstrip') {                                         // ghost mostra TODA a extensão do corredor
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(GSTRIP.len, GSTRIP.w), gSweep);
    sw.rotation.x = -Math.PI / 2; sw.position.y = 0.09; sw.userData.sweep = true; g.add(sw);
  }
  ghostify(g, gOk); g.traverse(o => { if (o.userData.sweep) o.material = gSweep; });
  g.visible = false; scene.add(g); FP.ghost = g;
  setYaw(FP.yaw);
}
export function endFree() {
  if (FP.ghost) { scene.remove(FP.ghost); FP.ghost = null; }
  FP.active = false; FP.type = null; FP.ptr = null; FP.hit = false;
}
// chamado por renderBuild: liga/desliga o modo conforme a carta que eu seguro
export function syncFree(mode, type) {
  if (mode === 'free' && type) { if (!FP.active || FP.type !== type) { endFree(); startFree(type); } }
  else if (FP.active) endFree();
}
export function setYaw(v) {
  FP.yaw = ((v % TAU) + TAU) % TAU;
  const sl = $('rotRange'); if (sl) sl.value = Math.round(FP.yaw * 180 / Math.PI) % 360;
}
export const rotateFree = d => setYaw(FP.yaw + d);
export function setPointer(x, y) { FP.ptr = { x, y }; }

// raycast do ponteiro sobre as malhas da pista; o 1º ponto que cai numa área VÁLIDA vence
function probe() {
  const W = window.innerWidth, H = window.innerHeight;
  ndc.set(FP.ptr.x / W * 2 - 1, -(FP.ptr.y / H) * 2 + 1);
  camera.updateMatrixWorld(); trackRoot.updateMatrixWorld(true);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(trackRoot.children, true).filter(h => !h.object.userData.sweep);
  FP.hit = false; FP.valid = false; FP.spot = null;
  for (const h of hits) {
    const s = freeSpot(h.point.x, h.point.z, h.point.y);
    if (s) { FP.x = h.point.x; FP.z = h.point.z; FP.y = s.y; FP.spot = s; FP.valid = true; FP.hit = true; return; }
  }
  const p = hits[0] ? hits[0].point : ray.ray.intersectPlane(plane, pt);
  if (p) { FP.x = p.x; FP.y = p.y; FP.z = p.z; FP.hit = true; }
}
// todo frame na montagem: rotação por Q/E (segurar), atualiza o ghost
export function updateFree(dt, keys) {
  if (!FP.active || !FP.ghost) return;
  const r = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
  if (r) setYaw(FP.yaw + r * 2.6 * dt);
  if (FP.ptr) probe();
  const g = FP.ghost; g.visible = FP.hit;
  if (!FP.hit) return;
  g.position.set(FP.x, FP.y + 0.02, FP.z);
  const sl = FP.spot ? FP.spot.slope : 0, fx = FP.spot ? FP.spot.fx : 1, fz = FP.spot ? FP.spot.fz : 0;
  nrm.set(-sl * fx, 1, -sl * fz).normalize();                                    // base alinhada à normal da pista
  qN.setFromUnitVectors(UP, nrm); qY.setFromAxisAngle(UP, -FP.yaw);
  g.quaternion.copy(qN).multiply(qY);
  if (FP.lastValid !== FP.valid) { FP.lastValid = FP.valid; g.traverse(o => { if (o.isMesh && !o.userData.sweep) o.material = FP.valid ? gOk : gBad; }); }
}
export function confirmFree() {
  if (!FP.active) return;
  if (!FP.valid) { SFX.deny(); toast(FP.hit ? 'POSIÇÃO PROIBIDA!' : 'MIRE NA PISTA!', '#ff2e55', 0.9); return; }
  SFX.grab();
  toHost({ t: 'placefree', x: +FP.x.toFixed(2), z: +FP.z.toFixed(2), y: +FP.y.toFixed(2), yaw: +FP.yaw.toFixed(3) });
}

// controles de toque da barra de posicionamento (slider circular em graus + giro fino)
{
  const sl = $('rotRange'); if (sl) sl.addEventListener('input', () => setYaw(+sl.value * Math.PI / 180));
  document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => { SFX.click(); rotateFree(+b.dataset.rot * Math.PI / 180); }));
}
