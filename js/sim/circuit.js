// DC circuit solver — Modified Nodal Analysis (MNA) over a RobotDoc's nets.
//
// Pure math, no THREE/DOM. Given the document plus per-component dynamic state
// (motor ω, so back-EMF is a known source at solve time), it returns:
//   { nodeV, current:{compId}, violations[], ok }
// where `current[compId]` is the current *through* that component (A → B / − → +
// convention documented per element), positive in the element's reference dir.
//
// Elements are built from a small per-type registry (COMPONENT_ELECTRICAL).
// Batteries and motors are the M1 primitives; anything else is treated as an
// ideal conductor between its power pins (or an open, if it has none).

// ── electrical descriptors ──────────────────────────────────────
// Each entry maps a component + dynamic state to primitive elements between its
// pins. Primitives:
//   { kind:'R', a, b, r }                       resistor r ohms
//   { kind:'V', a, b, v, series?, current:id }  ideal source V(a)-V(b)=v, opt. series R
// `a`/`b` are pin names on this component (resolved to nodes by the solver).
export const COMPONENT_ELECTRICAL = {
  battery(c) {
    const v = num(c.params?.voltsNominal, 7.4);
    const r = Math.max(num(c.params?.internalResistance, 0.4), 1e-4);
    // source from '-' to '+', with internal series resistance folded in.
    return {
      pins: ['+', '-'],
      elements: [{ kind: 'V', a: '+', b: '-', v, series: r, meter: '+' }],
      maxCurrent: num(c.params?.maxCurrent, 30),
    };
  },
  motor(c, state) {
    const Ra = Math.max(num(c.params?.resistance, 2.0), 1e-4);
    const Ke = num(c.params?.kv ? 1 / (c.params.kv * 2 * Math.PI / 60) : c.params?.ke, 0.05);
    const omega = state?.omega || 0;
    const backEmf = Ke * omega;
    // current reference direction: A → B. Back-EMF opposes it.
    return {
      pins: ['A', 'B'],
      elements: [{ kind: 'V', a: 'A', b: 'B', v: backEmf, series: Ra, meter: 'A' }],
      maxCurrent: num(c.params?.maxCurrent, 10),
      ke: Ke,
    };
  },
  // passive resistor: a single R between A and B (limits current in series).
  resistor(c) {
    const r = Math.max(num(c.params?.resistance, 100), 1e-4);
    return {
      pins: ['A', 'B'],
      elements: [{ kind: 'R', a: 'A', b: 'B', r }],
      maxCurrent: num(c.params?.maxCurrent, 5),
    };
  },
  // switch: a near-ideal wire when closed, an open (no element) when open.
  switch(c) {
    const closed = c.params?.closed === true || c.params?.closed === 1;
    return {
      pins: ['A', 'B'],
      elements: closed ? [{ kind: 'R', a: 'A', b: 'B', r: 1e-3 }] : [],
      maxCurrent: num(c.params?.maxCurrent, 30),
    };
  },
  // LED: a piecewise-linear diode. Conducts anode(A)→cathode(K) as a forward-
  // voltage drop (Vf) plus series Ron when forward-biased; open otherwise. The
  // solver resolves the on/off state by iteration (MNA itself stays linear).
  led(c) {
    const vf = Math.max(num(c.params?.forwardVoltage, 2.0), 0);
    const ron = Math.max(num(c.params?.resistance, 12), 1e-3);
    return {
      pins: ['A', 'K'],
      elements: [{ kind: 'D', a: 'A', b: 'K', vf, ron }],
      maxCurrent: num(c.params?.maxCurrent, 0.03),
    };
  },
};

function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

// ── dense linear solve (Gaussian elimination w/ partial pivot) ───
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue; // singular column; leave as-is
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map(row => row[n]);
}

// ── build node map from nets ─────────────────────────────────────
// Every endpoint that shares a net shares a node. Endpoints with no net get a
// private floating node. Returns node index per "compId.pin".
function buildNodes(doc) {
  const nodeOf = new Map();
  let next = 0;
  for (const net of doc.nets) {
    const idx = next++;
    for (const ep of net.endpoints) nodeOf.set(ep, idx);
  }
  // give unconnected pins their own isolated node
  for (const c of doc.components) {
    const spec = COMPONENT_ELECTRICAL[baseType(c.type)];
    if (!spec) continue;
    for (const pin of spec(c, {}).pins) {
      const ep = `${c.id}.${pin}`;
      if (!nodeOf.has(ep)) nodeOf.set(ep, next++);
    }
  }
  return { nodeOf, count: next };
}

function baseType(type) {
  if (!type) return type;
  if (type.startsWith('motor')) return 'motor';
  return type;
}

// ── main solve ───────────────────────────────────────────────────
// stateOf: optional map compId -> { omega } for dynamic sources.
export function solveCircuit(doc, stateOf = {}) {
  const violations = [];
  const current = {};
  const { nodeOf, count: nNodes } = buildNodes(doc);

  // Gather elements with resolved node indices.
  const resistors = [];   // {a,b,g,comp}
  const vsources = [];     // {a,b,v,series,comp,meter}
  const diodes = [];       // {a,b,vf,ron,comp} — nonlinear, PWL-iterated
  const specs = {};        // compId -> resolved spec (for meters / limits)

  for (const c of doc.components) {
    const build = COMPONENT_ELECTRICAL[baseType(c.type)];
    if (!build) continue;
    const spec = build(c, stateOf[c.id] || {});
    specs[c.id] = spec;
    const node = (pin) => nodeOf.get(`${c.id}.${pin}`);
    // floating-pin warning: a declared pin not on any shared net
    for (const pin of spec.pins) {
      const ep = `${c.id}.${pin}`;
      const onNet = doc.nets.some(n => n.endpoints.includes(ep));
      if (!onNet) violations.push({ level: 'warn', code: 'floating-pin', ref: ep,
        message: `${c.id}.${pin} is not connected` });
    }
    for (const el of spec.elements) {
      if (el.kind === 'R') {
        resistors.push({ a: node(el.a), b: node(el.b), g: 1 / Math.max(el.r, 1e-9), comp: c.id });
      } else if (el.kind === 'V') {
        vsources.push({ a: node(el.a), b: node(el.b), v: el.v, series: el.series || 0, comp: c.id, meter: el.meter });
      } else if (el.kind === 'D') {
        diodes.push({ a: node(el.a), b: node(el.b), vf: el.vf, ron: Math.max(el.ron, 1e-3), comp: c.id });
      }
    }
  }

  // Direct short detection: a source whose two terminals are the same node.
  for (const s of vsources) {
    if (s.a === s.b) {
      violations.push({ level: 'error', code: 'short', ref: s.comp,
        message: `${s.comp} is shorted (both terminals on the same net)` });
    }
  }

  // MNA assembly (linear) for a fixed diode on/off assignment. Ground = node 0.
  // Unknowns: node voltages 1..n-1, then one branch current per voltage source.
  // A source's series resistance is modeled by an internal node so the source
  // itself stays ideal. A conducting diode is just a Vf source + series Ron.
  function assemble(diodeOn) {
    let n = nNodes;
    const res = resistors.slice();
    const branches = [];                  // ideal V-sources: {p, m, v, comp, meter}
    const addSource = (s) => {
      if (s.series > 0) {
        const mid = n++;                                 // internal node
        res.push({ a: mid, b: s.b, g: 1 / s.series, comp: s.comp });
        branches.push({ p: s.a, m: mid, v: s.v, comp: s.comp, meter: s.meter });
      } else {
        branches.push({ p: s.a, m: s.b, v: s.v, comp: s.comp, meter: s.meter });
      }
    };
    for (const s of vsources) addSource(s);
    // conducting diodes append after the vsource branches, in diode order
    diodes.forEach((d, i) => {
      if (diodeOn[i]) addSource({ a: d.a, b: d.b, v: d.vf, series: d.ron, comp: d.comp, meter: d.a });
    });

    const nV = Math.max(n - 1, 0);        // node-voltage unknowns (excl. ground)
    const size = nV + branches.length;
    const nodeV = new Array(n).fill(0);
    const cur = {};
    const diodeI = new Array(diodes.length).fill(0);
    if (size === 0) return { nodeV, cur, diodeI };

    const A = Array.from({ length: size }, () => new Array(size).fill(0));
    const rhs = new Array(size).fill(0);
    const vi = (node) => node - 1;        // matrix index for a node (ground = -1 → skip)

    for (const r of res) {
      const { a, b, g } = r;
      if (a > 0) A[vi(a)][vi(a)] += g;
      if (b > 0) A[vi(b)][vi(b)] += g;
      if (a > 0 && b > 0) { A[vi(a)][vi(b)] -= g; A[vi(b)][vi(a)] -= g; }
    }
    branches.forEach((br, k) => {
      const row = nV + k;
      if (br.p > 0) { A[vi(br.p)][row] += 1; A[row][vi(br.p)] += 1; }
      if (br.m > 0) { A[vi(br.m)][row] -= 1; A[row][vi(br.m)] -= 1; }
      rhs[row] = br.v;
    });

    const x = solveLinear(A, rhs);
    for (let node = 1; node < n; node++) nodeV[node] = x[vi(node)] || 0;
    branches.forEach((br, k) => { cur[br.comp] = (cur[br.comp] || 0) + (x[nV + k] || 0); });
    // diode branch currents live right after the vsource branches
    let k = vsources.length;
    diodes.forEach((d, i) => { if (diodeOn[i]) diodeI[i] = x[nV + k++] || 0; });
    return { nodeV, cur, diodeI };
  }

  // PWL diode iteration: start all-on, flip any diode whose state is
  // inconsistent (on but reverse current, or off but forward-biased past Vf),
  // re-solve until stable. Converges in a couple of passes for simple circuits.
  const diodeOn = diodes.map(() => true);
  let result = assemble(diodeOn);
  for (let iter = 0; iter < 2 * diodes.length + 2 && diodes.length; iter++) {
    let changed = false;
    diodes.forEach((d, i) => {
      if (diodeOn[i]) {
        if (result.diodeI[i] < -1e-9) { diodeOn[i] = false; changed = true; }
      } else {
        const vd = (result.nodeV[d.a] || 0) - (result.nodeV[d.b] || 0);
        if (vd > d.vf + 1e-9) { diodeOn[i] = true; changed = true; }
      }
    });
    if (!changed) break;
    result = assemble(diodeOn);
  }
  const nodeV = result.nodeV;
  Object.assign(current, result.cur);

  // Passive elements (resistor, closed switch) aren't branch unknowns — meter
  // their current straight from the solved node voltages: i = (V_a − V_b)/R,
  // A → B reference. Components already metered as V-sources are left alone.
  for (const c of doc.components) {
    if (current[c.id] !== undefined) continue;
    const rel = specs[c.id]?.elements.find(e => e.kind === 'R');
    if (!rel) { current[c.id] = 0; continue; }
    const na = nodeOf.get(`${c.id}.${rel.a}`) ?? 0;
    const nb = nodeOf.get(`${c.id}.${rel.b}`) ?? 0;
    current[c.id] = (nodeV[na] - nodeV[nb]) / Math.max(rel.r, 1e-9);
  }

  // Over-current / short-by-magnitude checks.
  for (const c of doc.components) {
    const spec = specs[c.id];
    if (!spec) continue;
    const i = Math.abs(current[c.id] || 0);
    if (spec.maxCurrent && i > spec.maxCurrent) {
      const already = violations.some(v => v.code === 'short' && v.ref === c.id);
      if (i > spec.maxCurrent * 3 && !already) {
        violations.push({ level: 'error', code: 'short', ref: c.id,
          message: `${c.id} draws ${i.toFixed(1)}A — shorted` });
      } else if (!already) {
        violations.push({ level: 'warn', code: 'over-current', ref: c.id,
          message: `${c.id} over current (${i.toFixed(1)}A > ${spec.maxCurrent}A)` });
      }
    }
  }

  const ok = !violations.some(v => v.level === 'error');
  return { nodeV, current, violations, ok, specs };
}

// Convenience: torque a motor produces given the solved current and its Kt(=Ke).
// τ = Kt·i − friction·sign(ω). Returns 0 when the solve flagged a short.
export function motorTorque(compId, solve, params = {}, omega = 0) {
  if (!solve.ok) return 0;
  const spec = solve.specs?.[compId];
  const Kt = spec?.ke ?? 0.05;
  const i = solve.current[compId] || 0;
  const friction = num(params.friction, 0.002);
  return Kt * i - friction * Math.sign(omega);
}
