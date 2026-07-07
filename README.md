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
- **Auto-wire** — skip the manual step: **⚡ instant** places every part and
  draws all 13 connections at once, or **▶ step-by-step** drops the parts and
  adds each wire one at a time so you can watch the assembly come together.
- **Physics** (Rapier) — once wiring is complete, Upload spawns a chrome
  sphere-bot (camera dome, gripper arms, fat treaded wheels) balancing on two
  wheels in a bright, walled **arena** with rolling hills. A JS PID loop reads
  your gains and keeps it upright; well-tuned gains (≈ `Kp 15`, `Ki 140`,
  `Kd 0.9`) hold it steady. Live tilt readout, angle sparkline, **Nudge**.
- **Drive it (W/A/S/D)** — driving is the primary control: W/S drive, A/D
  steer. A wheel-speed servo moves the bot while the PID keeps it balanced, and
  a heading-hold keeps it straight. A follow-cam tracks it; perimeter walls keep
  it in the arena; it holds station when you let go.

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
