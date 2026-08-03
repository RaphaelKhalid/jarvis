// Tiny observable store shared by all app modules. Plain pub/sub, no library.
// Read via `state.<key>`, write via `set(key, value)` so subscribers fire.
const subs = new Map();

// `mode` is the only cross-module state left: the pre-pivot store also carried
// PID `gains` (no PID any more), a `booting` lockout for the balance-sim boot
// sequence, and `activeRobotId` for the RobotDef registry — the document is the
// unit of work now, and the API owns it.
export const state = {
  mode: 'assembly',      // 'assembly' | 'sim'
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
