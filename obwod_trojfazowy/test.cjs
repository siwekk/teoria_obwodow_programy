// Run with node test.cjs; add --latex to compile the generated reports with pdflatex.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script); // Check all event handlers as well as the calculation code.
const elements = new Map();
const getElement = selector => {
  if (!elements.has(selector)) elements.set(selector, { value: '', innerHTML: '', getContext: () => ({}) });
  return elements.get(selector);
};
const sandbox = {
  document: { querySelector: getElement }, localStorage: { getItem: () => null }
};
vm.createContext(sandbox);
// Read the same functions as the standalone page, before binding browser events.
const boundary = script.indexOf("      $$('.element').forEach");
assert.ok(boundary > 0);
vm.runInContext(script.slice(0, boundary) + `
  globalThis.app = {
    calculate, phasorLayout, defaults, fromPolar,
    report(values) { solution = calculate(values); updateEquations(); return latexDocument(); },
    sourceInput(rms, degrees) {
      activeKey = 'EA'; realInput.value = rms; imagInput.value = degrees;
      return readEditorValue();
    }
  };
})();`, sandbox);
const app = sandbox.app;
const fresh = () => JSON.parse(JSON.stringify(app.defaults.values));
const z = (re = 0, im = 0) => ({ re, im });
const near = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};
const nearComplex = (actual, expected, tolerance) => {
  near(actual.re, expected.re, tolerance); near(actual.im, expected.im, tolerance);
};
const phases = ['A', 'B', 'C'];
const reports = new Map();
let cases = 0;
function verify(name, values) {
  const result = app.calculate(values);
  const currentSum = phases.reduce((sum, p) => z(sum.re + result[`I${p}`].re, sum.im + result[`I${p}`].im), z());
  nearComplex(currentSum, result.IN);
  nearComplex(result.Sload, result.Ssource);
  for (const [width, height] of [[320, 360], [390, 390], [1200, 510]]) {
    const plot = app.phasorLayout(result, width, height);
    for (const phase of plot.phases) {
      // Endpoint potentials are independent of the neutral shift.
      near(phase.uTip.x, plot.origin.x + result[`E${phase.phase}`].re * plot.voltageScale);
      near(phase.uTip.y, plot.origin.y - result[`E${phase.phase}`].im * plot.voltageScale);
      near(phase.uTip.x - plot.n.x, phase.U.re * plot.voltageScale);
      near(phase.uTip.y - plot.n.y, -phase.U.im * plot.voltageScale);
    }
    for (const point of [plot.origin, plot.n, plot.inTip, ...plot.phases.flatMap(p => [p.uTip, p.iTip])]) {
      assert.ok(point.x >= plot.bounds.left && point.x <= plot.bounds.right);
      assert.ok(point.y >= plot.bounds.top && point.y <= plot.bounds.bottom);
    }
  }
  const tex = app.report(values);
  assert.doesNotMatch(tex, /NaN|Infinity|undefined|null/);
  assert.match(tex, /\\end\{document\}/);
  assert.equal((tex.match(/\\begin\{align\*\}/g) || []).length, (tex.match(/\\end\{align\*\}/g) || []).length);
  reports.set(name, tex);
  cases++;
  return result;
}

const standard = verify('standard', fresh());
nearComplex(standard.Un, z(7.088590412669341, 2.8913559549200443), 1e-7);
nearComplex(standard.Sload, z(9959.696037663394, 3956.857121566076), 1e-7);

const balanced = fresh();
phases.forEach(p => { balanced[`Z${p}`] = z(10); });
nearComplex(verify('balanced', balanced).Un, z());

const ideal = fresh();
ideal.ZN = z();
const idealResult = verify('ideal-neutral', ideal);
nearComplex(idealResult.Un, z());
nearComplex(idealResult.UA, ideal.EA);
nearComplex(idealResult.IA, z(2760 / 169, -1150 / 169));
assert.doesNotMatch(reports.get('ideal-neutral'), /\\frac\{U_N\}\{Z_N\}/);
assert.doesNotMatch(getElement('#equations').innerHTML, /U<sub>N<\/sub>\/Z<sub>N<\/sub>/);

for (const p of phases) {
  const analytical = fresh();
  phases.forEach(q => { analytical[`E${q}`] = z(q === p ? 100 : -50); analytical[`Z${q}`] = z(q === p ? 0 : 10); });
  analytical.ZN = z(5);
  const result = verify(`short-${p}`, analytical);
  nearComplex(result.Un, z(100));
  nearComplex(result[`U${p}`], z());
  nearComplex(result[`I${p}`], z(50));
  nearComplex(result[`S${p}`], z());
  nearComplex(result.IN, z(20));
  nearComplex(result.Sload, z(6500));
  assert.equal(result[`phi${p}`], null);
  const tex = reports.get(`short-${p}`);
  assert.ok(!tex.includes(`\\frac{U_${p}}{Z_${p}}`));
  assert.ok(!tex.includes(`Z_${p}^{-1}`));
  assert.ok(tex.includes(`I_${p} &= I_N-`));
  assert.ok(tex.includes('nieokreślony'));
  const complexShort = fresh(); complexShort[`Z${p}`] = z();
  verify(`complex-short-${p}`, complexShort);
  const forbidden = fresh(); forbidden.ZN = z(); forbidden[`Z${p}`] = z();
  assert.throws(() => app.calculate(forbidden), /zwarcie w fazie jest niedozwolone/);
}
const doubleShort = fresh(); doubleShort.ZA = doubleShort.ZB = z();
assert.throws(() => app.calculate(doubleShort), /tylko jednej fazy/);
const allOff = fresh(); phases.forEach(p => { allOff[`E${p}`] = z(); });
const offResult = verify('zero-sources', allOff);
phases.forEach(p => { assert.equal(offResult[`phi${p}`], null); });
const smallNeutral = fresh(); smallNeutral.ZN = z(1e-12);
nearComplex(verify('small-neutral', smallNeutral).Un, z(), 1e-8);
const fromPolar = app.sourceInput('250', '-90');
nearComplex(fromPolar, z(0, -250));
assert.throws(() => app.sourceInput('-1', '0'), /ujemna/);
assert.throws(() => app.sourceInput('', '0'), /Wpisz/);

console.log(`PASS: ${cases} circuit cases, KCL, power balance, phasor endpoints, short-circuit validation, polar input and LaTeX output.`);
if (process.argv.includes('--latex')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'three-phase-latex-'));
  for (const name of ['standard', 'ideal-neutral', 'complex-short-A', 'complex-short-B', 'complex-short-C']) {
    fs.writeFileSync(path.join(directory, `${name}.tex`), reports.get(name));
    const result = spawnSync('pdflatex', ['-interaction=batchmode', '-halt-on-error', `${name}.tex`], { cwd: directory, encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(result.error || result.stdout, result.stderr);
      throw new Error(`LaTeX compilation failed: ${directory}/${name}.log`);
    }
    const log = fs.readFileSync(path.join(directory, `${name}.log`), 'utf8');
    assert.doesNotMatch(log, /Overfull \\hbox/, `${name}: equation too wide`);
  }
  console.log(`PASS: five LaTeX reports compiled without overflowing equations. Artifacts: ${directory}`);
}
