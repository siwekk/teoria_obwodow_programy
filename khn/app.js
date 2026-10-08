(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ports = KHN.ports, colors = { DP: '#1876a9', SP: '#15806b', GP: '#bd5c24' };
  const names = { DP: 'Dolnoprzepustowy', SP: 'Środkowoprzepustowy', GP: 'Górnoprzepustowy' };
  const S = String.raw;
  let model, frequencyData = [], timeData = [], report = [], currentRange;
  const fmt = value => !Number.isFinite(value) ? (value === -Infinity ? '−∞' : 'brak') : value === 0 ? '0' : Math.abs(value) >= 1e5 || Math.abs(value) < .001 ? value.toExponential(3) : Number(value.toPrecision(5)).toLocaleString('pl-PL', { useGrouping: false, maximumSignificantDigits: 5 });
  const num = value => {
    if (value === 0) return '0';
    const s = Number(value.toPrecision(6)).toString();
    return s.includes('e') ? s.replace(/e([+-]?\d+)/, (_, exponent) => S`\cdot 10^{${Number(exponent)}}`) : s;
  };
  const resistance = r => r === null ? 'brak realizacji' : r >= 1e6 ? `${fmt(r / 1e6)} MΩ` : r >= 1e3 ? `${fmt(r / 1e3)} kΩ` : `${fmt(r)} Ω`;
  const xml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Render the small LaTeX subset used in this report as native MathML.
  // No remote scripts or fonts are needed, and export retains the original LaTeX.
  function math(tex) {
    let i = 0;
    const symbols = { omega: 'ω', alpha: 'α', beta: 'β', delta: 'δ', pi: 'π', zeta: 'ζ', cdot: '·', infty: '∞', ge: '≥', le: '≤', ne: '≠', pm: '±', theta: 'θ', phi: 'φ', tau: 'τ' };
    function group() {
      while (tex[i] === ' ') i++;
      if (tex[i] === '{') { i++; const value = row('}'); i++; return value; }
      return atom();
    }
    function atom() {
      if (tex[i] === '{') return group();
      if (tex[i] === '\\') {
        i++; const match = tex.slice(i).match(/^[a-zA-Z]+/);
        const command = match ? match[0] : tex[i++] || ''; if (match) i += command.length;
        if (command === 'frac') return `<mfrac>${group()}${group()}</mfrac>`;
        if (command === 'sqrt') return `<msqrt>${group()}</msqrt>`;
        if (command === 'mathcal') return `<mstyle mathvariant="script">${group()}</mstyle>`;
        if (command === 'int') return '<mo>∫</mo>';
        if (['{', '}'].includes(command)) return `<mo>${command}</mo>`;
        if (['mathrm', 'text', 'operatorname'].includes(command)) {
          while (tex[i] === ' ') i++;
          if (tex[i] === '{') { const begin = ++i; while (i < tex.length && tex[i] !== '}') i++; const text = tex.slice(begin, i++); return `<mtext>${xml(text)}</mtext>`; }
        }
        if (['left', 'right'].includes(command)) return atom();
        if (['quad', 'qquad', ','].includes(command)) return '<mspace width="0.6em"/>';
        if (symbols[command]) return `<mi>${symbols[command]}</mi>`;
        return `<mi mathvariant="normal">${xml(command)}</mi>`;
      }
      const number = tex.slice(i).match(/^\d+(?:\.\d+)?/);
      if (number) { i += number[0].length; return `<mn>${number[0]}</mn>`; }
      const ch = tex[i++] || '';
      return /[a-zA-Z]/.test(ch) ? `<mi>${ch}</mi>` : `<mo>${xml(ch === '-' ? '−' : ch)}</mo>`;
    }
    function row(end) {
      let value = '';
      while (i < tex.length && tex[i] !== end) {
        if (tex[i] === ' ') { i++; continue; }
        let base = atom(), sub, sup;
        while (tex[i] === '_' || tex[i] === '^') { const op = tex[i++], script = group(); if (op === '_') sub = script; else sup = script; }
        if (sub && sup) base = `<msubsup>${base}${sub}${sup}</msubsup>`;
        else if (sub) base = `<msub>${base}${sub}</msub>`;
        else if (sup) base = `<msup>${base}${sup}</msup>`;
        value += base;
      }
      return `<mrow>${value}</mrow>`;
    }
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" aria-label="${xml(tex)}">${row()}</math>`;
  }
  function equation(tex) { report.push(tex); return `<div class="formula">${math(tex)}</div>`; }
  function value(id) {
    const input = $(id), n = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(n)) throw new Error('Uzupełnij wszystkie aktywne pola poprawnymi liczbami.');
    return n;
  }
  function visible() { return [...document.querySelectorAll('[data-port]:checked')].map(el => el.dataset.port); }
  function enabled() {
    $('fmin').disabled = $('fmax').disabled = $('autoF').checked;
    $('tmax').disabled = $('autoT').checked;
  }
  function update() {
    enabled();
    try {
      const m = KHN.design({ f0: value('f0'), Q: value('Q'), gain: value('gain'), R: value('R') * 1000, C: value('C') * 1e-9, port: $('port').value, variant: $('variant').value, normalized: $('convention').value === 'normalized' });
      if (m.Q < 1e-6 || m.Q > 1000) throw new Error('Podaj dobroć Q od 0,000001 do 1000, aby zachować dokładność obliczeń i czytelność wykresów.');
      const log = $('scale').value === 'log';
      const fmin = $('autoF').checked ? log ? m.f0 / 100 : 0 : value('fmin');
      const fmax = $('autoF').checked ? log ? m.f0 * 100 : m.f0 * 4 : value('fmax');
      const tmax = $('autoT').checked ? m.timeEnd : value('tmax') / 1000;
      if (fmin < 0 || fmax <= fmin || (log && fmin <= 0) || tmax <= 0) throw new Error('Zakres musi rosnąć, czas końcowy musi być dodatni, a początek osi logarytmicznej musi być większy od zera.');
      if (![fmin, fmax, tmax, (fmax / m.f0) ** 2, m.gains.DP * (fmax / m.f0) ** 2, m.gains.SP * (fmax / m.f0) / m.Q, 1 / (fmin || m.f0)].every(Number.isFinite)) throw new Error('Zakres przekracza dokładność obliczeń. Zmień skalę wykresów.');
      if ($('autoF').checked) { $('fmin').value = Number(fmin.toPrecision(8)); $('fmax').value = Number(fmax.toPrecision(8)); }
      if ($('autoT').checked) $('tmax').value = Number((tmax * 1000).toPrecision(8));
      model = m; currentRange = { fmin, fmax, tmax, log };
      const fs = Array.from({ length: 1001 }, (_, i) => log ? Math.exp(Math.log(fmin) + (Math.log(fmax) - Math.log(fmin)) * i / 1000) : fmin + (fmax - fmin) * i / 1000);
      // Add points around narrow resonances, including the exact center frequency.
      for (let i = -100; i <= 100; i++) { const f = m.f0 * (1 + i / (20 * Math.max(1, m.Q))); if (f >= fmin && f <= fmax) fs.push(f); }
      frequencyData = [...new Set(fs)].sort((a, b) => a - b).map(f => ({ x: f, ...Object.fromEntries(ports.map(p => [p, KHN.frequency(m, f, p)])) }));
      const cycles = m.Q > .5 ? tmax * m.poleGap / (2 * Math.PI) : 0;
      const needed = Math.max(1000, Math.ceil(cycles * 50));
      const count = Math.min(16000, needed);
      const ts = Array.from({ length: count + 1 }, (_, i) => tmax * i / count);
      if (m.Q < .5) { const fastEnd = Math.min(tmax, 14 / -m.fast); for (let i = 0; i <= 700; i++) ts.push(fastEnd * i / 700); }
      timeData = [...new Set(ts)].sort((a, b) => a - b).map(t => ({ x: t, ...Object.fromEntries(ports.map(p => [p, KHN.time(m, t, p)])) }));
      $('notice').textContent = needed > 16000 ? 'Wybrany czas obejmuje wiele oscylacji. Skróć zakres czasu, aby dokładniej zobaczyć każdy okres.' : '';
      $('exportTex').disabled = $('exportCsv').disabled = false;
      $('results').style.opacity = '1';
      renderResults(); renderFormulas(); renderSchematic(); drawAll();
    } catch (error) {
      $('notice').textContent = error.message;
      $('exportTex').disabled = $('exportCsv').disabled = true;
      $('results').style.opacity = '.45';
    }
  }
  function renderResults() {
    const m = model;
    $('gainResult').textContent = fmt(m.gains.DP); $('bandResult').textContent = fmt(m.gains.SP);
    $('bandwidth').textContent = `${fmt(m.f0 / m.Q)} Hz`; $('damping').textContent = fmt(1 / (2 * m.Q));
    $('conventionNote').textContent = m.normalized ? 'Konwencja znormalizowana: wszystkie współczynniki liczników są dodatnie. Jest zgodna z wykresami źródłowego symulatora. Nie uwzględnia odwróceń fazy na wyjściach schematu.' : m.variant === 'inverting' ? 'Polaryzacja schematu: DP i GP odwracają znak, SP zachowuje znak. Dwa integratory odwracają fazę kolejno o 180°. Faza jest przedstawiona w sposób ciągły.' : 'Polaryzacja schematu: DP i GP zachowują znak, SP odwraca znak. Dwa integratory odwracają fazę kolejno o 180°. Faza jest przedstawiona w sposób ciągły.';
    $('hardwareStatus').textContent = m.hardwareOK ? 'dodatnie wartości elementów' : 'brak realizacji dla zadanych parametrów';
    $('hardwareStatus').className = m.hardwareOK ? 'status-ok' : 'status-bad';
    const boundary = m.variant === 'inverting' ? (1 - m.gains.SP) / 2 : (m.gains.SP + 1) / 2;
    $('hardwareNote').textContent = m.hardwareOK ? 'R₁ = R₂ = R₄ = R oraz C₁ = C₂ = C. Wartości poniżej dotyczą wybranego wariantu wejścia.' : `Dla tego wariantu wymagane jest Q > ${fmt(boundary)}, czyli ${m.variant === 'inverting' ? '2Q + A_SP − 1' : '2Q − A_SP − 1'} > 0. R_Q nie ma dodatniej, skończonej wartości. Wykresy opisują zadany filtr idealny, ale wskazany schemat nie realizuje tych parametrów.`;
    const rows = [
      ['R₁, R₂, R₄', resistance(m.R), 'R'], ['C₁, C₂', `${fmt(m.C * 1e9)} nF`, 'C'],
      ['R_f1, R_f2', resistance(m.Rf), S`R_f = \frac{1}{2\pi f_0 C}`],
      [m.variant === 'inverting' ? 'R_G1' : 'R_G2', resistance(m.RG), m.variant === 'inverting' ? S`R_{G1}=\frac{R}{A_{GP}}` : S`R_{G2}=\frac{R}{A_{SP}}`],
      ['R_Q', resistance(m.RQ), m.variant === 'inverting' ? S`R_Q=\frac{R}{2Q+A_{SP}-1}` : S`R_Q=\frac{R}{2Q-A_{SP}-1}`]
    ];
    $('elements').innerHTML = rows.map(([label, val, formula]) => `<tr><td>${label}</td><td>${val}</td><td>${math(formula)}</td></tr>`).join('');
    const x = 1 / (2 * m.Q), fL = m.f0 / (Math.sqrt(1 + x * x) + x), fH = m.f0 * (Math.sqrt(1 + x * x) + x);
    $('bandwidth').title = `Punkty −3 dB względem maksimum SP: f_L = ${fmt(fL)} Hz, f_H = ${fmt(fH)} Hz`;
  }
  function renderFormulas() {
    report = [];
    const m = model, w = num(m.w0), a = num(m.a), c = num(m.w0 ** 2);
    const type = m.Q > .5 ? 'odpowiedź oscylacyjna, Q > 0,5' : m.Q === .5 ? 'tłumienie krytyczne, Q = 0,5' : 'odpowiedź aperiodyczna, Q < 0,5';
    $('responseType').textContent = type;
    $('commonFormula').innerHTML = equation(S`\omega_0=2\pi f_0=${w}\quad a=\frac{\omega_0}{Q}=${a}`) + equation(S`D(s)=s^2+a s+\omega_0^2=s^2+${a}s+${c}`);
    $('transfers').innerHTML = ports.map(p => {
      const k = num(m.signed[p]);
      const numerator = p === 'DP' ? S`k_{DP}\omega_0^2` : p === 'SP' ? S`k_{SP}a s` : S`k_{GP}s^2`;
      const numeric = p === 'DP' ? num(m.signed[p] * m.w0 ** 2) : p === 'SP' ? `${num(m.signed[p] * m.a)}s` : `${k}s^2`;
      return `<div class="equation"><h3 class="${p.toLowerCase()}">${names[p]}</h3>${equation(S`k_{${p}}=${k}`)}${equation(S`T_{${p}}(s)=\frac{${numerator}}{D(s)}`)}${equation(S`T_{${p}}(s)=\frac{${numeric}}{s^2+${a}s+${c}}`)}</div>`;
    }).join('');
    let basis = equation(S`g(t)=\mathcal{L}^{-1}\left\{\frac{1}{D(s)}\right\}\quad v(t)=g'(t)\quad J(t)=\int_0^t g(\tau)\,d\tau`);
    if (m.Q > .5) {
      basis += equation(S`\alpha=\frac{a}{2}=${num(m.alpha)}\quad \beta=\sqrt{\omega_0^2-\alpha^2}=${num(m.poleGap)}`);
      basis += equation(S`g(t)=e^{-\alpha t}\frac{\sin(\beta t)}{\beta}`);
      basis += equation(S`v(t)=e^{-\alpha t}\left(\cos(\beta t)-\frac{\alpha}{\beta}\sin(\beta t)\right)`);
      basis += equation(S`J(t)=\frac{1-e^{-\alpha t}\left(\cos(\beta t)+\frac{\alpha}{\beta}\sin(\beta t)\right)}{\omega_0^2}`);
      basis += equation(S`p_{1,2}=-${num(m.alpha)}\pm j\,${num(m.poleGap)}`);
    } else if (m.Q === .5) {
      basis += equation(S`g(t)=t e^{-\omega_0 t}\quad v(t)=(1-\omega_0 t)e^{-\omega_0 t}`);
      basis += equation(S`J(t)=\frac{1-(1+\omega_0 t)e^{-\omega_0 t}}{\omega_0^2}\quad p_1=p_2=-${w}`);
    } else {
      basis += equation(S`p_1=${num(m.slow)}\quad p_2=${num(m.fast)}`);
      basis += equation(S`g(t)=\frac{e^{p_1 t}-e^{p_2 t}}{p_1-p_2}\quad v(t)=\frac{p_1 e^{p_1 t}-p_2 e^{p_2 t}}{p_1-p_2}`);
      basis += equation(S`J(t)=\frac{\frac{e^{p_1 t}-1}{p_1}-\frac{e^{p_2 t}-1}{p_2}}{p_1-p_2}`);
    }
    const timeEq = {
      DP: [S`h_{DP}(t)=k_{DP}\omega_0^2 g(t)=${num(m.signed.DP * m.w0 ** 2)}g(t)`, S`y_{DP}(t)=k_{DP}\omega_0^2 J(t)=${num(m.signed.DP * m.w0 ** 2)}J(t)`],
      SP: [S`h_{SP}(t)=k_{SP}a v(t)=${num(m.signed.SP * m.a)}v(t)`, S`y_{SP}(t)=k_{SP}a g(t)=${num(m.signed.SP * m.a)}g(t)`],
      GP: [S`h_{GP}(t)=k_{GP}\delta(t)-k_{GP}a v(t)-k_{GP}\omega_0^2 g(t)`, S`h_{GP}(t)=${num(m.signed.GP)}\delta(t)+(${num(-m.signed.GP * m.a)})v(t)+(${num(-m.signed.GP * m.w0 ** 2)})g(t)`, S`y_{GP}(t)=k_{GP}v(t)=${num(m.signed.GP)}v(t)`]
    };
    $('timeFormulas').innerHTML = basis + '<div class="equation-grid">' + ports.map(p => `<div class="equation"><h3 class="${p.toLowerCase()}">${p}</h3>${timeEq[p].map(equation).join('')}</div>`).join('') + '</div>';
    $('frequencyFormulas').innerHTML = equation(S`\omega=2\pi f\quad M(\omega)=\sqrt{(\omega_0^2-\omega^2)^2+(a\omega)^2}`) + equation(S`|T_{DP}|=\frac{A_{DP}\omega_0^2}{M(\omega)}\quad |T_{SP}|=\frac{A_{SP}a\omega}{M(\omega)}\quad |T_{GP}|=\frac{A_{GP}\omega^2}{M(\omega)}`) + equation(S`\theta=\operatorname{atan2}(a\omega,\omega_0^2-\omega^2)\quad \phi_{DP}=-\theta+\phi_{k_{DP}}`) + equation(S`\phi_{SP}=\frac{\pi}{2}-\theta+\phi_{k_{SP}}\quad \phi_{GP}=\pi-\theta+\phi_{k_{GP}}`) + equation(S`\phi_k=0\quad(k>0)\qquad \phi_k=-\pi\quad(k<0)`) + equation(S`L(f)=20\log_{10}|T(j\omega)|\quad B_{SP}=\frac{f_0}{Q}=${num(m.f0 / m.Q)}`) + '<p class="note">Przy zerowej amplitudzie faza jest nieokreślona. Wzory fazowe podano w radianach, wykres używa stopni. W punktach zerowej amplitudy wartość w dB wynosi −∞ i nie jest rysowana.</p>';
  }
  function renderSchematic() {
    const m = model, non = m.variant === 'noninverting';
    const wire = points => `<polyline class="wire" points="${points}"/>`;
    const resistor = (x, y, name, value, vertical = false) => vertical ? `<rect class="device" x="${x-7}" y="${y-23}" width="14" height="46"/><text x="${x+13}" y="${y-4}">${name}</text><text class="value" x="${x+13}" y="${y+13}">${value}</text>` : `<rect class="device" x="${x-23}" y="${y-7}" width="46" height="14"/><text x="${x}" y="${y-16}" text-anchor="middle">${name}</text><text class="value" x="${x}" y="${y+25}" text-anchor="middle">${value}</text>`;
    const cap = (x, y, name) => `<rect fill="white" x="${x-9}" y="${y-14}" width="18" height="28"/><path class="wire" d="M${x-5},${y-14}v28 M${x+5},${y-14}v28"/><text x="${x}" y="${y-22}" text-anchor="middle">${name} = ${fmt(m.C * 1e9)} nF</text>`;
    const opamp = (x, y, name) => `<polygon class="device" points="${x},${y-36} ${x},${y+36} ${x+72},${y}"/><text x="${x+8}" y="${y-12}">−</text><text x="${x+8}" y="${y+26}">+</text><text x="${x+28}" y="${y+4}">${name}</text>`;
    const ground = (x, y) => `<path class="wire" d="M${x},${y-12}v12 m-12,0h24 m-19,5h14 m-10,5h6"/>`;
    let body = wire('60,185 280,185') + wire('220,185 220,120 395,120 395,205') + wire('220,120 220,55 820,55 820,245') + wire('280,225 250,225 250,375') + wire('250,315 610,315 610,225') + wire('352,205 500,205') + wire('395,205 395,265') + wire('470,205 470,145 610,145 610,225') + wire('500,245 475,245 475,280') + wire('572,225 710,225') + wire('610,315 610,365') + wire('680,225 680,165 820,165 820,245') + wire('710,265 685,265 685,300') + wire('782,245 820,245 820,305');
    if (non) body = body.replace(wire('60,185 280,185'), wire('220,185 280,185') + wire('60,315 250,315'));
    body += resistor(310,120,'R₂',resistance(m.R)) + resistor(535,55,'R₁',resistance(m.R)) + resistor(415,315,'R₄',resistance(m.R)) + resistor(250,350,'R_Q',resistance(m.RQ),true) + resistor(135, non ? 315 : 185,non ? 'R_G2' : 'R_G1',resistance(m.RG)) + resistor(440,205,'R_f1',resistance(m.Rf)) + resistor(650,225,'R_f2',resistance(m.Rf)) + cap(540,145,'C₁') + cap(750,165,'C₂') + opamp(280,205,'U1') + opamp(500,225,'U2') + opamp(710,245,'U3') + ground(250,387) + ground(475,292) + ground(685,312);
    for (const [x,y] of [[220,120],[220,185],[395,205],[610,225],[610,315],[820,245],[250,315]]) body += `<circle cx="${x}" cy="${y}" r="3" fill="#40596b"/>`;
    for (const [x,y,label,p] of [[395,265,'GP','GP'],[610,365,'SP','SP'],[820,305,'DP','DP']]) body += `<circle class="device" cx="${x}" cy="${y}" r="4"/><text x="${x}" y="${y+22}" text-anchor="middle" style="fill:${colors[p]}">V_${label}</text>`;
    body += `<circle class="device" cx="60" cy="${non ? 315 : 185}" r="4"/><text x="60" y="${non ? 294 : 164}" text-anchor="middle">V_we</text>`;
    $('schematic').innerHTML = `<svg class="schematic" viewBox="25 15 850 400" role="img" aria-label="Schemat KHN z trzema wzmacniaczami operacyjnymi, rezystorami i dwoma kondensatorami"><title>KHN, wejście ${non ? 'nieodwracające' : 'odwracające'}</title>${body}</svg>`;
  }

  function ticks(min, max) {
    const raw = (max - min) / 5, power = 10 ** Math.floor(Math.log10(raw)), f = raw / power;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * power, result = [];
    for (let k = Math.ceil(min / step); k * step <= max + step * .001 && result.length < 15; k++) result.push(k * step);
    return result;
  }
  const chartDefs = [ ['amplitude', false], ['db', false], ['phase', false], ['step', true], ['impulse', true] ];
  function drawAll() { if (model) chartDefs.forEach(([key, timed]) => drawChart(key, timed)); }
  function drawChart(key, timed) {
    const canvas = $(key), readout = $(key + 'Readout'), rect = canvas.getBoundingClientRect();
    const width = Math.max(250, rect.width), height = rect.height || 230, ratio = devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
    const data = timed ? timeData : frequencyData, selected = visible(), log = !timed && currentRange.log;
    if (!selected.length) { readout.textContent = 'Wybierz co najmniej jeden tor do wyświetlenia.'; canvas.onpointermove = canvas.onpointerleave = null; return; }
    let min = Infinity, max = -Infinity;
    for (const row of data) for (const p of selected) if (Number.isFinite(row[p][key])) { min = Math.min(min, row[p][key]); max = Math.max(max, row[p][key]); }
    if (!Number.isFinite(min)) { readout.textContent = 'Brak skończonych wartości w zadanym zakresie.'; return; }
    if (key === 'amplitude') min = 0;
    const pad = Math.max((max - min) * .09, Math.abs(max) * .005, 1e-10);
    max += pad; if (key !== 'amplitude') min -= pad;
    const left = 64, right = 17, top = 14, bottom = 37, pw = width - left - right, ph = height - top - bottom;
    const xmin = data[0].x, xmax = data.at(-1).x;
    const tx = v => log ? Math.log10(v) : v, lo = tx(xmin), hi = tx(xmax);
    const x = v => left + (tx(v) - lo) / (hi - lo) * pw, y = v => top + (max - v) / (max - min) * ph;
    ctx.font = '11px Segoe UI, Arial'; ctx.fillStyle = '#627b8d'; ctx.strokeStyle = '#dce5ec'; ctx.lineWidth = 1;
    for (const v of ticks(min,max)) { ctx.beginPath(); ctx.moveTo(left,y(v)); ctx.lineTo(left+pw,y(v)); ctx.stroke(); ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.fillText(fmt(v),left-7,y(v)); }
    let xticks = log ? Array.from({ length: Math.floor(hi)-Math.ceil(lo)+1 }, (_,i) => 10 ** (Math.ceil(lo)+i)) : ticks(xmin,xmax);
    if (xticks.length < 2) xticks = [xmin,xmax];
    if (xticks.length > 7) xticks = xticks.filter((_, i) => i % Math.ceil(xticks.length/7) === 0);
    for (const v of xticks) { ctx.beginPath(); ctx.moveTo(x(v),top); ctx.lineTo(x(v),top+ph); ctx.stroke(); ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(fmt(timed ? v * 1000 : v),x(v),top+ph+8); }
    ctx.textAlign='right'; ctx.fillText(timed ? 't [ms]' : 'f [Hz]',width-right,height-11);
    if (!timed && model.f0 >= xmin && model.f0 <= xmax) { ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle='#92a8b8'; ctx.beginPath(); ctx.moveTo(x(model.f0),top); ctx.lineTo(x(model.f0),top+ph); ctx.stroke(); ctx.restore(); ctx.textAlign='left'; ctx.fillText('f₀',x(model.f0)+4,top); }
    ctx.save(); ctx.beginPath(); ctx.rect(left,top,pw,ph); ctx.clip();
    for (const p of selected) { ctx.strokeStyle=colors[p]; ctx.lineWidth=2; ctx.beginPath(); let started=false; for (const row of data) { const v=row[p][key]; if (!Number.isFinite(v)) { started=false; continue; } if (!started) {ctx.moveTo(x(row.x),y(v)); started=true;} else ctx.lineTo(x(row.x),y(v)); } ctx.stroke(); }
    ctx.restore(); ctx.strokeStyle='#8da4b5'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(left,top); ctx.lineTo(left,top+ph); ctx.lineTo(left+pw,top+ph); ctx.stroke();
    const unit = key === 'db' ? ' dB' : key === 'phase' ? '°' : key === 'impulse' ? ' s⁻¹' : '';
    const defaultText = key === 'impulse' && selected.includes('GP') ? `GP: dodatkowo ${fmt(model.signed.GP)}·δ(t). Na wykresie część zwykła.` : timed ? `Zakres: 0 do ${fmt(xmax * 1000)} ms.` : `Zakres: ${fmt(xmin)} do ${fmt(xmax)} Hz${log ? ', oś logarytmiczna' : ', oś liniowa'}.`;
    readout.textContent=defaultText;
    canvas.onpointermove = event => {
      const pos=Math.max(0,Math.min(1,(event.clientX-canvas.getBoundingClientRect().left-left)/pw));
      const target=log ? 10 ** (lo+pos*(hi-lo)) : lo+pos*(hi-lo);
      let l=0,r=data.length-1; while (l<r) {const mid=(l+r)>>1; if(data[mid].x<target) l=mid+1; else r=mid;}
      if(l>0 && Math.abs(tx(data[l-1].x)-tx(target))<Math.abs(tx(data[l].x)-tx(target))) l--;
      const row=data[l]; readout.textContent=`${timed ? 't' : 'f'} = ${fmt(timed ? row.x*1000 : row.x)} ${timed ? 'ms' : 'Hz'}; `+selected.map(p=>`${p}: ${Number.isNaN(row[p][key]) ? 'nieokreślona' : fmt(row[p][key])+unit}`).join(', ');
    };
    canvas.onpointerleave=()=>readout.textContent=defaultText;
  }
  function download(text, type, name) {
    const url=URL.createObjectURL(new Blob([text],{type})), a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function exportTex() {
    const m=model;
    const hardware = m.hardwareOK ? S`R_Q=${num(m.RQ)}\,\Omega` : S`\text{No positive finite }R_Q\text{ exists for these parameters.}`;
    const doc = S`\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb}
\usepackage[margin=22mm]{geometry}
\usepackage{hyperref}
\setlength{\parindent}{0pt}
\begin{document}
\section*{Second-order KHN active filter}
Ideal operational amplifiers and zero initial conditions are assumed.
Input variant: ${m.variant === 'inverting' ? 'inverting' : 'noninverting'}.
Transfer convention: ${m.normalized ? 'normalized positive numerators' : 'physical output polarity'}.
\[
f_0=${num(m.f0)}\,\mathrm{Hz},\quad Q=${num(m.Q)},\quad A_{DP}=A_{GP}=${num(m.gains.DP)},\quad A_{SP}=${num(m.gains.SP)}.
\]
\section*{Implementation}
\[
R_1=R_2=R_4=${num(m.R)}\,\Omega,\quad C_1=C_2=${num(m.C)}\,\mathrm{F}.
\]
\[
R_{f1}=R_{f2}=\frac{1}{2\pi f_0 C}=${num(m.Rf)}\,\Omega.
\]
\[
R_G=${m.variant === 'inverting' ? S`\frac{R}{A_{GP}}` : S`\frac{R}{A_{SP}}`}=${num(m.RG)}\,\Omega.
\]
\[
R_Q=\frac{R}{${m.variant === 'inverting' ? '2Q+A_{SP}-1' : '2Q-A_{SP}-1'}},\quad ${m.variant === 'inverting' ? '2Q+A_{SP}-1' : '2Q-A_{SP}-1'}>0.
\]
\[${hardware}\]
\section*{Transfer functions and responses}
${report.map(tex=>'\\['+tex+'\\]').join('\n')}
Time responses hold for $t\ge 0$. The high-pass impulse response includes
$k_{GP}\delta(t)$; only its ordinary part is drawn. Phase is undefined at
zero magnitude. Phase formulas use radians, plots use degrees.
\section*{References}
Implementation equations: \url{https://termotesty.pl/KHN/khn_1.html}.
Reference simulator: \url{https://termotesty.pl/KHN/khn_ah.html}.
\end{document}
`;
    download(doc,'application/x-tex;charset=utf-8','khn_obliczenia.tex');
  }
  function exportCsv() {
    const cell = n => Number.isNaN(n) ? '' : n === -Infinity ? '-Infinity' : n.toPrecision(12);
    const lines=['domain,argument,port,amplitude_V_per_V,magnitude_dB,phase_deg,step,impulse_regular_per_s,impulse_Dirac_coefficient'];
    for(const row of frequencyData) for(const p of ports) lines.push(['frequency_Hz',cell(row.x),p,cell(row[p].amplitude),cell(row[p].db),cell(row[p].phase),'','',''].join(','));
    for(const row of timeData) for(const p of ports) lines.push(['time_s',cell(row.x),p,'','','',cell(row[p].step),cell(row[p].impulse),cell(row[p].direct)].join(','));
    download(lines.join('\r\n'),'text/csv;charset=utf-8','khn_wykresy.csv');
  }
  $('controls').addEventListener('submit',event=>{event.preventDefault();update();});
  $('controls').addEventListener('input',event=>{ if(event.target.id==='Q') $('preset').value='custom'; if(event.target.matches('input')) update(); });
  $('controls').addEventListener('change',event=>{ if(event.target.id==='preset' && event.target.value!=='custom') $('Q').value=event.target.value; update(); });
  $('reset').addEventListener('click',()=>{$('controls').reset(); document.querySelectorAll('[data-port]').forEach(el=>el.checked=true); update();});
  document.querySelectorAll('[data-port]').forEach(el=>el.addEventListener('change',drawAll));
  $('exportTex').addEventListener('click',exportTex); $('exportCsv').addEventListener('click',exportCsv);
  let resizeFrame; new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(drawAll);}).observe($('results'));
  update();
})();
