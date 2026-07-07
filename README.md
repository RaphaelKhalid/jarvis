# SelfBalance Lab

An interactive, web-based robotics **assembly simulator** for a self-balancing
robot. Drag real components onto a chassis, wire the pins together, edit an
Arduino PID sketch, and hit **Upload** to watch a Rapier physics robot try to
balance itself.

Built as a proof-of-concept MVP — no build step, no backend.

## Features

- **3D assembly** (Three.js) — 6 recognizable parts: Arduino Uno, MPU6050 IMU,
  L298N driver, 2× DC gear motors, 7.4V LiPo. Drag from the tray; parts snap to
  chassis slots.
- **Wiring** — click a pin, then click its target. Wires render as 3D bezier
  tubes, colored by type (red = power, black = ground, yellow = data). Valid
  connections are recognized; hovering shows ✓/✗ with a hint. A live checklist
  ticks off the 13 required connections.
- **Firmware editor** (CodeMirror) — a realistic MPU6050 + L298N + PID sketch.
  Edit the `Kp` / `Ki` / `Kd` gains and they are parsed live into the simulation.
- **Physics** (Rapier) — once wiring is complete, Upload spawns an inverted
  pendulum on two wheels. A JS PID loop reads your gains and drives wheel torque.
  Well-tuned gains (≈ `Kp 15`, `Ki 140`, `Kd 0.9`) balance it; poor gains fall
  over. Live tilt readout, angle sparkline, and a **Nudge** disturbance button.

## Run locally

It's all static files — serve the folder with anything:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open the printed URL. A modern browser with WebGL + WebAssembly is required.

## Tech

Three.js · Rapier3D (WASM) · CodeMirror 5 · vanilla JS ES modules. All
dependencies load from CDN via an import map — nothing to install.

## Layout

```
index.html        markup + CDN includes
css/style.css     dark engineering theme
js/scene.js       Three.js scene, lights, chassis, slots
js/parts.js       component geometry + pin/slot definitions
js/labels.js      canvas-texture text labels
js/wiring.js      connection map, validation, 3D wires, checklist
js/editor.js      CodeMirror sketch + Kp/Ki/Kd parser
js/sim.js         Rapier inverted-pendulum + PID controller
js/main.js        orchestrator (tray, drag, raycasting, HUD, loop)
```
