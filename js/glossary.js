// Plain-language glossary for every component and every pin.
// Keyed so the UI can explain "what is IN2?" on hover.
//   COMPONENTS[compType]        -> { title, blurb, unit }
//   PINS[`${compType}.${pin}`]  -> { title, role, kind }   kind: power|ground|data
// `kind` is used to color the tooltip accent and matches wiring.js semantics.

export const COMPONENTS = {
  arduino: {
    title: 'Arduino Uno',
    blurb: 'The brain. Runs your firmware: reads tilt from the IMU, computes the PID correction, and sends motor commands to the driver.',
    unit: 'Unit 2 · Microcontrollers',
  },
  mpu6050: {
    title: 'MPU6050 IMU',
    blurb: 'A 6-axis motion sensor (3-axis gyroscope + 3-axis accelerometer). It measures how far the robot is tilted — the input to the balance loop.',
    unit: 'Unit 4 · PID Control',
  },
  l298n: {
    title: 'L298N Motor Driver',
    blurb: 'A dual H-bridge. The Arduino’s logic pins can’t supply motor current directly, so this chip switches battery power to the motors under Arduino control.',
    unit: 'Unit 3 · Motors & Drivers',
  },
  motorL: {
    title: 'DC Gear Motor (left)',
    blurb: 'Turns electrical power into wheel torque through a gearbox. Two motors — one per wheel — let the robot balance, drive, and steer.',
    unit: 'Unit 3 · Motors & Drivers',
  },
  motorR: {
    title: 'DC Gear Motor (right)',
    blurb: 'Turns electrical power into wheel torque through a gearbox. Two motors — one per wheel — let the robot balance, drive, and steer.',
    unit: 'Unit 3 · Motors & Drivers',
  },
  battery: {
    title: '7.4V LiPo (2S)',
    blurb: 'The power source. Feeds ~7.4V to the motor driver and to the Arduino’s VIN. Every ground in the circuit ties back here.',
    unit: 'Unit 1 · Electronics Basics',
  },
};

// pin roles. `kind` drives the tooltip accent color.
export const PINS = {
  // ── Arduino ──
  'arduino.D2':  { title: 'Digital pin 2', role: 'Interrupt input — the IMU pulses this line when a fresh measurement is ready.', kind: 'data' },
  'arduino.D6':  { title: 'Digital pin 6 (PWM)', role: 'Motor A speed/direction command out to the driver’s IN1.', kind: 'data' },
  'arduino.D9':  { title: 'Digital pin 9 (PWM)', role: 'Motor A speed/direction command out to the driver’s IN2.', kind: 'data' },
  'arduino.D10': { title: 'Digital pin 10 (PWM)', role: 'Motor B speed/direction command out to the driver’s IN3.', kind: 'data' },
  'arduino.D11': { title: 'Digital pin 11 (PWM)', role: 'Motor B speed/direction command out to the driver’s IN4.', kind: 'data' },
  'arduino.A4':  { title: 'Analog pin A4 (SDA)', role: 'I²C data line — talks to the IMU. Pairs with A5.', kind: 'data' },
  'arduino.A5':  { title: 'Analog pin A5 (SCL)', role: 'I²C clock line — times the IMU conversation. Pairs with A4.', kind: 'data' },
  'arduino.5V':  { title: '5V output', role: 'Regulated 5V supply — powers the low-current IMU.', kind: 'power' },
  'arduino.VIN': { title: 'VIN (voltage in)', role: 'Raw battery power in — how the Arduino itself is fed from the LiPo.', kind: 'power' },
  'arduino.GND': { title: 'Ground', role: 'Common 0V reference. Every board must share ground or signals are meaningless.', kind: 'ground' },

  // ── MPU6050 ──
  'mpu6050.VCC': { title: 'VCC (power in)', role: 'Sensor supply — takes 5V from the Arduino.', kind: 'power' },
  'mpu6050.GND': { title: 'Ground', role: 'Shared 0V reference back to the Arduino.', kind: 'ground' },
  'mpu6050.SCL': { title: 'SCL (I²C clock)', role: 'Clock line into the Arduino’s A5 — times each bit of data.', kind: 'data' },
  'mpu6050.SDA': { title: 'SDA (I²C data)', role: 'Data line into the Arduino’s A4 — carries the tilt readings.', kind: 'data' },
  'mpu6050.INT': { title: 'INT (interrupt out)', role: 'Fires when new motion data is ready, so the Arduino reads at exactly the right moment.', kind: 'data' },
  'mpu6050.AD0': { title: 'AD0 (address select)', role: 'Picks the sensor’s I²C address. Left unconnected here (default address).', kind: 'data' },

  // ── L298N ──
  'l298n.ENA': { title: 'ENA (enable A)', role: 'Enables motor-A output. Tied high internally in this build.', kind: 'data' },
  'l298n.IN1': { title: 'IN1 (motor A input)', role: 'One half of motor A’s direction control — driven by Arduino D6.', kind: 'data' },
  'l298n.IN2': { title: 'IN2 (motor A input)', role: 'The other half of motor A’s direction control — driven by Arduino D9. IN1+IN2 together set spin direction & braking.', kind: 'data' },
  'l298n.IN3': { title: 'IN3 (motor B input)', role: 'One half of motor B’s direction control — driven by Arduino D10.', kind: 'data' },
  'l298n.IN4': { title: 'IN4 (motor B input)', role: 'The other half of motor B’s direction control — driven by Arduino D11.', kind: 'data' },
  'l298n.ENB': { title: 'ENB (enable B)', role: 'Enables motor-B output. Tied high internally in this build.', kind: 'data' },
  'l298n.12V': { title: '12V (motor power in)', role: 'High-current supply for the motors, straight from the battery +.', kind: 'power' },
  'l298n.GND': { title: 'Ground', role: 'Power + logic 0V reference, shared with the battery − and Arduino.', kind: 'ground' },
  'l298n.5V':  { title: '5V (regulated out)', role: 'Onboard regulator output. Unused here — the Arduino supplies the IMU.', kind: 'power' },
  'l298n.OUT1': { title: 'OUT1 (motor A +)', role: 'Drives one terminal of the left motor.', kind: 'power' },
  'l298n.OUT2': { title: 'OUT2 (motor A −)', role: 'Drives the other terminal of the left motor.', kind: 'power' },
  'l298n.OUT3': { title: 'OUT3 (motor B +)', role: 'Drives one terminal of the right motor.', kind: 'power' },
  'l298n.OUT4': { title: 'OUT4 (motor B −)', role: 'Drives the other terminal of the right motor.', kind: 'power' },

  // ── motors ──
  'motorL.M+': { title: 'Motor + terminal', role: 'Connects to the driver’s OUT1. Swapping +/− reverses the wheel.', kind: 'power' },
  'motorL.M-': { title: 'Motor − terminal', role: 'Connects to the driver’s OUT2.', kind: 'power' },
  'motorR.M+': { title: 'Motor + terminal', role: 'Connects to the driver’s OUT3. Swapping +/− reverses the wheel.', kind: 'power' },
  'motorR.M-': { title: 'Motor − terminal', role: 'Connects to the driver’s OUT4.', kind: 'power' },

  // ── battery ──
  'battery.+': { title: 'Positive terminal (+7.4V)', role: 'Feeds the motor driver’s 12V input and the Arduino’s VIN.', kind: 'power' },
  'battery.-': { title: 'Negative terminal (0V)', role: 'The circuit’s ground reference — everything returns here.', kind: 'ground' },
};

export function pinInfo(id) { return PINS[id] || null; }
export function compInfo(type) { return COMPONENTS[type] || null; }

// Explain a required connection (used on wire hover).
export function connectionBlurb(req) {
  const a = PINS[req.a], b = PINS[req.b];
  if (!a || !b) return '';
  return `${a.title} → ${b.title}`;
}
