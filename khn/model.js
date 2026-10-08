(function (root) {
  'use strict';
  const ports = ['DP', 'SP', 'GP'];
  function design(p) {
    for (const key of ['f0', 'Q', 'gain', 'R', 'C']) {
      if (!Number.isFinite(p[key]) || p[key] <= 0) throw new Error('Parametry f₀, Q, A, R i C muszą być dodatnimi, skończonymi liczbami.');
    }
    if (!ports.includes(p.port) || !['inverting', 'noninverting'].includes(p.variant)) throw new Error('Nieznany wariant układu lub tor wzmocnienia.');
    const A = p.port === 'SP' ? p.gain / p.Q : p.gain;
    const gains = { DP: A, SP: A * p.Q, GP: A };
    const w0 = 2 * Math.PI * p.f0, a = w0 / p.Q, alpha = a / 2;
    const rqDenominator = 2 * p.Q + (p.variant === 'inverting' ? gains.SP : -gains.SP) - 1;
    const Rf = 1 / (w0 * p.C), RG = p.R / (p.variant === 'inverting' ? A : gains.SP);
    const signs = p.normalized ? { DP: 1, SP: 1, GP: 1 } : p.variant === 'inverting' ? { DP: -1, SP: 1, GP: -1 } : { DP: 1, SP: -1, GP: 1 };
    const signed = Object.fromEntries(ports.map(port => [port, signs[port] * gains[port]]));
    const poleGap = Math.sqrt(Math.abs(alpha * alpha - w0 * w0));
    // Rationalized slow pole avoids subtracting nearly equal numbers at small Q.
    const slow = p.Q < .5 ? -w0 * w0 / (alpha + poleGap) : -alpha;
    const fast = p.Q < .5 ? -alpha - poleGap : -alpha;
    const timeEnd = 14 / -slow;
    if (![A, gains.SP, w0 * w0, a, A * w0 * w0, gains.SP * a, Rf, RG, poleGap, slow, fast, timeEnd].every(Number.isFinite) || w0 * w0 <= 0 || Rf <= 0 || RG <= 0 || slow >= 0) throw new Error('Parametry przekraczają zakres obliczeń. Zmień skalę częstotliwości, dobroci lub elementów.');
    const RQ = rqDenominator > 0 ? p.R / rqDenominator : null;
    const hardwareOK = RQ !== null && Number.isFinite(RQ) && RQ > 0;
    return { ...p, gains, signed, signs, w0, a, alpha, poleGap, slow, fast, Rf, RG, RQ: hardwareOK ? RQ : null, rqDenominator, hardwareOK, timeEnd };
  }
  function coefficients(m, port) {
    const k = m.signed[port];
    return { b: port === 'DP' ? [k * m.w0 ** 2, 0, 0] : port === 'SP' ? [0, k * m.a, 0] : [0, 0, k], a: [m.w0 ** 2, m.a, 1] };
  }
  function frequency(m, f, port) {
    const x = f / m.f0, dr = 1 - x * x, di = x / m.Q, k = m.signed[port];
    const nr = port === 'DP' ? k : port === 'GP' ? -k * x * x : 0;
    const ni = port === 'SP' ? k * x / m.Q : 0;
    const amplitude = Math.hypot(nr, ni) / Math.hypot(dr, di);
    // Use a continuous phase branch, including the actual output polarity.
    let phase = (-Math.atan2(di, dr) + (port === 'SP' ? Math.PI / 2 : port === 'GP' ? Math.PI : 0) + (k < 0 ? -Math.PI : 0)) * 180 / Math.PI;
    if (amplitude === 0) phase = NaN;
    return { amplitude, db: amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity, phase };
  }
  // g = L^-1{1/D(s)}, gp = dg/dt, J = integral from 0 to t of g.
  // Exact real formulas cover oscillatory, critical, and aperiodic responses.
  function basis(m, t) {
    if (t < 0) return { g: 0, gp: 0, J: 0 };
    const { alpha, w0, Q, poleGap: b, slow: p1, fast: p2 } = m;
    if (Q === .5) {
      const z = w0 * t, e = Math.exp(-z);
      const J = z < .001 ? (z * z / 2 - z ** 3 / 3 + z ** 4 / 8 - z ** 5 / 30 + z ** 6 / 144) / (w0 * w0) : (-Math.expm1(-z) - z * e) / (w0 * w0);
      return { g: t * e, gp: (1 - z) * e, J };
    }
    // Taylor expansion avoids cancellation near t = 0 in the integral.
    if (t * Math.max(alpha, w0) < .001) {
      const a = 2 * alpha, c = w0 * w0;
      const g = t - a * t ** 2 / 2 + (a * a - c) * t ** 3 / 6 + (-(a ** 3) + 2 * a * c) * t ** 4 / 24;
      const gp = 1 - a * t + (a * a - c) * t ** 2 / 2 + (-(a ** 3) + 2 * a * c) * t ** 3 / 6;
      const J = t ** 2 / 2 - a * t ** 3 / 6 + (a * a - c) * t ** 4 / 24 + (-(a ** 3) + 2 * a * c) * t ** 5 / 120;
      return { g, gp, J };
    }
    if (Q > .5) {
      const e = Math.exp(-alpha * t), z = b * t;
      const sinc = Math.abs(z) < 1e-5 ? 1 - z * z / 6 : Math.sin(z) / z;
      const g = e * t * sinc, gp = e * Math.cos(z) - alpha * g;
      return { g, gp, J: (1 - gp - 2 * alpha * g) / (w0 * w0) };
    }
    const e1 = Math.exp(p1 * t), gap = p1 - p2;
    const g = e1 * -Math.expm1(-gap * t) / gap;
    const gp = e1 - (alpha + b) * g;
    const J = (Math.expm1(p1 * t) / p1 - Math.expm1(p2 * t) / p2) / gap;
    return { g, gp, J };
  }
  function time(m, t, port) {
    if (t < 0) return { impulse: 0, step: 0, direct: 0 };
    const { g, gp, J } = basis(m, t), k = m.signed[port];
    if (port === 'DP') return { impulse: k * m.w0 ** 2 * g, step: k * m.w0 ** 2 * J, direct: 0 };
    if (port === 'SP') return { impulse: k * m.a * gp, step: k * m.a * g, direct: 0 };
    return { impulse: k * (-m.a * gp - m.w0 ** 2 * g), step: k * gp, direct: k };
  }
  const api = { ports, design, coefficients, frequency, basis, time };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KHN = api;
})(typeof window !== 'undefined' ? window : globalThis);
