// Creator assembly — the M1 build surface, fused to window.__api. It owns NO
// document state: it renders the 3D world as a pure view over api.get_document()
// and every user action (drop a part, wire two pins, clear) is an API call
// followed by a re-sync. This replaces the self-balancer's slot-tray + REQUIRED
// wiring (assembly.js + wiring.js) for the doc-model world.
//
//   tray drag → api.place_component     pin → pin → api.connect
//   clear     → api.remove_component    right-click a wire → api.disconnect
//
// The doc is the single source of truth; undo/redo/scripts all flow back here
// through sync() because the API's onDocChange fires it.
import * as THREE from 'three';
import { LIBRARY, pinsFor, baseType } from '../model/library.js';
import { makeBattery, makeMotor } from '../parts.js';
import { makeFlatLabel } from '../labels.js';
import { pinInfo } from '../glossary.js';
import { audio } from '../audio.js';
import { state } from './state.js';
import { KIND_LABEL } from './hud.js';
import { track, trackOnce } from './analytics.js';

// tray metadata (name/desc/help) per library type — the human-facing card copy.
const CARD = {
  battery: { name: '7.4V LiPo', swatch: '#3d5a8f', desc: '2S battery pack',
    help: 'The power source. Its + and − terminals push current through whatever you wire across them.' },
  motor: { name: 'DC Gear Motor', swatch: '#f0c020', desc: 'Geared motor + wheel',
    help: 'Current through A→B makes it spin. Reverse the wires and it spins the other way.' },
  resistor: { name: 'Resistor', swatch: '#d8c9a0', desc: '100 Ω, in series',
    help: 'Limits current. Put one in series with the motor and it draws less — the motor spins slower. Non-polar: either lead works.' },
  switch: { name: 'Switch', swatch: '#7bd88f', desc: 'Break / make the loop',
    help: 'Click the switch body to open or close the circuit. Open = no current = the motor stops.' },
  led: { name: 'LED', swatch: '#ff5566', desc: 'Lights when current flows',
    help: 'Polar: current only flows anode (A, long leg) → cathode (K). Wire it the right way and it glows; backwards it stays dark. Needs a resistor in series or it burns out.' },
};

// A motor mesh whose two terminals are named A / B (to match the library),
// reusing the self-balancer's nicely-detailed motor geometry.
function makeMotorAB() {
  const g = makeMotor(1);
  g.userData.type = 'motor';
  const names = ['A', 'B'];
  g.userData.pins.forEach((p, i) => {
    p.name = names[i] || p.name;
    // the motor geometry labels its terminals M+/M-; the library names them A/B.
    // swap the visible flat label so the pin you click matches its tooltip id.
    const old = p.obj.userData.labelMesh;
    const lp = p.obj.userData.labelPos;
    if (old && lp) {
      g.remove(old); old.geometry?.dispose?.();
      const fresh = makeFlatLabel(p.name, 0.32, { color: '#e8eef5' });
      fresh.position.set(lp.x, lp.y + 0.02, lp.z + 0.34 * lp.side);
      g.add(fresh); p.obj.userData.labelMesh = fresh;
    }
  });
  return g;   // g.userData.wheelMeshes (tire+hub) carries through for build-mode spin
}
// small gold lead-pin, registered as an endpoint on the group.
function addLeadPin(g, name, x, y, z) {
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.35 }));
  pin.position.set(x, y + 0.25, z);
  g.userData.pins.push({ name, obj: pin });
  g.add(pin);
  return pin;
}

// passive resistor: beige body with colour bands + two leads (A, B).
function makeResistorMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'resistor', pins: [] };
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 2.6, 16),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.6 }));
  body.rotation.z = Math.PI / 2; body.position.y = 1.2; body.castShadow = true;
  g.add(body);
  [0x8b4513, 0x111111, 0xaa2222, 0xc8a000].forEach((c, i) => {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.63, 0.63, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    band.rotation.z = Math.PI / 2; band.position.set(-0.7 + i * 0.42, 1.2, 0);
    g.add(band);
  });
  addLeadPin(g, 'A', -1.7, 1.2, 0);
  addLeadPin(g, 'B', 1.7, 1.2, 0);
  return g;
}

// switch: base + tilting lever + indicator dot. Click the body to toggle (wired
// in the click handler); the lever/indicator reflect params.closed via sync().
function makeSwitchMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'switch', pins: [] };
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.9, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7, metalness: 0.2 }));
  base.position.y = 0.45; base.castShadow = true;
  g.add(base);
  const lever = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.35, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xb0b4bc, metalness: 0.6, roughness: 0.4 }));
  lever.position.set(0, 1.05, 0); lever.rotation.z = 0.4;
  lever.userData.role = 'sw-lever';
  g.add(lever);
  const ind = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x333a33, emissive: 0x000000, emissiveIntensity: 1 }));
  ind.position.set(0.95, 0.95, 0.95); ind.userData.role = 'sw-ind';
  g.add(ind);
  addLeadPin(g, 'A', -1.7, 0.9, 0);
  addLeadPin(g, 'B', 1.7, 0.9, 0);
  return g;
}

// reflect a switch component's closed state on its lever + indicator.
function updateSwitchVisual(group, closed) {
  group.traverse((o) => {
    if (o.userData?.role === 'sw-lever') o.rotation.z = closed ? -0.4 : 0.4;
    if (o.userData?.role === 'sw-ind') o.material.emissive.setHex(closed ? 0x2ecc71 : 0x000000);
  });
}

// LED: a domed lens (role 'led-lens', glows with current) on two legs (A = long
// anode leg, K = short cathode leg). The dome catches the bloom pass when lit.
function makeLedMesh() {
  const g = new THREE.Group();
  g.userData = { type: 'led', pins: [] };
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshStandardMaterial({ color: 0xff5566, emissive: 0xff2233,
      emissiveIntensity: 0, roughness: 0.25, metalness: 0.1,
      transparent: true, opacity: 0.9 }));
  lens.position.y = 1.5; lens.userData.role = 'led-lens'; lens.castShadow = true;
  g.add(lens);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.82, 0.5, 20),
    new THREE.MeshStandardMaterial({ color: 0xcc3344, roughness: 0.4 }));
  collar.position.y = 1.05; g.add(collar);
  addLeadPin(g, 'A', -0.4, 0.0, 0);   // long leg = anode
  addLeadPin(g, 'K', 0.4, 0.0, 0);    // short leg = cathode
  return g;
}

// brightness ∝ current toward its rated max; dark when reverse-biased / off.
function updateLedVisual(group, amps, maxCurrent) {
  const frac = Math.max(0, Math.min(1, Math.abs(amps || 0) / Math.max(maxCurrent || 0.03, 1e-6)));
  group.traverse((o) => {
    if (o.userData?.role === 'led-lens') o.material.emissiveIntensity = frac * 2.4;
  });
}

const FACTORY = { battery: makeBattery, motor: makeMotorAB, resistor: makeResistorMesh, switch: makeSwitchMesh, led: makeLedMesh };

const KIND_COLOR = { power: 0xff4d4d, ground: 0x2a2f3a, data: 0xffd166 };
const TW_OPEN = 'crosshair';

function pinTooltipHtml(id) {
  const info = pinInfo(id);
  if (!info) return `<b>${id}</b>`;
  const tag = KIND_LABEL[info.kind] || '';
  return `<span class="tt-tag tt-${info.kind}">${tag}</span><b>${info.title}</b>` +
         `<div class="tt-role">${info.role}</div><span class="unit">${id}</span>`;
}

export function initCreatorAssembly({ canvas, scene, camera, controls, api, hud }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const group = new THREE.Group();
  scene.add(group);
  const wireGroup = new THREE.Group();
  group.add(wireGroup);

  const meshes = new Map();        // compId -> THREE.Group
  const endpoints = new Map();     // "compId.pin" -> pin mesh
  const wires = [];                // { mesh, ids:[a,b] }
  let pending = null;              // armed endpoint id (click-to-wire)

  canvas.style.cursor = TW_OPEN;

  // ── parts tray ────────────────────────────────────────────────
  const tray = document.getElementById('parts-tray');
  tray.innerHTML = '';
  for (const type of Object.keys(LIBRARY)) {
    const meta = CARD[type] || { name: type, swatch: '#888', desc: '', help: '' };
    const card = document.createElement('div');
    card.className = 'part-card';
    card.dataset.type = type;
    card.innerHTML = `
      <div class="part-name"><span class="part-swatch" style="background:${meta.swatch}"></span>${meta.name}</div>
      <div class="part-desc">${meta.desc}</div>
      <span class="help-icon" title="">?</span>`;
    tray.appendChild(card);
    const help = card.querySelector('.help-icon');
    help.addEventListener('mouseenter', (e) => hud.showTooltip(e, meta.help));
    help.addEventListener('mouseleave', hud.hideTooltip);
    help.addEventListener('mousemove', hud.moveTooltip);
    card.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('help-icon')) return;
      if (state.mode !== 'assembly') return;
      startDrag(type, e);
    });
  }

  // ── drag a card onto the workspace → api.place_component ───────
  let drag = null;
  function startDrag(type, e) {
    const meta = CARD[type] || { name: type, swatch: '#888' };
    const ghost = document.createElement('div');
    ghost.className = 'part-card';
    ghost.style.cssText = 'position:fixed;z-index:200;pointer-events:none;opacity:.85;width:200px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    ghost.innerHTML = `<div class="part-name"><span class="part-swatch" style="background:${meta.swatch}"></span>${meta.name}</div>`;
    document.body.appendChild(ghost);
    drag = { type, ghost };
    moveGhost(e);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  }
  function moveGhost(e) {
    if (!drag) return;
    drag.ghost.style.left = (e.clientX + 14) + 'px';
    drag.ghost.style.top = (e.clientY - 10) + 'px';
  }
  function onDragMove(e) { moveGhost(e); }
  function onDragEnd(e) {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    const { type } = drag;
    drag.ghost.remove();
    drag = null;
    const rect = canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
    // project the drop point onto the y=1 build plane, spread parts a little
    const pos = dropPoint(e) || [0, 1, 0];
    const res = api.place_component({ type, transform: { pos, rot: [0, 0, 0] } });
    if (res.ok) { audio.place(); trackOnce('place', { type }); }
    sync();
    hud.setStatus(api.get_document().components.length >= 2
      ? 'Click a pin, then its target pin, to wire them'
      : 'Keep placing parts…');
    hud.refreshChecklist();
  }
  const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  function dropPoint(e) {
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(_plane, hit)) return null;
    return [hit.x, 1, hit.z];
  }

  // ── sync: reconcile the 3D world with the document ────────────
  function sync() {
    const doc = api.get_document();
    const live = new Set(doc.components.map(c => c.id));
    // solved currents drive live glows (LED brightness); best-effort.
    let elec = null;
    try { elec = api.read_electrical(); } catch { /* ignore */ }

    // add / move component meshes
    for (const c of doc.components) {
      let g = meshes.get(c.id);
      if (!g) {
        g = (FACTORY[baseType(c.type)] || makeBattery)();
        for (const p of g.userData.pins) {
          const epId = `${c.id}.${p.name}`;
          p.obj.userData.endpointId = epId;
          endpoints.set(epId, p.obj);
        }
        group.add(g);
        meshes.set(c.id, g);
      }
      const p = c.transform?.pos || [0, 1, 0];
      const r = c.transform?.rot || [0, 0, 0];
      g.position.set(p[0], p[1], p[2]);
      g.rotation.set(r[0], r[1], r[2]);
      if (baseType(c.type) === 'switch') updateSwitchVisual(g, c.params?.closed === true);
      if (baseType(c.type) === 'led') updateLedVisual(g, elec?.current?.[c.id], c.params?.maxCurrent);
    }
    // remove meshes for deleted components
    for (const [id, g] of meshes) {
      if (live.has(id)) continue;
      group.remove(g);
      g.traverse(o => o.geometry?.dispose?.());
      meshes.delete(id);
      for (const key of [...endpoints.keys()]) if (key.startsWith(id + '.')) endpoints.delete(key);
      if (pending && pending.startsWith(id + '.')) pending = null;
    }
    group.updateMatrixWorld(true);
    rebuildWires(doc.nets);
  }

  // wires are a view over doc.nets: one tube per adjacent endpoint pair
  function rebuildWires(nets) {
    for (const w of wires) { wireGroup.remove(w.mesh); w.mesh.geometry.dispose(); }
    wires.length = 0;
    for (const net of nets) {
      const kind = netKind(net);
      const eps = net.endpoints;
      for (let i = 1; i < eps.length; i++) addWire(eps[i - 1], eps[i], net.color, kind);
    }
  }
  function netKind(net) {
    // color the tube by the electrical role of its endpoints
    const roles = net.endpoints.map(roleOf);
    if (roles.includes('power+')) return 'power';
    if (roles.includes('power-') || roles.includes('gnd')) return 'ground';
    return 'data';
  }
  function roleOf(epId) {
    const [id, pin] = epId.split('.');
    const c = api.get_document().components.find(x => x.id === id);
    if (!c) return null;
    return (pinsFor(c.type).find(p => p.name === pin) || {}).role || null;
  }
  function addWire(idA, idB, color, kind) {
    const pA = worldPosOf(idA), pB = worldPosOf(idB);
    if (!pA || !pB) return;
    const curve = curveFor(pA, pB);
    const geo = new THREE.TubeGeometry(curve, 24, 0.14, 8, false);
    const hex = color ? new THREE.Color(color).getHex() : (KIND_COLOR[kind] ?? 0xffd166);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, metalness: 0.2 }));
    mesh.userData.ids = [idA, idB];
    wireGroup.add(mesh);
    wires.push({ mesh, ids: [idA, idB] });
  }
  function curveFor(pA, pB) {
    const mid = pA.clone().add(pB).multiplyScalar(0.5);
    const lift = Math.max(2.5, pA.distanceTo(pB) * 0.35);
    mid.y += lift;
    const c1 = pA.clone().lerp(mid, 0.5); c1.y += lift * 0.3;
    const c2 = pB.clone().lerp(mid, 0.5); c2.y += lift * 0.3;
    return new THREE.CubicBezierCurve3(pA, c1, c2, pB);
  }
  function worldPosOf(id) {
    const obj = endpoints.get(id);
    if (!obj) return null;
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    v.y += 0.15;
    return v;
  }

  // ── pin picking (with screen-space snap) ──────────────────────
  function updatePointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  const SNAP_PX = 26;
  const _pv = new THREE.Vector3();
  function pickPin() {
    const pinMeshes = [...endpoints.values()];
    const hit = raycaster.intersectObjects(pinMeshes, false)[0];
    if (hit) return hit.object;
    const r = canvas.getBoundingClientRect();
    const px = ((pointer.x + 1) / 2) * r.width;
    const py = ((1 - pointer.y) / 2) * r.height;
    let best = null, bestD = SNAP_PX;
    for (const m of pinMeshes) {
      m.getWorldPosition(_pv); _pv.project(camera);
      if (_pv.z > 1) continue;
      const sx = ((_pv.x + 1) / 2) * r.width, sy = ((1 - _pv.y) / 2) * r.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }
  // nearest switch component under the pointer (for click-to-toggle).
  function pickSwitch() {
    const swIds = new Set(api.get_document().components
      .filter(c => baseType(c.type) === 'switch').map(c => c.id));
    const id = pickComponent();
    return swIds.has(id) ? id : null;
  }
  // nearest whole component under the pointer (its body OR pins) — for
  // right-click-to-remove and drag-to-move. Returns the compId or null.
  function pickComponent() {
    const targets = [];
    for (const c of api.get_document().components) {
      const g = meshes.get(c.id);
      if (g) g.traverse(o => { if (o.isMesh) { o.userData._compId = c.id; targets.push(o); } });
    }
    const hit = raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData._compId : null;
  }
  function highlightPin(id, on) {
    const obj = endpoints.get(id);
    if (!obj) return;
    if (on) {
      obj.material = obj.material.clone();
      obj.material.emissive = new THREE.Color(0x4da3ff);
      obj.material.emissiveIntensity = 1.5;
      obj.scale.setScalar(1.6);
    } else {
      obj.material.emissive = new THREE.Color(0x000000);
      obj.scale.setScalar(1);
    }
  }

  // ── hover + click-to-wire ─────────────────────────────────────
  let hoveredPinId = null;
  let hoveredWire = null;
  let moving = null;          // { id, moved } while dragging a placed part
  let suppressClick = false;  // set after a real drag so the click is ignored
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'assembly') return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);

    // dragging a placed part → reposition it live (wires follow via sync)
    if (moving) {
      const pos = dropPoint(e);
      if (pos) { moving.moved = true; api.move_component({ id: moving.id, pos }); }
      hud.hideTooltip();
      return;
    }

    const wireHit = raycaster.intersectObjects(wires.map(w => w.mesh), false)[0];
    hoveredWire = wireHit ? wireHit.object : null;

    const pin = pickPin();
    // pin → wire it; else a body is grab/removable; else orbit the camera
    const overBody = !pin && !!pickComponent();
    controls.enabled = !pin && !overBody;
    canvas.style.cursor = pin ? 'pointer' : overBody ? 'grab' : TW_OPEN;
    if (pin) {
      const id = pin.userData.endpointId;
      if (id !== hoveredPinId) { hoveredPinId = id; hud.showTooltip(e, pinTooltipHtml(id)); }
      else hud.moveTooltip(e);
    } else if (hoveredPinId) { hoveredPinId = null; hud.hideTooltip(); }
  });
  canvas.addEventListener('pointerleave', () => {
    hoveredPinId = null; hoveredWire = null; hud.hideTooltip();
    if (state.mode === 'assembly') controls.enabled = true;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'assembly') return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    if (e.button === 2) {                          // right-click removes things
      if (hoveredWire) {                           // …a wire
        const [a, b] = hoveredWire.userData.ids;
        api.disconnect({ from: a, to: b });
        audio.ui(); sync(); hud.refreshChecklist();
      } else {
        const id = pickComponent();                // …or a whole part
        if (id) {
          api.remove_component({ id });
          hud.flash(`Removed ${id}`, 'ok'); audio.ui();
          sync(); hud.refreshChecklist();
        }
      }
      e.preventDefault();
      return;
    }
    // left-press on a part body (not a pin) begins a move-drag
    if (e.button === 0 && !pickPin()) {
      const id = pickComponent();
      if (id) { moving = { id, moved: false }; controls.enabled = false; canvas.style.cursor = 'grabbing'; }
    }
  });
  window.addEventListener('pointerup', () => {
    if (!moving) return;
    suppressClick = moving.moved;   // a real drag shouldn't also fire click
    moving = null;
    canvas.style.cursor = TW_OPEN;
    if (state.mode === 'assembly') { sync(); hud.refreshChecklist(); }
  });
  canvas.addEventListener('click', (e) => {
    if (state.mode !== 'assembly') return;
    if (suppressClick) { suppressClick = false; return; }
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const pin = pickPin();
    if (!pin) {
      // clicking a switch body toggles it open/closed (re-solves the circuit)
      const swId = pickSwitch();
      if (swId) {
        const comp = api.get_document().components.find(c => c.id === swId);
        const now = comp?.params?.closed === true;
        api.set_param({ id: swId, key: 'closed', value: !now });
        hud.flash(`${swId} ${!now ? 'closed' : 'opened'}`, 'ok'); audio.ui();
        sync(); hud.refreshChecklist();
      }
      return;
    }
    const id = pin.userData.endpointId;
    if (!pending) {
      pending = id; highlightPin(id, true); audio.ui();
      hud.setStatus(`Selected ${id} — now click its target`);
      trackOnce('wire_attempt');
      return;
    }
    if (pending === id) { highlightPin(id, false); pending = null; return; }
    const from = pending; highlightPin(from, false); pending = null;
    const res = api.connect({ from, to: id });
    if (res.ok && res.changed) { hud.flash(`✓ ${from} → ${id}`, 'ok'); audio.connect(); }
    else if (!res.ok) { hud.flash(res.errors[0] || 'invalid connection', 'bad'); audio.error(); track('wire_wrong_pin'); }
    sync(); hud.refreshChecklist();
  });

  // ── clear board ───────────────────────────────────────────────
  const clearBtn = document.getElementById('clear-btn');
  function clearBoard() {
    if (state.mode !== 'assembly') return;
    for (const c of api.get_document().components) api.remove_component({ id: c.id });
    pending = null;
    sync();
    hud.setStatus('Drag a battery and a motor from the tray onto the workspace');
    hud.refreshChecklist();
  }
  clearBtn?.addEventListener('click', clearBoard);

  // the old auto-wire buttons don't apply to free-form building — hide them
  document.getElementById('auto-bar')?.classList.add('hidden');

  // ── live electronics → motion (build mode) ────────────────────
  // Everything here is driven by the real circuit solve, so wiring a loop has a
  // visible consequence *before* you hit RUN: powered wires carry moving charge
  // (speed ∝ current), a powered motor's wheel actually spins, and dead wires
  // stay dark. Together with the LED glow this is the "circuit does something".
  const _spinAxis = new THREE.Vector3(0, 1, 0);   // motor wheel's own axle (local y)
  let flowT = 0;
  const charges = new Map();   // wire mesh -> [spheres]

  // current magnitude carried by a wire ≈ the larger current of the two
  // components it bridges (a series wire carries that component's current).
  function wireCurrent(ids, cur) {
    let mag = 0;
    for (const ep of ids) {
      const compId = ep.split('.')[0];
      mag = Math.max(mag, Math.abs(cur[compId] || 0));
    }
    return mag;
  }

  function animate(dt) {
    let elec = null;
    try { elec = api.read_electrical(); } catch { /* ignore */ }
    const cur = elec?.current || {};
    const powered = elec?.ok !== false;
    const doc = api.get_document();

    // motors physically spin from their solved current — direction follows sign
    for (const c of doc.components) {
      if (baseType(c.type) !== 'motor') continue;
      const wheels = meshes.get(c.id)?.userData.wheelMeshes;
      if (!wheels) continue;
      const spin = (powered ? (cur[c.id] || 0) : 0) * dt * 1.4;
      if (spin) for (const w of wheels) w.rotateOnAxis(_spinAxis, spin);
    }

    const liveMeshes = new Set(wires.map(w => w.mesh));
    for (const [mesh, cs] of charges) {
      if (liveMeshes.has(mesh)) continue;
      for (const c of cs) { wireGroup.remove(c); c.geometry.dispose(); }
      charges.delete(mesh);
    }
    // flow rate scales with the strongest wire current in the circuit
    const iRef = Math.max(0, ...wires.map(w => wireCurrent(w.ids, cur)));
    flowT = (flowT + dt * (0.15 + Math.min(iRef, 4) * 0.5)) % 1;

    for (const w of wires) {
      let cs = charges.get(w.mesh);
      if (!cs) {
        cs = [];
        for (let i = 0; i < 3; i++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8),
            new THREE.MeshBasicMaterial({ color: w.mesh.material.color }));
          wireGroup.add(s); cs.push(s);
        }
        charges.set(w.mesh, cs);
      }
      const curve = w.mesh.geometry.parameters?.path;
      const flowing = powered && wireCurrent(w.ids, cur) > 1e-3;   // dead wires stay dark
      cs.forEach((s, i) => {
        s.visible = w.mesh.visible && !!curve && flowing;
        if (curve && flowing) s.position.copy(curve.getPointAt((flowT + i / cs.length) % 1));
      });
    }
  }

  sync();

  return {
    group,
    getPlacedCount: () => api.get_document().components.length,
    clearBoard,
    sync,
    refreshPositions: sync,
    animate,
    // adapter so hud's checklist/stepper can read wiring status off the doc
    wireStatus: () => api.get_document().nets.map((n) => ({
      label: n.endpoints.join(' — '), done: true, kind: netKind(n),
    })),
    allWired: () => api.get_document().nets.length > 0,
  };
}
