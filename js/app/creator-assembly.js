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
};

// A motor mesh whose two terminals are named A / B (to match the library),
// reusing the self-balancer's nicely-detailed motor geometry.
function makeMotorAB() {
  const g = makeMotor(1);
  g.userData.type = 'motor';
  const names = ['A', 'B'];
  g.userData.pins.forEach((p, i) => { p.name = names[i] || p.name; });
  return g;
}
const FACTORY = { battery: makeBattery, motor: makeMotorAB };

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
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'assembly') return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);

    const wireHit = raycaster.intersectObjects(wires.map(w => w.mesh), false)[0];
    hoveredWire = wireHit ? wireHit.object : null;

    const pin = pickPin();
    controls.enabled = !pin;
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
    if (e.button === 2 && hoveredWire) {          // right-click deletes a wire
      const [a, b] = hoveredWire.userData.ids;
      api.disconnect({ from: a, to: b });
      audio.ui(); sync(); hud.refreshChecklist();
      e.preventDefault();
    }
  });
  canvas.addEventListener('click', (e) => {
    if (state.mode !== 'assembly') return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const pin = pickPin();
    if (!pin) return;
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

  // ── flow animation: charges travel along wired nets (visual) ──
  let flowT = 0;
  const charges = new Map();   // wire mesh -> [spheres]
  function animate(dt) {
    flowT = (flowT + dt * 0.5) % 1;
    const liveMeshes = new Set(wires.map(w => w.mesh));
    for (const [mesh, cs] of charges) {
      if (liveMeshes.has(mesh)) continue;
      for (const c of cs) { wireGroup.remove(c); c.geometry.dispose(); }
      charges.delete(mesh);
    }
    for (const w of wires) {
      let cs = charges.get(w.mesh);
      if (!cs) {
        cs = [];
        for (let i = 0; i < 3; i++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
            new THREE.MeshBasicMaterial({ color: w.mesh.material.color }));
          wireGroup.add(s); cs.push(s);
        }
        charges.set(w.mesh, cs);
      }
      const curve = w.mesh.geometry.parameters?.path;
      cs.forEach((s, i) => {
        s.visible = w.mesh.visible && !!curve;
        if (curve) s.position.copy(curve.getPointAt((flowT + i / cs.length) % 1));
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
