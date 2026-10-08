'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const KHN = require('./model.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
const elements = {};
function element(id, initialValue = '') {
  let storedValue = String(initialValue);
  return elements[id] = { id, get value() { return storedValue; }, set value(val) { storedValue = String(val); }, checked: false, disabled: false, innerHTML: '', textContent: '', style: {}, events: {},
    addEventListener(type, callback) { this.events[type] = callback; },
    getBoundingClientRect() { return { width: 510, height: 230, left: 0 }; }, getContext() { return context; },
    matches(selector) { return selector === 'input' && this.isInput; },
    fire(type) { this.events[type]?.({ target: this, preventDefault() {} }); }
  };
}
for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  const el = element(match[3], match[2].match(/\bvalue="([^"]*)"/)?.[1] || '');
  el.isInput = match[1] === 'input'; el.checked = /\bchecked\b/.test(match[2]);
}
for (const [id, value] of Object.entries({ port: 'DP', preset: String(Math.SQRT1_2), variant: 'inverting', convention: 'physical', scale: 'log' })) elements[id].value = value;
const checks = KHN.ports.map(port => ({ ...element('check' + port), dataset: { port }, checked: true }));
const downloads = [];
const sandbox = { KHN, Blob, devicePixelRatio: 1, setTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  ResizeObserver: class { observe() {} },
  URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
  document: { getElementById: id => elements[id], querySelectorAll: selector => selector.includes(':checked') ? checks.filter(el => el.checked) : checks, createElement: () => ({ click() {} }) }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
function change(id, val) {
  if (typeof val === 'boolean') elements[id].checked = val; else elements[id].value = String(val);
  elements.controls.events.change({ target: elements[id] });
}
async function main() {
  assert.equal(elements.notice.textContent, '');
  assert.equal(elements.fmin.disabled, true); assert.equal(elements.tmax.disabled, true);
  assert.match(elements.hardwareStatus.textContent, /dodatnie/);
  assert.match(elements.transfers.innerHTML, /k_\{DP\}=-1/);
  for (const key of ['amplitude', 'db', 'phase', 'step', 'impulse']) assert.ok(elements[key].width > 0);
  for (const Q of [.3, .5, .7071067811865476, 5]) {
    change('Q', Q);
    assert.equal(elements.notice.textContent, '');
    elements.exportTex.fire('click');
    const tex = await downloads.at(-1).text();
    assert.match(tex, /\\begin\{document\}/); assert.match(tex, /\\mathcal\{L\}\^\{-1\}/);
    assert.match(tex, /\\delta\(t\)/); assert.ok(!/[=({]undefined|NaN/.test(tex));
    if (Q === .7071067811865476 && process.env.KHN_TEST_TEX_PATH) fs.writeFileSync(process.env.KHN_TEST_TEX_PATH, tex);
    if (Q === .5) assert.match(tex, /p_1=p_2/);
    if (Q === .3) assert.match(tex, /e\^\{p_1 t\}/);
  }
  change('variant', 'noninverting'); change('Q', .7071067811865476);
  assert.match(elements.hardwareStatus.textContent, /brak realizacji/);
  assert.match(elements.hardwareNote.textContent, /R_Q/);
  change('Q', 3); assert.match(elements.hardwareStatus.textContent, /dodatnie/);
  change('convention', 'normalized'); assert.match(elements.transfers.innerHTML, /k_\{SP\}=3/);
  change('scale', 'linear'); assert.equal(Number(elements.fmin.value), 0);
  change('autoF', false); change('fmin', 0); change('scale', 'log');
  assert.match(elements.notice.textContent, /logarytmicznej/); assert.equal(elements.exportTex.disabled, true);
  change('fmin', 1); assert.equal(elements.notice.textContent, '');
  change('gain', ''); assert.match(elements.notice.textContent, /Uzupełnij/);
  change('gain', 1); change('autoT', false); change('tmax', 0);
  assert.match(elements.notice.textContent, /czas końcowy/);
  change('autoT', true); change('autoF', true);
  for (const el of checks) el.checked = false;
  checks[0].fire('change'); assert.match(elements.amplitudeReadout.textContent, /Wybierz/);
  for (const el of checks) el.checked = true;
  checks[0].fire('change');
  elements.exportCsv.fire('click');
  const csv = await downloads.at(-1).text(); assert.match(csv, /frequency_Hz/); assert.match(csv, /time_s/); assert.match(csv, /Dirac_coefficient/);
  assert.ok(csv.split('\r\n').every(row => row.split(',').length === 9));
  console.log('KHN: application execution, presets, validation, visibility, MathML formulas, and LaTeX/CSV exports passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
