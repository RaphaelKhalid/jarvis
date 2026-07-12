// Tiny observable store shared by all app modules. Plain pub/sub, no library.
// Read via `state.<key>`, write via `set(key, value)` so subscribers fire.
const subs = new Map();

export const state = {
  mode: 'assembly',      // 'assembly' | 'sim'
  booting: false,        // sim boot sequence lockout (drive keys ignored)
  gains: { Kp: 15, Ki: 140, Kd: 0.9 },
  activeRobotId: 'self-balancer',  // key into js/robots registry (M3 seam)
};

export function set(key, value) {
  state[key] = value;
  const fns = subs.get(key);
  if (fns) for (const fn of fns) fn(value);
}

export function subscribe(key, fn) {
  if (!subs.has(key)) subs.set(key, new Set());
  subs.get(key).add(fn);
  return () => subs.get(key).delete(fn);
}
