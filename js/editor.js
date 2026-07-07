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
  return cm;
}
