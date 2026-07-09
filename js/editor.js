// CodeMirror editor (loaded via CDN globals) + Kp/Ki/Kd parser.
// CodeMirror 5 is included in index.html as classic globals (window.CodeMirror).

export const DEFAULT_SKETCH = `/*
 * Self-Balancing Robot — MPU6050 + L298N + PID
 * Unit 4: PID Control
 *
 * Watch the robot on the workbench once you hit UPLOAD.
 * If it falls over, tune the gains below and upload again.
 */
#include <Wire.h>
#include <MPU6050.h>
#include <PID_v1.h>

MPU6050 mpu;

// ── PID gains ──────────────────────────────────────────────
// Tune these values to make the robot balance
double Kp = 15.0;   // proportional  — stiffness against tilt
double Ki = 140.0;  // integral      — kills steady-state lean
double Kd = 0.9;    // derivative    — damping, stops oscillation

double setpoint = 0.0;   // upright = 0 degrees
double input, output;
PID pid(&input, &output, &setpoint, Kp, Ki, Kd, DIRECT);

// ── pin map (must match your wiring) ───────────────────────
const int IN1 = 6, IN2 = 9;    // motor A
const int IN3 = 10, IN4 = 11;  // motor B
const int MPU_INT = 2;

void setup() {
  Wire.begin();              // SDA=A4, SCL=A5
  mpu.initialize();
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pid.SetMode(AUTOMATIC);
  pid.SetOutputLimits(-255, 255);
  pid.SetSampleTime(10);
}

void loop() {
  input = readTiltAngle();   // degrees from vertical
  pid.Compute();
  driveMotors(output);       // press UPLOAD to simulate this loop
}

void driveMotors(double u) {
  int pwm = constrain((int)abs(u), 0, 255);
  bool fwd = u > 0;
  analogWrite(IN1, fwd ? pwm : 0);
  analogWrite(IN2, fwd ? 0 : pwm);
  analogWrite(IN3, fwd ? pwm : 0);
  analogWrite(IN4, fwd ? 0 : pwm);
}
`;

export function parseGains(text) {
  const grab = (name, fallback) => {
    const re = new RegExp('\\b' + name + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?)', 'i');
    const m = text.match(re);
    return m ? parseFloat(m[1]) : fallback;
  };
  return {
    Kp: grab('Kp', 15.0),
    Ki: grab('Ki', 140.0),
    Kd: grab('Kd', 0.9),
  };
}

// Maps a token in the sketch to the physical component/pin it controls, so
// hovering the code explains what hardware each line drives.
const CODE_NOTES = {
  Kp: 'Proportional gain — how hard the motors push back per degree of tilt read from the MPU6050. Too low: it falls; too high: it shakes.',
  Ki: 'Integral gain — slowly trims a steady lean so the robot doesn’t drift off-vertical over time.',
  Kd: 'Derivative gain — damping. Reacts to how fast the tilt is changing to stop oscillation.',
  setpoint: 'The target angle: 0° = upright. The PID drives the tilt toward this.',
  pid: 'The PID controller object — the balance brain running on the Arduino.',
  PID: 'The PID controller object — the balance brain running on the Arduino.',
  Compute: 'Runs one PID step: reads tilt, produces a motor command in `output`.',
  input: 'The live tilt angle (degrees) coming from the MPU6050 IMU.',
  output: 'The PID’s motor command, sent on to the L298N driver.',
  Wire: 'I²C bus — the wires on A4 (SDA) and A5 (SCL) that talk to the MPU6050.',
  mpu: 'The MPU6050 IMU — the 6-axis tilt sensor.',
  MPU6050: 'The MPU6050 IMU — the 6-axis tilt sensor on the I²C bus.',
  initialize: 'Wakes up the MPU6050 and starts it measuring.',
  readTiltAngle: 'Reads the current tilt from the MPU6050 (via A4/A5).',
  driveMotors: 'Sends the PID output to the L298N driver → the two DC gear motors.',
  analogWrite: 'PWM out on a digital pin → an L298N input → motor speed/direction.',
  IN1: 'L298N input IN1 (Arduino D6) — one half of the left motor’s direction control.',
  IN2: 'L298N input IN2 (Arduino D9) — the other half of the left motor’s direction control.',
  IN3: 'L298N input IN3 (Arduino D10) — one half of the right motor’s direction control.',
  IN4: 'L298N input IN4 (Arduino D11) — the other half of the right motor’s direction control.',
  MPU_INT: 'The MPU6050 INT pin (Arduino D2) — pulses when a fresh reading is ready.',
  SetOutputLimits: 'Clamps the motor command to ±255, the PWM range the L298N accepts.',
  pinMode: 'Configures a digital pin as an output that drives the L298N.',
  constrain: 'Keeps the PWM value inside the valid 0–255 motor range.',
};

export function initEditor(container, onGains) {
  const cm = window.CodeMirror(container, {
    value: DEFAULT_SKETCH,
    mode: 'text/x-c++src',
    theme: 'material-darker',
    lineNumbers: true,
    tabSize: 2,
    styleActiveLine: true,
  });
  // Fill the panel
  cm.setSize('100%', '100%');

  const emit = () => onGains(parseGains(cm.getValue()));
  cm.on('change', () => emit());
  // initial
  setTimeout(emit, 0);

  // ── code → hardware hover annotations ──
  const tip = document.getElementById('tooltip');
  const wrap = cm.getWrapperElement();
  let lastWord = null;
  wrap.classList.add('annotated');
  wrap.addEventListener('mousemove', (e) => {
    const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
    const tok = cm.getTokenAt(pos);
    const word = tok && tok.string;
    const note = word && CODE_NOTES[word];
    if (note) {
      if (word !== lastWord) {
        lastWord = word;
        tip.innerHTML =
          `<span class="tt-tag tt-data">CODE → HARDWARE</span><b>${word}</b>` +
          `<div class="tt-role">${note}</div>`;
        tip.classList.remove('hidden', 'error');
      }
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top = (e.clientY + 16) + 'px';
    } else if (lastWord) {
      lastWord = null;
      tip.classList.add('hidden');
    }
  });
  wrap.addEventListener('mouseleave', () => { lastWord = null; tip.classList.add('hidden'); });

  return cm;
}
