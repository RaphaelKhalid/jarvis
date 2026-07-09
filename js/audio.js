// Synthesized sound design (WebAudio, no samples — CSP-safe and tiny).
// Everything is generated from oscillators + envelopes. Must be resumed from a
// user gesture (browser autoplay policy); call resume() on first interaction.

class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.motor = null;                       // { osc, gain, filter }
    this.enabled = true;
    try { this.enabled = localStorage.getItem('sbl-muted') !== '1'; } catch {}
  }

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('sbl-muted', on ? '0' : '1'); } catch {}
    if (this.master) this.master.gain.value = on ? 0.9 : 0;
  }

  // one shaped oscillator note
  _tone(freq, dur, { type = 'sine', gain = 0.25, glide = 0, delay = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(1, freq + glide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // short filtered noise burst (click / snap)
  _noise(dur, { gain = 0.3, freq = 1800 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
  }

  place()  { this._noise(0.09, { gain: 0.35, freq: 1400 }); this._tone(240, 0.09, { type: 'triangle', gain: 0.18 }); }
  connect(){ this._tone(660, 0.09, { type: 'sine', gain: 0.22 }); this._tone(990, 0.12, { type: 'sine', gain: 0.20, delay: 0.07 }); }
  error()  { this._tone(150, 0.18, { type: 'sawtooth', gain: 0.2, glide: -60 }); }
  nudge()  { this._tone(90, 0.16, { type: 'sine', gain: 0.4, glide: -40 }); this._noise(0.06, { gain: 0.25, freq: 400 }); }
  boot()   { [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.12, { type: 'square', gain: 0.14, delay: i * 0.09 })); }
  ui()     { this._tone(1200, 0.03, { type: 'sine', gain: 0.06 }); }

  // ── continuous motor hum, pitch/volume follow wheel speed ──
  startMotor() {
    if (!this.ctx || !this.enabled || this.motor) return;
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter); filter.connect(gain); gain.connect(this.master);
    osc.start();
    this.motor = { osc, gain, filter };
  }
  setMotor(speed) {   // speed in world units/s
    if (!this.motor || !this.ctx) return;
    const s = Math.min(1, Math.abs(speed) / 24);
    const now = this.ctx.currentTime;
    this.motor.gain.gain.setTargetAtTime(0.02 + s * 0.14, now, 0.08);
    this.motor.osc.frequency.setTargetAtTime(48 + s * 90, now, 0.08);
    this.motor.filter.frequency.setTargetAtTime(300 + s * 700, now, 0.08);
  }
  stopMotor() {
    if (!this.motor) return;
    try { this.motor.osc.stop(this.ctx.currentTime + 0.05); } catch {}
    this.motor = null;
  }
}

export const audio = new Audio();
