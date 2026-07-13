// Lesson content — data only, interpreted by curriculum/engine.js.
// Objective types: place, placeAll, wire, wireAll, gain, sim, upright,
// speed, reach, material, airborne, fallen, recover, turns, jumps, odometer.
// `setup`: clear (empty board), assemble (pre-place), wire (pre-wire),
// gains (rewrite Kp/Ki/Kd in the sketch). `par`: seconds for 3 stars.

export const TRACKS = [
  { id: 'circuits', name: 'Circuits', icon: 'plug-zap', blurb: 'What each part does and how real wiring works.' },
  { id: 'balance', name: 'Balance & PID', icon: 'activity', blurb: 'The controller that keeps the robot upright.' },
  { id: 'driving', name: 'Driving', icon: 'gauge', blurb: 'Master the terrain: ice, hills, ramps and air.' },
  { id: 'engineering', name: 'Engineering', icon: 'wrench', blurb: 'Capstone challenges that combine everything.' },
  // Rover track — only shown while the Rover is the active robot (see engine.js).
  { id: 'rover', name: 'Rover School', icon: 'car', blurb: 'Build and drive the four-wheel skid-steer rover.' },
];

export const LESSONS = [
  // ── CIRCUITS ─────────────────────────────────────────────────
  {
    id: 'c1', track: 'circuits', title: 'Power Up',
    brief: 'Every robot starts with power. Place the battery and the Arduino, then give the Arduino electricity: positive to VIN, negative to GND.',
    setup: { clear: true },
    objectives: [
      { type: 'place', part: 'battery', text: 'Place the 7.4V LiPo battery' },
      { type: 'place', part: 'arduino', text: 'Place the Arduino Uno' },
      { type: 'wire', label: 'Arduino VIN → Bat +', text: 'Wire battery + to Arduino VIN' },
      { type: 'wire', label: 'Arduino GND → Bat −', text: 'Wire battery − to Arduino GND' },
    ],
    debrief: 'VIN and GND form a circuit — current flows from + through the board and back to −. No loop, no power.',
  },
  {
    id: 'c2', track: 'circuits', title: 'The Sensor Bus',
    brief: 'The MPU6050 measures tilt. It talks to the Arduino over I²C — a two-wire data bus (SDA data, SCL clock) — plus power and an interrupt line.',
    setup: {},
    objectives: [
      { type: 'place', part: 'mpu6050', text: 'Place the MPU6050 sensor' },
      { type: 'wire', label: 'MPU VCC → 5V', text: 'Power the sensor (VCC → 5V)' },
      { type: 'wire', label: 'MPU GND → GND', text: 'Ground the sensor (GND → GND)' },
      { type: 'wire', label: 'MPU SDA → A4', text: 'Data line: SDA → A4' },
      { type: 'wire', label: 'MPU SCL → A5', text: 'Clock line: SCL → A5' },
      { type: 'wire', label: 'MPU INT → D2', text: 'Interrupt: INT → D2' },
    ],
    debrief: 'I²C lets many sensors share two wires. INT pulses when fresh tilt data is ready, so the Arduino never reads stale numbers.',
  },
  {
    id: 'c3', track: 'circuits', title: 'Muscle Wiring',
    brief: 'Motors need more current than the Arduino can supply. The L298N driver is the muscle: battery power in, motor power out.',
    setup: {},
    objectives: [
      { type: 'place', part: 'l298n', text: 'Place the L298N driver' },
      { type: 'place', part: 'motor', n: 2, text: 'Place both gear motors' },
      { type: 'wire', label: 'L298N 12V → Bat +', text: 'Battery + → L298N 12V' },
      { type: 'wire', label: 'L298N GND → Bat −', text: 'Battery − → L298N GND' },
      { type: 'wire', label: 'L298N OUT1 → L Motor +', text: 'OUT1 → left motor +' },
      { type: 'wire', label: 'L298N OUT2 → L Motor −', text: 'OUT2 → left motor −' },
      { type: 'wire', label: 'L298N OUT3 → R Motor +', text: 'OUT3 → right motor +' },
      { type: 'wire', label: 'L298N OUT4 → R Motor −', text: 'OUT4 → right motor −' },
    ],
    debrief: 'The driver is an H-bridge: it can flip which motor wire gets + and −, which is how the robot reverses.',
  },
  {
    id: 'c4', track: 'circuits', title: 'Signal Lines',
    brief: 'The Arduino steers the muscle with four thin signal wires. IN1/IN2 control the left motor, IN3/IN4 the right — PWM pulses set the speed.',
    setup: {},
    objectives: [
      { type: 'wire', label: 'L298N IN1 → D6', text: 'IN1 → D6' },
      { type: 'wire', label: 'L298N IN2 → D9', text: 'IN2 → D9' },
      { type: 'wire', label: 'L298N IN3 → D10', text: 'IN3 → D10' },
      { type: 'wire', label: 'L298N IN4 → D11', text: 'IN4 → D11' },
      { type: 'wireAll', text: 'Complete every remaining connection' },
    ],
    debrief: 'Signal wires carry information, not power — a few milliamps telling the H-bridge what to do with the battery’s amps.',
  },
  {
    id: 'c5', track: 'circuits', title: 'Full System Check', par: 150,
    brief: 'From an empty chassis: build and wire the entire robot yourself, then upload. You know every wire now — prove it.',
    setup: { clear: true },
    objectives: [
      { type: 'placeAll', text: 'Place all six parts' },
      { type: 'wireAll', text: 'Complete all 17 connections' },
      { type: 'sim', text: 'Hit UPLOAD and boot the robot' },
    ],
    debrief: 'That’s a real self-balancing robot wiring diagram — the same one you’d use on a physical build.',
  },

  // ── BALANCE & PID ────────────────────────────────────────────
  {
    id: 'b1', track: 'balance', title: 'Meet the Gains',
    brief: 'Open the sketch on the right. Kp is the proportional gain — how hard the motors push back per degree of tilt. Try raising it, then set it back.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'gain', k: 'Kp', min: 18, max: 30, text: 'Set Kp between 18 and 30' },
      { type: 'gain', k: 'Kp', min: 14, max: 16, text: 'Return Kp to 15 (the tuned value)' },
    ],
    debrief: 'Too little Kp and the robot responds weakly; too much and it overcorrects into shaking. Tuning is finding the sweet spot.',
  },
  {
    id: 'b2', track: 'balance', title: 'The Integral',
    brief: 'Ki fixes slow, steady lean. Zero it to see what a P-D controller would tolerate, then restore it.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'gain', k: 'Ki', min: 0, max: 0, text: 'Set Ki to 0' },
      { type: 'gain', k: 'Ki', min: 120, max: 160, text: 'Restore Ki to ~140' },
    ],
    debrief: 'The integral term adds up leftover error over time. Without it, a robot with uneven weight would balance slightly tilted forever.',
  },
  {
    id: 'b3', track: 'balance', title: 'Damping',
    brief: 'Kd is the derivative — it reacts to how FAST the tilt is changing, like a shock absorber. Crank it, then bring it back.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'gain', k: 'Kd', min: 2, max: 5, text: 'Set Kd between 2 and 5' },
      { type: 'gain', k: 'Kd', min: 0.8, max: 1.0, text: 'Return Kd to 0.9' },
    ],
    debrief: 'P looks at where you are, I at where you’ve been, D at where you’re heading. Together: PID.',
  },
  {
    id: 'b4', track: 'balance', title: 'Boot & Balance', par: 60,
    brief: 'Upload with the tuned gains and let the robot stand on its own. Watch the green tilt trace — that wobble is the PID working 60 times a second.',
    setup: { assemble: true, wire: true, gains: { Kp: 15, Ki: 140, Kd: 0.9 } },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'upright', secs: 10, text: 'Stay upright for 10 seconds' },
    ],
    debrief: 'An inverted pendulum is unstable — left alone it falls in under a second. Continuous correction is the only reason it stands.',
  },
  {
    id: 'b5', track: 'balance', title: 'Disturbance Rejection', par: 90,
    brief: 'A controller proves itself under stress. Boot up, hit the Nudge button to shove the robot, and watch the tilt trace spike and settle.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'wobble', text: 'Press NUDGE to shove the robot' },
      { type: 'upright', secs: 8, text: 'Recover and hold steady 8 seconds' },
    ],
    debrief: 'That spike-and-settle shape is the controller’s signature. Faster settling with less overshoot = better tuning.',
  },

  // ── DRIVING ──────────────────────────────────────────────────
  {
    id: 'd1', track: 'driving', title: 'First Drive', par: 45,
    brief: 'Time to move. The robot leans into acceleration like a Segway. Get up to speed with W.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'speed', min: 20, secs: 2, text: 'Hold 20+ u/s for 2 seconds' },
    ],
    debrief: 'To accelerate forward, a balancing robot first leans forward — then drives its wheels to chase its own fall.',
  },
  {
    id: 'd2', track: 'driving', title: 'Carve Some Turns', par: 60,
    brief: 'A and D steer by driving the wheels at different speeds. Carve at least two full circles worth of turning.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'turns', rad: 12.5, text: 'Turn ~2 full circles (while moving)' },
    ],
    debrief: 'Differential drive: no steering wheel, just a speed difference between the two motors.',
  },
  {
    id: 'd3', track: 'driving', title: 'Ice Walker', par: 90,
    brief: 'There’s an ice patch out there — low grip, long stops. Find it, cross it, and make it back onto solid ground without wiping out.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'material', name: 'ice', text: 'Drive onto the ice' },
      { type: 'material', name: 'normal', text: 'Make it back off the ice (don’t crash!)' },
    ],
    debrief: 'Less friction = less control authority. Real robots slow down and steer gently on slick surfaces — now you know why.',
  },
  {
    id: 'd4', track: 'driving', title: 'Get Some Air', par: 90,
    brief: 'Straight ahead of spawn there’s a launch ramp. Hit it fast, fly, and stick the landing.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'airborne', text: 'Launch off a ramp (or SPACE-jump at speed)' },
      { type: 'upright', secs: 2, text: 'Stick the landing' },
    ],
    debrief: 'Mid-air there’s nothing to push against — no control. Line up your landing before you leave the ground.',
  },
  {
    id: 'd5', track: 'driving', title: 'Wipeout Practice', par: 90,
    brief: 'Every driver crashes. Cause a wipeout on purpose — land badly or spin out on ice — then use SPACE to get back up and stabilize.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'fallen', text: 'Wipe out (hard landing or ice spin-out)' },
      { type: 'recover', text: 'Press SPACE to self-right' },
      { type: 'upright', secs: 5, text: 'Stabilize for 5 seconds' },
    ],
    debrief: 'Failure recovery is a designed feature, not luck — real robots have self-righting routines too.',
  },

  // ── ENGINEERING ──────────────────────────────────────────────
  {
    id: 'e1', track: 'engineering', title: 'Grand Tour', par: 150,
    brief: 'Three ramps mark the corners of the arena. Visit all three — navigation, hills, and endurance in one run.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'reach', x: 0, z: 52, r: 16, text: 'Reach the north ramp' },
      { type: 'reach', x: 62, z: -34, r: 16, text: 'Reach the south-east ramp' },
      { type: 'reach', x: -58, z: 46, r: 16, text: 'Reach the north-west ramp' },
    ],
    debrief: 'You just did waypoint navigation — the core of every delivery robot’s job.',
  },
  {
    id: 'e2', track: 'engineering', title: 'Speed Run', par: 35,
    brief: 'Straight sprint: from spawn to the north ramp. Three stars under 35 seconds total.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'reach', x: 0, z: 52, r: 14, text: 'Reach the north ramp — fast' },
    ],
    debrief: 'Speed vs stability is the eternal robot trade-off. The faster you go, the harder the terrain punishes mistakes.',
  },
  {
    id: 'e3', track: 'engineering', title: 'Triple Jump', par: 120,
    brief: 'Catch air three separate times — ramps or SPACE-jumps at speed both count. Land them all.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'jumps', n: 3, text: 'Go airborne 3 times' },
    ],
    debrief: 'Each landing is a controlled crash the suspension (and controller) must absorb.',
  },
  {
    id: 'e4', track: 'engineering', title: 'Iron Bot', par: 180,
    brief: 'Endurance: cover 400 units of ground without a single wipeout. Plan your route, respect the ice.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the robot' },
      { type: 'odometer', dist: 400, text: 'Drive 400 units without wiping out' },
    ],
    debrief: 'Reliability engineering: it’s not the top speed that matters, it’s never having to stop.',
  },
  {
    id: 'e5', track: 'engineering', title: 'Final Exam', par: 300,
    brief: 'Everything, from scratch: build the robot, wire it, upload, sprint to the north ramp, catch air, and come home.',
    setup: { clear: true },
    objectives: [
      { type: 'placeAll', text: 'Assemble the robot' },
      { type: 'wireAll', text: 'Complete all wiring' },
      { type: 'sim', text: 'Upload and boot' },
      { type: 'reach', x: 0, z: 52, r: 16, text: 'Reach the north ramp' },
      { type: 'airborne', text: 'Catch air' },
      { type: 'reach', x: 0, z: 0, r: 12, text: 'Return home' },
    ],
    debrief: 'Assembly, wiring, control, navigation, recovery — that’s the full robotics stack. You built all of it.',
  },

  // ── ROVER SCHOOL (robot: 'rover') ────────────────────────────
  {
    id: 'rv1', track: 'rover', robot: 'rover', title: 'Build the Rover',
    brief: 'The rover has no balance sensor — it rolls on four wheels. Place all eight parts (a brain, two L298N drivers, four motors, a battery) and wire the full skid-steer loom. Auto-wire is there if you get stuck.',
    setup: { clear: true },
    objectives: [
      { type: 'placeAll', text: 'Place all 8 parts on the chassis' },
      { type: 'wireAll', text: 'Complete every connection' },
    ],
    debrief: 'Two drivers, four motors: the left pair shares one set of signal lines, the right pair another. Drive them together and you have a tank — no steering wheel needed.',
  },
  {
    id: 'rv2', track: 'rover', robot: 'rover', title: 'Roll Out', par: 45,
    brief: 'No balancing to worry about — just power and go. Upload, then get the rover up to speed with W.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the rover' },
      { type: 'speed', min: 18, secs: 2, text: 'Hold 18+ u/s for 2 seconds' },
    ],
    debrief: 'A four-wheeled rover is statically stable — it stands still on its own. All the firmware does is set wheel speed, no PID required.',
  },
  {
    id: 'rv3', track: 'rover', robot: 'rover', title: 'Tank Turn', par: 60,
    brief: 'Skid-steer turns by driving the left and right wheels at different speeds — exactly like a tank. Carve at least two full circles of turning.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the rover' },
      { type: 'turns', rad: 12.5, text: 'Turn ~2 full circles (while moving)' },
    ],
    debrief: 'With no steering axle, a skid-steer literally skids the wheels sideways to rotate. Tight turns, but they scrub the tyres — you can see the tracks it leaves.',
  },
  {
    id: 'rv4', track: 'rover', robot: 'rover', title: 'Off-Road', par: 100,
    brief: 'Four-wheel drive shrugs off terrain a balancer would fear. Find the ice patch, cross it, then climb out to the north ramp.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the rover' },
      { type: 'material', name: 'ice', text: 'Drive onto the ice patch' },
      { type: 'reach', x: 0, z: 52, r: 16, text: 'Reach the north ramp' },
    ],
    debrief: 'Low centre of gravity + four contact patches = grip a two-wheeler can’t match. This is why rovers, not balancers, go exploring.',
  },
  {
    id: 'rv5', track: 'rover', robot: 'rover', title: 'Rover Rally', par: 150,
    brief: 'Everything together: reach the north ramp, catch some air, and race back to the start. Beat the clock for three stars.',
    setup: { assemble: true, wire: true },
    objectives: [
      { type: 'sim', text: 'Upload and boot the rover' },
      { type: 'reach', x: 0, z: 52, r: 16, text: 'Reach the north ramp' },
      { type: 'jumps', n: 2, text: 'Catch air twice (ramps or SPACE at speed)' },
      { type: 'reach', x: 0, z: 0, r: 12, text: 'Race back to the start' },
    ],
    debrief: 'You built it, wired it, and drove it across everything the arena has. That’s the whole engineering loop — on a second robot the platform now supports.',
  },
];
