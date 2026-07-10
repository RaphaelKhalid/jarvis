// Assembly phase: parts tray, drag-to-slot placement, pin/wire raycasting,
// drag-to-wire, auto-wire, clear board. All handlers gated by state.mode.
import * as THREE from 'three';
import { PART_DEFS, SLOTS, makeMotor } from '../parts.js';
import { suggestFor, REQUIRED } from '../wiring.js';
import { pinInfo } from '../glossary.js';
import { connectionBlurb } from '../glossary.js';
import { audio } from '../audio.js';
import { state } from './state.js';
import { KIND_LABEL } from './hud.js';

// ── tweezers cursor (open normally, closes while right-dragging the view) ──
const tweezersSvg = (dx) => `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>` +
  `<path d='M16 6 L${10 + dx} 29 M16 6 L${22 - dx} 29' fill='none' stroke='#000' stroke-width='5' stroke-linecap='round' opacity='0.5'/>` +
  `<path d='M16 6 L${10 + dx} 29 M16 6 L${22 - dx} 29' fill='none' stroke='#eef3fb' stroke-width='2.3' stroke-linecap='round'/>` +
  `<circle cx='16' cy='5' r='2.5' fill='#eef3fb' stroke='#000' stroke-width='1'/></svg>`;
// hotspot on the circle at the top (16,5) — that's the point that clicks
export const TW_OPEN = `url("data:image/svg+xml,${encodeURIComponent(tweezersSvg(0))}") 16 5, crosshair`;
export const TW_CLOSED = `url("data:image/svg+xml,${encodeURIComponent(tweezersSvg(5))}") 16 5, grabbing`;

function pinTooltipHtml(id) {
  const info = pinInfo(id);
  if (!info) return `<b>${id}</b>`;
  const tag = KIND_LABEL[info.kind] || '';
  return `<span class="tt-tag tt-${info.kind}">${tag}</span><b>${info.title}</b>` +
         `<div class="tt-role">${info.role}</div>` +
         `<span class="unit">${id}</span>`;
}

export function initAssembly({ canvas, scene, camera, controls, slotMeshes, wiring, hud }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const assembly = new THREE.Group();
  scene.add(assembly);

  const placed = {};          // slotId -> { group, compType }
  const usedTypes = new Set();

  canvas.style.cursor = TW_OPEN;
  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode === 'assembly' && e.button === 2) canvas.style.cursor = TW_CLOSED;
  });
  window.addEventListener('pointerup', (e) => {
    if (state.mode === 'assembly' && e.button === 2) canvas.style.cursor = TW_OPEN;
  });

  // ── build parts tray ──────────────────────────────────────────
  const tray = document.getElementById('parts-tray');
  const cardByType = {};
  for (const def of PART_DEFS) {
    const card = document.createElement('div');
    card.className = 'part-card';
    card.dataset.type = def.type;
    card.innerHTML = `
      <div class="part-name"><span class="part-swatch" style="background:${def.swatch}"></span>${def.name}</div>
      <div class="part-desc">${def.desc}</div>
      ${def.count > 1 ? `<span class="count-badge" data-remaining>×${def.count}</span>` : ''}
      <span class="help-icon" title="">?</span>`;
    tray.appendChild(card);
    cardByType[def.type] = card;

    const help = card.querySelector('.help-icon');
    help.addEventListener('mouseenter', (e) => hud.showTooltip(e, def.help));
    help.addEventListener('mouseleave', hud.hideTooltip);
    help.addEventListener('mousemove', hud.moveTooltip);

    card.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('help-icon')) return;
      if (state.mode !== 'assembly') return;
      startDrag(def, e);
    });
  }

  // ── remaining counts ──────────────────────────────────────────
  const placedCount = {};
  function remainingFor(type) {
    const def = PART_DEFS.find(d => d.type === type);
    return def.count - (placedCount[type] || 0);
  }
  function updateCardState(type) {
    const card = cardByType[type];
    const rem = remainingFor(type);
    const badge = card.querySelector('[data-remaining]');
    if (badge) badge.textContent = `×${rem}`;
    if (rem <= 0) card.classList.add('depleted');
  }

  // ── drag-to-place ─────────────────────────────────────────────
  let drag = null;   // { def, ghost }
  function startDrag(def, e) {
    if (remainingFor(def.type) <= 0) return;
    const ghost = document.createElement('div');
    ghost.className = 'part-card';
    ghost.style.cssText =
      'position:fixed;z-index:200;pointer-events:none;opacity:0.85;width:200px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    ghost.innerHTML = `<div class="part-name"><span class="part-swatch" style="background:${def.swatch}"></span>${def.name}</div>`;
    document.body.appendChild(ghost);
    drag = { def, ghost };
    highlightSlots(def.type, true);
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
    const def = drag.def;
    drag.ghost.remove();
    highlightSlots(def.type, false);
    drag = null;

    const rect = canvas.getBoundingClientRect();
    const overCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (overCanvas) placePart(def);
  }

  // which slots accept this card type (motor -> both motor slots)
  function slotsForType(type) {
    if (type === 'motor') return SLOTS.filter(s => s.accepts === 'motorL' || s.accepts === 'motorR');
    return SLOTS.filter(s => s.accepts === type);
  }
  function highlightSlots(type, on) {
    for (const slot of slotsForType(type)) {
      if (placed[slot.id]) continue;
      slotMeshes[slot.id].material.opacity = on ? 0.28 : 0;
    }
  }

  function placePart(def) {
    const freeSlot = slotsForType(def.type).find(s => !placed[s.id]);
    if (!freeSlot) return;

    let group;
    const compType = freeSlot.accepts;   // e.g. motorL / motorR / arduino ...
    if (def.type === 'motor') {
      group = makeMotor(freeSlot.side);
    } else {
      group = def.make();
    }
    group.position.set(freeSlot.x, 0.3, freeSlot.z);
    group.rotation.y = freeSlot.ry;
    assembly.add(group);

    // drop-in animation — wires connected mid-fall track the pins each frame
    group.position.y = 6;
    const t0 = performance.now();
    (function fall() {
      const k = Math.min(1, (performance.now() - t0) / 350);
      group.position.y = 6 - (6 - 0.3) * (1 - (1 - k) * (1 - k));
      group.updateMatrixWorld(true);
      wiring.refreshPositions();
      if (k < 1) requestAnimationFrame(fall);
    })();

    audio.place();
    placed[freeSlot.id] = { group, compType };
    placedCount[def.type] = (placedCount[def.type] || 0) + 1;
    usedTypes.add(compType);
    updateCardState(def.type);

    wiring.registerComponent(group, compType);
    slotMeshes[freeSlot.id].material.opacity = 0;

    const n = Object.keys(placed).length;
    if (n >= 2) {
      wiring.enabled = true;
      hud.setStatus('Click a pin, then click its target pin to wire them');
    } else {
      hud.setStatus('Keep placing parts…');
    }
    hud.refreshChecklist();
  }

  // ── auto-assemble + auto-wire ─────────────────────────────────
  let autoBusy = false;

  function autoAssemble() {
    for (const def of PART_DEFS) {
      let guard = 0;
      while (remainingFor(def.type) > 0 && guard++ < 4) placePart(def);
    }
  }

  function wireAllInstant() {
    for (const r of REQUIRED) {
      const exists = wiring.wires.some(w => w.req && w.req.label === r.label);
      if (!exists) wiring.tryConnect(r.a, r.b);
    }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function autoWire(stepByStep) {
    if (autoBusy || state.mode !== 'assembly') return;
    autoBusy = true;
    autoInstant.disabled = autoStep.disabled = true;
    try {
      if (stepByStep) {
        // place parts one-by-one, then draw wires with a beat between each
        for (const def of PART_DEFS) {
          let guard = 0;
          while (remainingFor(def.type) > 0 && guard++ < 4) {
            placePart(def);
            await sleep(320);
          }
        }
        await sleep(300);
        for (const r of REQUIRED) {
          const exists = wiring.wires.some(w => w.req && w.req.label === r.label);
          if (!exists) { wiring.tryConnect(r.a, r.b); hud.flash(`✓ ${r.label}`, 'ok'); }
          await sleep(260);
        }
      } else {
        autoAssemble();
        wireAllInstant();
      }
    } finally {
      // always re-enable, even if placing/wiring threw (e.g. board cleared mid-run)
      autoBusy = false;
      autoInstant.disabled = autoStep.disabled = false;
      hud.refreshChecklist();
    }
  }

  const autoInstant = document.getElementById('auto-instant');
  const autoStep = document.getElementById('auto-step');
  autoInstant.addEventListener('click', () => autoWire(false));
  autoStep.addEventListener('click', () => autoWire(true));

  // ── raycasting: pins & wires ──────────────────────────────────
  function updatePointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  let hoveredWire = null;
  let hoveredPinId = null;
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'assembly') return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);

    // wire hover
    const wireHit = raycaster.intersectObjects(wiring.wireMeshes(), false)[0];
    if (hoveredWire && (!wireHit || wireHit.object !== hoveredWire)) {
      wiring.setWireHover(hoveredWire, false);
      hoveredWire = null;
      hud.hideTooltip();
    }
    if (wireHit && wireHit.object !== hoveredWire) {
      hoveredWire = wireHit.object;
      wiring.setWireHover(hoveredWire, true);
      const w = hoveredWire.userData.wire;
      if (w.valid) hud.showTooltip(e, `<span class="tt-tag tt-${w.kind}">✓ ${KIND_LABEL[w.kind] || ''}</span><b>${w.req.label}</b><div class="tt-role">${connectionBlurb(w.req)}</div>`);
      else {
        const want = suggestFor(w.idA) || suggestFor(w.idB);
        const wantTxt = want ? ` — should go to ${want.split('.')[1]}` : '';
        hud.showTooltip(e, `✗ wrong pin${wantTxt}`, true);
      }
    }
    if (hoveredWire) { hud.moveTooltip(e); hoveredPinId = null; return; }

    // pin hover: explain what the pin means (works as soon as parts are placed)
    const pinHit = pickPin();
    // disable orbit over a pin (or mid-drag) so a press starts a wire, not a rotate
    controls.enabled = !pinHit && !(wireDrag && wireDrag.moved);
    if (pinHit) {
      const id = pinHit.userData.endpointId;
      if (id !== hoveredPinId) { hoveredPinId = id; hud.showTooltip(e, pinTooltipHtml(id)); }
      else hud.moveTooltip(e);
    } else { hidePinTip(); }
  });

  function hidePinTip() {
    if (hoveredPinId) { hoveredPinId = null; hud.hideTooltip(); }
  }

  // leaving the canvas entirely: clear any hover state + tooltip so it can't stick
  canvas.addEventListener('pointerleave', () => {
    if (hoveredWire) { wiring.setWireHover(hoveredWire, false); hoveredWire = null; }
    hoveredPinId = null;
    hud.hideTooltip();
    if (state.mode === 'assembly' && !wireDrag) controls.enabled = true;
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'assembly' || !wiring.enabled) return;
    if (e.button === 2 && hoveredWire) {         // right-click deletes a wire
      wiring.removeWire(hoveredWire);
      hoveredWire = null;
      audio.ui();
      e.preventDefault();
      return;
    }
  });
  canvas.addEventListener('click', (e) => {
    if (state.mode !== 'assembly' || !wiring.enabled) return;
    if (suppressClick) { suppressClick = false; return; }   // handled by a drag-connect
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const pin = pickPin();
    if (!pin) return;
    const id = pin.userData.endpointId;
    const res = wiring.handlePinClick(id);
    if (res.state === 'armed') { hud.setStatus(`Selected ${id} — now click its target`); audio.ui(); }
    else connectFeedback(res);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // shared connect feedback (used by click-to-wire and drag-to-wire)
  function connectFeedback(res) {
    if (res.state === 'valid') { hud.flash(`✓ ${res.label}`, 'ok'); audio.connect(); }
    else if (res.state === 'invalid') {
      const want = res.suggestion ? ` — ${res.idA.split('.')[1]} should go to ${res.suggestion}` : '';
      hud.flash(`✗ wrong pin${want}`, 'bad'); audio.error();
    } else if (res.state === 'duplicate') { hud.flash('already wired', 'bad'); audio.error(); }
  }

  // ── drag-to-wire: press a pin, drag to its target, release ──
  let wireDrag = null;          // { fromId, sx, sy, moved, line }
  let suppressClick = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'assembly' || e.button !== 0 || !wiring.enabled) return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const pin = pickPin();
    if (!pin) return;
    wireDrag = { fromId: pin.userData.endpointId, sx: e.clientX, sy: e.clientY, moved: false, line: null };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!wireDrag) return;
    if (!wireDrag.moved && Math.hypot(e.clientX - wireDrag.sx, e.clientY - wireDrag.sy) > 5) wireDrag.moved = true;
    if (wireDrag.moved) updateWirePreview(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (!wireDrag) return;
    const wd = wireDrag; wireDrag = null;
    if (wd.line) { scene.remove(wd.line); wd.line.geometry.dispose(); }
    if (wd.moved) {
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const pin = pickPin();
      if (pin && pin.userData.endpointId !== wd.fromId) {
        wiring.highlightPin(wd.fromId, false);
        connectFeedback(wiring.tryConnect(wd.fromId, pin.userData.endpointId));
      }
      suppressClick = true;   // don't let the ensuing click arm a pin
    }
  });
  function updateWirePreview(e) {
    const from = wiring.worldPosOf(wireDrag.fromId);
    if (!from) return;
    updatePointer(e);
    raycaster.setFromCamera(pointer, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -from.y);
    const end = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, end)) raycaster.ray.at(30, end);
    if (!wireDrag.line) {
      const g = new THREE.BufferGeometry().setFromPoints([from, end]);
      wireDrag.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x56a8ff }));
      scene.add(wireDrag.line);
      wiring.highlightPin(wireDrag.fromId, true);
    } else {
      wireDrag.line.geometry.setFromPoints([from, end]);
    }
  }

  function pickPin() {
    const pinMeshes = [];
    for (const ep of wiring.endpoints.values()) pinMeshes.push(ep.obj);
    const hit = raycaster.intersectObjects(pinMeshes, false)[0];
    return hit ? hit.object : null;
  }

  // ── clear board ───────────────────────────────────────────────
  const clearBtn = document.getElementById('clear-btn');
  function clearBoard() {
    if (state.mode !== 'assembly') return;
    for (const id of Object.keys(placed)) {
      wiring.unregisterComponent(placed[id].compType);
      assembly.remove(placed[id].group);
      placed[id].group.traverse(o => { o.geometry?.dispose?.(); });
      delete placed[id];
    }
    for (const t of Object.keys(placedCount)) delete placedCount[t];
    usedTypes.clear();
    wiring.enabled = false;
    for (const def of PART_DEFS) {
      const card = cardByType[def.type];
      card.classList.remove('depleted');
      const badge = card.querySelector('[data-remaining]');
      if (badge) badge.textContent = `×${def.count}`;
    }
    // defensively un-stick the auto-wire buttons
    autoBusy = false;
    autoInstant.disabled = autoStep.disabled = false;
    hud.setStatus('Drag parts from the tray onto the chassis');
    hud.refreshChecklist();
  }
  clearBtn.addEventListener('click', clearBoard);

  // programmatic placement by tray type (used by save/load + curriculum setups)
  function placeByType(type) {
    const def = PART_DEFS.find(d => d.type === type);
    if (def && remainingFor(type) > 0) placePart(def);
  }

  return {
    group: assembly,
    placed,
    getPlacedCount: () => Object.keys(placed).length,
    clearBoard,
    placeByType,
  };
}
