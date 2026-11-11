// Efeitos sonoros sintetizados (WebAudio).
import { clamp, store } from './utils.js';

// --------------------------------------------------------------- áudio
export const SFX = (() => {
  let ctx = null, master = null, eng = null, tire = null, wind = null, noiseBuf = null;
  let muted = store.get('mute', false);
  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.75;
      master.connect(comp); comp.connect(ctx.destination);
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'triangle';
      const g2 = ctx.createGain(); g2.gain.value = 0.45;
      const g3 = ctx.createGain(); g3.gain.value = 0.6;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(g2); g2.connect(f); o3.connect(g3); g3.connect(f); f.connect(g); g.connect(master);
      o1.frequency.value = 70; o2.frequency.value = 35; o3.frequency.value = 140;
      o1.start(); o2.start(); o3.start();
      eng = { o1, o2, o3, f, g };
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
      const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1800; tf.Q.value = 6;
      const tg = ctx.createGain(); tg.gain.value = 0;
      ns.connect(tf); tf.connect(tg); tg.connect(master);
      const wf = ctx.createBiquadFilter(); wf.type = 'highpass'; wf.frequency.value = 2500;
      const wg = ctx.createGain(); wg.gain.value = 0;
      ns.connect(wf); wf.connect(wg); wg.connect(master);
      ns.start();
      tire = { f: tf, g: tg }; wind = { f: wf, g: wg };
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  function setMute(m) { muted = m; store.set('mute', m); if (master) master.gain.setTargetAtTime(m ? 0 : 0.75, ctx.currentTime, 0.02); }
  function update(speedRatio, thr, boost, slip, active, windAmt) {
    if (!ctx || !eng) return;
    const t = ctx.currentTime;
    const gears = [0, 0.18, 0.38, 0.6, 0.85, 1.9];
    let gi = 0; while (gi < gears.length - 2 && speedRatio > gears[gi + 1]) gi++;
    const rpm = clamp((speedRatio - gears[gi]) / (gears[gi + 1] - gears[gi]), 0, 1);
    const rpmF = active ? (0.15 + rpm * 0.85) * (0.55 + thr * 0.45) : 0.12;
    const freq = 62 + rpmF * 150 + gi * 12 + (boost ? 30 : 0);
    eng.o1.frequency.setTargetAtTime(freq, t, 0.025);
    eng.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.025);
    eng.o3.frequency.setTargetAtTime(freq * 2.01, t, 0.025);
    eng.f.frequency.setTargetAtTime(420 + rpmF * 1700 + thr * 400 + (boost ? 900 : 0), t, 0.04);
    eng.g.gain.setTargetAtTime(active ? 0.045 + 0.055 * thr + (boost ? 0.03 : 0) : 0, t, 0.06);
    tire.g.gain.setTargetAtTime(active ? slip * 0.09 : 0, t, 0.04);
    tire.f.frequency.setTargetAtTime(1500 + slip * 700, t, 0.05);
    wind.g.gain.setTargetAtTime(active ? windAmt * 0.05 : 0, t, 0.1);
  }
  function tone(freq, dur, type = 'square', vol = 0.15, slideTo = 0, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, f0, f1, type = 'bandpass', q = 1.5, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  return {
    init, update, setMute, get muted() { return muted; },
    boost(l) { noise(0.35 + l * 0.12, 0.35 + l * 0.08, 300, 4000, 'bandpass', 0.8); tone(140 + l * 40, 0.45 + l * 0.1, 'sawtooth', 0.13, 700 + l * 250); if (l >= 3) tone(60, 0.5, 'sine', 0.3, 30); },
    pad() { noise(0.4, 0.25, 600, 5000, 'bandpass', 1); tone(300, 0.3, 'triangle', 0.1, 900); },
    level(l) { tone(500 + l * 260, 0.12, 'square', 0.06); tone(750 + l * 390, 0.14, 'square', 0.05, 0, 0.06); },
    hop() { tone(240, 0.09, 'triangle', 0.08, 420); },
    thump(v) { const k = clamp(v / 14, 0.2, 1); noise(0.18, 0.35 * k, 900, 120, 'lowpass', 1); tone(90, 0.15, 'sine', 0.3 * k, 40); },
    boing() { tone(180, 0.35, 'sine', 0.3, 620); tone(360, 0.25, 'triangle', 0.1, 900); },
    splat() { noise(0.4, 0.3, 1200, 200, 'lowpass', 2); tone(140, 0.3, 'sine', 0.15, 60); },
    jump() { noise(0.5, 0.15, 400, 2500, 'bandpass', 1.5); tone(200, 0.35, 'triangle', 0.08, 500); },
    land(v) { const k = clamp(v / 16, 0.3, 1); noise(0.2, 0.4 * k, 600, 80, 'lowpass', 1); tone(70, 0.2, 'sine', 0.35 * k, 35); },
    fall() { tone(700, 1.3, 'sine', 0.12, 70); tone(705, 1.3, 'triangle', 0.06, 72); },
    beep(hi) { tone(hi ? 880 : 440, hi ? 0.5 : 0.22, 'square', 0.12); },
    finish(first) { const seq = first ? [523, 659, 784, 1047] : [523, 659, 784]; seq.forEach((f, i) => tone(f, 0.18, 'square', 0.08, 0, i * 0.09)); },
    place() { noise(0.3, 0.45, 500, 60, 'lowpass', 1); tone(110, 0.25, 'sine', 0.35, 50); [660, 990].forEach((f, i) => tone(f, 0.12, 'square', 0.06, 0, 0.1 + i * 0.07)); },
    grab() { tone(520, 0.08, 'square', 0.08); tone(1040, 0.12, 'square', 0.07, 0, 0.06); },
    deny() { tone(200, 0.2, 'square', 0.08, 120); },
    tick(i) { tone(900 + i * 60, 0.05, 'square', 0.04); },
    warn() { tone(660, 0.08, 'square', 0.05); },
    champ() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, 'square', 0.09, 0, i * 0.13)); },
    click() { tone(700, 0.05, 'square', 0.05); }
  };
})();
