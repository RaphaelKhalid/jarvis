// Mission mode — optional objectives layered on the driving sim. Each mission's
// update() is called every frame with (sim, dt, ctx) and returns
//   { progress: 0..1, status: 'idle'|'active'|'success'|'fail', label }
// ctx is a scratch object reset at the start of each attempt.

export function makeMissions() {
  return [
    {
      id: 'free', title: 'Free Drive', brief: 'Just drive around — no objective.',
      update() { return { progress: 0, status: 'idle', label: 'Explore freely' }; },
    },
    {
      id: 'upright', title: 'Stay Upright', brief: 'Keep the robot balanced for 25 seconds.',
      dur: 25,
      update(sim, dt, ctx) {
        ctx.t = (ctx.t || 0) + dt;
        const p = Math.min(1, ctx.t / this.dur);
        if (sim.fallen) return { progress: p, status: 'fail', label: `Fell after ${ctx.t.toFixed(1)} s` };
        if (ctx.t >= this.dur) return { progress: 1, status: 'success', label: 'Held for 25 s!' };
        return { progress: p, status: 'active', label: `${(this.dur - ctx.t).toFixed(1)} s to go` };
      },
    },
    {
      id: 'shove', title: 'Shake It Off', brief: 'The lab shoves your robot three times — keep it upright. (Tests how well your PID tune recovers from a knock.)',
      dur: 16, times: [3, 7, 11],
      update(sim, dt, ctx) {
        ctx.t = (ctx.t || 0) + dt; ctx.shoves = ctx.shoves || 0;
        if (ctx.shoves < this.times.length && ctx.t >= this.times[ctx.shoves]) {
          sim.nudge(); ctx.shoves++; if (ctx.onShove) ctx.onShove();
        }
        const p = ctx.shoves / this.times.length;
        if (sim.fallen) return { progress: p, status: 'fail', label: 'Knocked over!' };
        if (ctx.t >= this.dur) return { progress: 1, status: 'success', label: 'Survived every shove!' };
        return { progress: p, status: 'active', label: `${ctx.shoves}/3 shoves survived` };
      },
    },
    {
      id: 'distance', title: 'Distance Run', brief: 'Drive 120 units within 40 seconds without falling.',
      dur: 40, goal: 120,
      update(sim, dt, ctx) {
        ctx.t = (ctx.t || 0) + dt;
        ctx.dist = (ctx.dist || 0) + Math.abs(sim.speed || 0) * dt;
        const p = Math.min(1, ctx.dist / this.goal);
        if (sim.fallen) return { progress: p, status: 'fail', label: 'Crashed!' };
        if (ctx.dist >= this.goal) return { progress: 1, status: 'success', label: `Drove ${Math.round(ctx.dist)} units!` };
        if (ctx.t >= this.dur) return { progress: p, status: 'fail', label: `Only ${Math.round(ctx.dist)}/${this.goal} units` };
        return { progress: p, status: 'active', label: `${Math.round(ctx.dist)}/${this.goal} units` };
      },
    },
  ];
}
