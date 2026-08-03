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
  push_button: {
    title: 'Push Button',
    blurb: 'A momentary switch — it only closes the circuit while you hold it down. Click the button in 3D to press it.',
    unit: 'Unit 1 · Electronics Basics',
  },
  lamp: {
    title: 'Incandescent Lamp',
    blurb: 'A filament bulb. It’s just a resistor that glows: the more current flows, the brighter it shines. Draw too much and it burns out.',
    unit: 'Unit 1 · Electronics Basics',
  },
  buzzer: {
    title: 'Piezo Buzzer',
    blurb: 'Makes a tone when current passes through it. Polarised — the + and − terminals matter.',
    unit: 'Unit 1 · Electronics Basics',
  },
  diode: {
    title: 'Diode',
    blurb: 'A one-way valve for current: it conducts from anode (A) to cathode (K) once past ~0.7V, and blocks the other way. The striped band marks the cathode.',
    unit: 'Unit 1 · Electronics Basics',
  },
  photoresistor: {
    title: 'Photoresistor (LDR)',
    blurb: 'A light-dependent resistor: its resistance drops as light rises. Model the light level by editing its resistance in the Inspector.',
    unit: 'Unit 5 · Sensors',
  },
  thermistor: {
    title: 'Thermistor',
    blurb: 'A temperature-dependent resistor. Its resistance changes with heat — a simple way to sense temperature. Tune its resistance in the Inspector.',
    unit: 'Unit 5 · Sensors',
  },
  fuse: {
    title: 'Fuse',
    blurb: 'A deliberate weak link. It passes current freely until the load exceeds its rating, then “blows” to protect the rest of the circuit.',
    unit: 'Unit 1 · Electronics Basics',
  },
  capacitor: {
    title: 'Capacitor',
    blurb: 'Stores charge on two plates. Under steady DC it behaves as an open circuit (blocks current) once charged — so in this DC solver it passes almost nothing.',
    unit: 'Unit 1 · Electronics Basics',
  },
  servo: {
    title: 'Servo Motor',
    blurb: 'A geared motor with a signal line (SIG) that commands a target angle. Powered from + / −; behaves like a small motor in the circuit.',
    unit: 'Unit 3 · Motors & Drivers',
  },
  relay: {
    title: 'Relay',
    blurb: 'An electrically-controlled switch. When energised it connects COM to NO (normally-open), letting a small signal switch a bigger load.',
    unit: 'Unit 3 · Motors & Drivers',
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

  // ── new bench components ──
  'push_button.A': { title: 'Button terminal A', role: 'One side of the momentary contact. Closed only while pressed.', kind: 'data' },
  'push_button.B': { title: 'Button terminal B', role: 'The other side of the momentary contact.', kind: 'data' },
  'lamp.A': { title: 'Lamp terminal', role: 'One end of the filament. Current through it makes the bulb glow.', kind: 'power' },
  'lamp.B': { title: 'Lamp terminal', role: 'The return end of the filament.', kind: 'power' },
  'buzzer.+': { title: 'Buzzer + terminal', role: 'Positive supply into the buzzer.', kind: 'power' },
  'buzzer.-': { title: 'Buzzer − terminal', role: 'Return to ground.', kind: 'ground' },
  'diode.A': { title: 'Anode (A)', role: 'Current enters here. Conducts toward the cathode once above ~0.7V.', kind: 'power' },
  'diode.K': { title: 'Cathode (K)', role: 'Current exits here (marked by the band). Blocks flow the other way.', kind: 'power' },
  'photoresistor.A': { title: 'LDR terminal A', role: 'One side of the light-dependent resistor.', kind: 'data' },
  'photoresistor.B': { title: 'LDR terminal B', role: 'The other side of the light-dependent resistor.', kind: 'data' },
  'thermistor.A': { title: 'Thermistor terminal A', role: 'One side of the temperature-dependent resistor.', kind: 'data' },
  'thermistor.B': { title: 'Thermistor terminal B', role: 'The other side of the temperature-dependent resistor.', kind: 'data' },
  'fuse.A': { title: 'Fuse terminal A', role: 'Current in. Passes freely until the rated limit is exceeded.', kind: 'data' },
  'fuse.B': { title: 'Fuse terminal B', role: 'Current out to the protected circuit.', kind: 'data' },
  'capacitor.A': { title: 'Capacitor + plate', role: 'Positive plate. Blocks steady DC once charged.', kind: 'power' },
  'capacitor.B': { title: 'Capacitor − plate', role: 'Negative plate.', kind: 'power' },
  'servo.+': { title: 'Servo + (power)', role: 'Motor supply into the servo.', kind: 'power' },
  'servo.-': { title: 'Servo − (ground)', role: 'Return to ground.', kind: 'ground' },
  'servo.SIG': { title: 'Servo signal (SIG)', role: 'The control line that commands the target angle.', kind: 'data' },
  'relay.COM': { title: 'Relay COM (common)', role: 'The common pole that switches over to NO when the relay energises.', kind: 'data' },
  'relay.NO': { title: 'Relay NO (normally open)', role: 'Connected to COM only while the relay is on.', kind: 'data' },
};

// The rover reuses the base components under instanced namespaces (two drivers
// l298nF/l298nR, four motors motorFL/FR/RL/RR). Map an instanced compType back
// to the base entry so its pins/tooltips resolve without duplicating the data.
function baseType(t) {
  if (t === 'l298nF' || t === 'l298nR') return 'l298n';
  if (t === 'motorFL' || t === 'motorRL') return 'motorL';
  if (t === 'motorFR' || t === 'motorRR') return 'motorR';
  return t;
}

// Re-key an "compType.pin" id onto its base component (e.g. l298nF.IN1 → l298n.IN1).
function baseId(id) {
  const dot = id.indexOf('.');
  if (dot < 0) return id;
  return baseType(id.slice(0, dot)) + id.slice(dot);
}

export function pinInfo(id) { return PINS[id] || PINS[baseId(id)] || null; }
export function compInfo(type) { return COMPONENTS[type] || COMPONENTS[baseType(type)] || null; }
