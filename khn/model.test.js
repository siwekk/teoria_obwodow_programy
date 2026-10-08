'use strict';
const assert = require('node:assert/strict');
const KHN = require('./model.js');
const defaults = { f0: 1000, Q: Math.SQRT1_2, gain: 1, R: 20000, C: 10e-9, port: 'DP', variant: 'inverting', normalized: false };
function close(actual, expected, tolerance = 1e-9) { assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`); }
for (const variant of ['inverting', 'noninverting']) for (const port of KHN.ports) {
  const m = KHN.design({ ...defaults, variant, port, Q: 3, gain: 1.2 });
  close(m.gains[port], 1.2);
  close(m.Rf, 1 / (2 * Math.PI * defaults.f0 * defaults.C));
  close(m.RG, m.R / (variant === 'inverting' ? m.gains.GP : m.gains.SP));
  close(m.RQ, m.R / (2 * m.Q + (variant === 'inverting' ? m.gains.SP : -m.gains.SP) - 1));
  // Recover Q and input gain from Kirchhoff's equations of the actual summer.
  const recoveredQ = variant === 'inverting' ? (1 + m.R / m.RQ) / (2 + m.R / m.RG) : (1 + m.R / m.RQ + m.R / m.RG) / 2;
  close(recoveredQ, m.Q);
  close(KHN.frequency(m, m.f0, 'SP').amplitude, m.gains.SP);
  close(KHN.frequency(m, 0, 'DP').amplitude, m.gains.DP);
  close(KHN.frequency(m, 1e10, 'GP').amplitude, m.gains.GP, 1e-6);
}
assert.equal(KHN.design({ ...defaults, variant: 'noninverting' }).hardwareOK, false);
assert.equal(KHN.design({ ...defaults, Q: .5, gain: 2, variant: 'noninverting' }).RQ, null);
assert.throws(() => KHN.design({ ...defaults, Q: 0 }));
assert.throws(() => KHN.design({ ...defaults, C: NaN }));
const normalized = KHN.design({ ...defaults, normalized: true });
close(KHN.frequency(normalized, defaults.f0, 'DP').phase, -90);
close(KHN.frequency(normalized, defaults.f0, 'SP').phase, 0);
close(KHN.frequency(normalized, defaults.f0, 'GP').phase, 90);
assert.ok(Number.isNaN(KHN.frequency(normalized, 0, 'SP').phase));
assert.equal(KHN.frequency(normalized, 0, 'GP').db, -Infinity);

// Compare analytic time responses with an independently integrated state-space system.
for (const Q of [.08, .3, .499999, .5, .500001, Math.SQRT1_2, 5, 50]) {
  const m = KHN.design({ ...defaults, Q, f0: 1.7, gain: 1.3 });
  const end = Math.min(m.timeEnd, 20 / m.w0), n = 20000, dt = end / n;
  let g = 0, v = 1, J = 0;
  const derivative = x => [x[1], -m.a * x[1] - m.w0 ** 2 * x[0], x[0]];
  for (let i = 0; i <= n; i++) {
    if (i % 500 === 0) {
      const exact = KHN.basis(m, i * dt);
      close(exact.g, g, 2e-8); close(exact.gp, v, 2e-8); close(exact.J, J, 2e-8);
      for (const p of KHN.ports) {
        const r = KHN.time(m, i * dt, p), k = m.signed[p];
        close(r.step, p === 'DP' ? k * m.w0 ** 2 * J : p === 'SP' ? k * m.a * g : k * v, 5e-7);
        close(r.impulse, p === 'DP' ? k * m.w0 ** 2 * g : p === 'SP' ? k * m.a * v : k * (-m.a * v - m.w0 ** 2 * g), 5e-7);
      }
    }
    if (i === n) break;
    const state = [g, v, J], add = (k, factor) => state.map((value, j) => value + dt * factor * k[j]);
    const k1 = derivative(state), k2 = derivative(add(k1, .5)), k3 = derivative(add(k2, .5)), k4 = derivative(add(k3, 1));
    [g, v, J] = state.map((value, j) => value + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  }
  for (const p of KHN.ports) {
    close(KHN.time(m, 0, p).step, p === 'GP' ? m.signed.GP : 0);
    close(KHN.time(m, 100 * m.timeEnd, p).step, p === 'DP' ? m.signed.DP : 0, 1e-7);
  }
}
for (const Q of [1e-6, .499999999999, .500000000001, 1000]) {
  const m = KHN.design({ ...defaults, Q });
  for (const t of [0, 1e-12, 1 / m.w0, m.timeEnd]) for (const p of KHN.ports) {
    const r = KHN.time(m, t, p); assert.ok(Number.isFinite(r.step) && Number.isFinite(r.impulse));
  }
}
console.log('KHN: component design, physical polarity, frequency limits, and analytic time responses passed.');
