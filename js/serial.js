// Arduino-style serial monitor: a scripted power-on bring-up sequence, then a
// live telemetry stream while driving. Purely visual — makes Upload feel like
// booting a real robot.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class Serial {
  constructor(logEl) {
    this.el = logEl;
    this.bootId = 0;           // cancels a stale boot if the user leaves/returns
    this._lastTelemetry = 0;
  }

  clear() { this.el.innerHTML = ''; }

  line(text, cls = '') {
    const div = document.createElement('div');
    div.className = 'ser-line' + (cls ? ' ' + cls : '');
    div.textContent = text;
    this.el.appendChild(div);
    // keep the log from growing unbounded
    while (this.el.childElementCount > 200) this.el.removeChild(this.el.firstChild);
    this.el.scrollTop = this.el.scrollHeight;
    return div;
  }

  // Scripted boot. Resolves when the robot is "ready"; onReady() is called then.
  async boot(gains, onReady) {
    const id = ++this.bootId;
    const alive = () => id === this.bootId;
    this.clear();
    const steps = [
      ['> avrdude: uploading balance_bot.ino …', 'dim', 260],
      ['> avrdude: 14848 bytes written  ✓', 'ok', 380],
      ['', '', 120],
      ['[boot] ATmega328P @ 16 MHz', '', 240],
      ['[i2c]  scanning bus …', 'dim', 420],
      ['[i2c]  device found: MPU6050 @ 0x68  ✓', 'ok', 260],
      ['[imu]  waking MPU6050, ±250°/s, ±2g', '', 300],
      ['[imu]  calibrating gyro — hold still …', 'dim', 700],
      ['[imu]  offsets  gx:-13 gy:07 gz:02  ✓', 'ok', 260],
      [`[pid]  gains  Kp=${gains.Kp}  Ki=${gains.Ki}  Kd=${gains.Kd}`, 'accent', 300],
      ['[drv]  L298N enable … motor A ✓  motor B ✓', 'ok', 420],
      ['[sys]  entering balance loop @ 100 Hz', '', 300],
      ['[sys]  READY — drive with W A S D', 'ok', 0],
    ];
    for (const [text, cls, wait] of steps) {
      if (!alive()) return;
      this.line(text, cls);
      if (wait) await sleep(wait);
    }
    if (alive() && onReady) onReady();
  }

  cancel() { this.bootId++; }

  // Throttled live line during driving.
  telemetry(sim, now) {
    if (now - this._lastTelemetry < 220) return;
    this._lastTelemetry = now;
    const p = sim.pidTerms || { p: 0, i: 0, d: 0, pwm: 0 };
    const f = (n) => (n >= 0 ? ' ' : '') + n.toFixed(2);
    this.line(
      `tilt ${f(sim.tiltDeg)}°  P${f(p.p)} I${f(p.i)} D${f(p.d)}  pwm ${String(p.pwm).padStart(3)}`,
      sim.fallen ? 'bad' : '');
  }
}
