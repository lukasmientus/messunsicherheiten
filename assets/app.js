(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const NS = 'http://www.w3.org/2000/svg';

  const state = {
    method: 'max',
    extremeMode: 'auto',
    series: [],
    excluded: new Set(),
    seriesImport: null,
    linearImport: null,
    linear: [],
    currentSeriesResult: null,
    currentLineResult: null,
    randomMode: 'series'
  };

  const help = {
    max: ['Maximalabstand', 'Der größte Abstand eines Messwerts vom Mittelwert wird als Unsicherheit verwendet. Das Verfahren ist leicht zugänglich, reagiert aber stark auf einzelne Ausreißer.'],
    extreme: ['Extremwerte ausschließen', 'Der Mittelwert wird aus allen Werten berechnet. Für die Unsicherheit werden der kleinste und der größte Wert oder selbst markierte Werte nicht berücksichtigt; anschließend gilt wieder der Maximalabstand.'],
    middle: ['Mittlerer Anteil', 'Extremwertpaare werden schrittweise entfernt, solange mindestens der gewählte Anteil der Messwerte übrig bleibt. Die Unsicherheit ist der größte Abstand der verbleibenden Werte vom Mittelwert aller Messungen.'],
    mad: ['Mittlere absolute Abweichung', 'Für jeden Messwert wird der absolute Abstand vom Mittelwert bestimmt. Der Mittelwert dieser Abstände ist die mittlere absolute Abweichung (MAD).'],
    sd: ['Standardabweichung', 'Die quadrierten Abstände vom Mittelwert werden gemittelt und daraus die Wurzel gezogen. Hier wird – wie im zugrunde liegenden Kapitel – durch N und nicht durch N−1 geteilt.'],
    known: ['Bekannte Unsicherheit', 'Eine bereits bekannte Unsicherheit, zum Beispiel eine Ableseunsicherheit, wird direkt verwendet. Sie gilt als gleicher Betrag nach oben und unten.'],
    theory: ['Theorie- und Grenzgeraden', 'Die Theoriegerade folgt y = a·x + b. Die Grenzgeraden besitzen die kleinste bzw. größte Steigung, mit der noch alle Unsicherheitsrechtecke geschnitten werden können. Die Winkelhalbierende liegt zwischen ihren Richtungswinkeln.']
  };

  const seriesExamples = [
    { id: 'pendulum', title: 'Pendelmessung aus dem Kapitel', text: 'Acht Messungen der Periodendauer; Vergleich mit den veröffentlichten Beispielwerten.' },
    { id: 'outlier', title: 'Messreihe mit Ausreißer', text: 'Macht die unterschiedliche Empfindlichkeit der Verfahren sichtbar.' },
    { id: 'length', title: 'Längenmessung', text: 'Zehn eng streuende Messwerte in Zentimetern.' },
    { id: 'random', title: 'Freie Zufallsdaten', text: 'Anzahl, Mittelwert und Streuung selbst festlegen.' }
  ];
  const linearExamples = [
    { id: 'ohm', title: 'Ohmsches Gesetz', text: 'Spannung U (in V) und Stromstärke I (in mA).' },
    { id: 'hooke', title: 'Hooksches Gesetz', text: 'Kraft F (in N) und Dehnung s (in cm).' },
    { id: 'motion', title: 'Gleichförmige Bewegung', text: 'Zeit t (in s) und Strecke s (in m).' },
    { id: 'random', title: 'Freie Zufallsdaten', text: 'Steigung, Achsenabschnitt, Streuung und Unsicherheiten festlegen.' }
  ];
  const compareExamples = [
    { id: 'overlap', title: 'Überlappende Intervalle', text: 'Zwei Periodendauern mit teilweise gemeinsamen Unsicherheitsbereichen.' },
    { id: 'separate', title: 'Getrennte Intervalle', text: 'Zwei Längenmessungen ohne Überlappung der dargestellten Bereiche.' },
    { id: 'precision', title: 'Gleicher Bestwert, andere Präzision', text: 'Gleicher Bestwert mit unterschiedlich großen Unsicherheiten.' }
  ];

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    let s = String(value ?? '').trim().replace(/\u2212/g, '-').replace(/\s/g, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else s = s.replace(',', '.');
    return Number(s);
  }

  function formatNumber(value, maxDecimals = 8) {
    if (!Number.isFinite(value)) return '–';
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: maxDecimals, useGrouping: false }).format(value);
  }

  function formatFixed(value, decimals) {
    if (!Number.isFinite(value)) return '–';
    return new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false }).format(value);
  }

  function roundMeasurement(mean, uncertainty) {
    const u = Math.abs(uncertainty);
    if (!Number.isFinite(u) || !Number.isFinite(mean)) return null;
    if (u === 0) return { mean, uncertainty: 0, decimals: 4 };
    const exponent = Math.floor(Math.log10(u));
    const leading = u / (10 ** exponent);
    const significant = leading < 3 ? 2 : 1;
    const stepExponent = exponent - significant + 1;
    const step = 10 ** stepExponent;
    return {
      mean: Math.round((mean + Number.EPSILON) / step) * step,
      uncertainty: Math.round((u + Number.EPSILON) / step) * step,
      decimals: Math.max(0, -stepExponent)
    };
  }

  function mean(values) { return values.reduce((a, b) => a + b, 0) / values.length; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function gaussian() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function measurementText(symbol, unit, center, uncertainty) {
    const rounded = roundMeasurement(center, uncertainty);
    if (!rounded) return '–';
    const suffix = unit.trim() ? ` ${unit.trim()}` : '';
    return `${symbol.trim() || 'x'} = (${formatFixed(rounded.mean, rounded.decimals)} ± ${formatFixed(rounded.uncertainty, rounded.decimals)})${suffix}`;
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function svgEl(name, attrs = {}, text = '') {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    if (text !== '') el.textContent = text;
    return el;
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('font-family', 'Barlow, Arial, sans-serif');
  }

  function drawEmptyChart(svg, title, subtitle, height = 360) {
    clearSvg(svg);
    svg.append(svgEl('rect', { x: 0, y: 0, width: 1000, height, fill: '#fcfdfc' }));
    svg.append(svgEl('text', { x: 500, y: height / 2 - 8, class: 'empty-state-text' }, title));
    svg.append(svgEl('text', { x: 500, y: height / 2 + 24, class: 'empty-state-subtext' }, subtitle));
  }

  function showView(name) {
    const target = ['series', 'compare', 'linear'].includes(name) ? name : 'home';
    const home = $('#view-home');
    home.hidden = target !== 'home';
    home.classList.toggle('active', target === 'home');
    $$('.view').forEach(view => {
      const active = view.id === `view-${target}`;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    document.title = target === 'home' ? 'Messdaten-Werkbank' : `${$(`#view-${target} h2`)?.textContent || 'Messdaten-Werkbank'} – Messdaten-Werkbank`;
    if (target === 'series') renderSeries();
    if (target === 'compare') renderCompare();
    if (target === 'linear') renderLinear();
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function routeFromHash() {
    showView(location.hash.replace('#', '') || 'home');
  }

  function activateMethod(method, render = true) {
    state.method = method;
    $$('.method-button').forEach(item => {
      const active = item.dataset.method === method;
      item.classList.toggle('active', active);
      item.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    $('#extreme-options').hidden = method !== 'extreme';
    $('#middle-options').hidden = method !== 'middle';
    $('#known-options').hidden = method !== 'known';
    if (render) renderSeries();
  }

  function bindSliderPair(numberSelector, rangeSelector, callback) {
    const number = $(numberSelector), range = $(rangeSelector);
    if (!number || !range) return;
    range.addEventListener('input', () => {
      number.value = formatNumber(Number(range.value), 6);
      callback();
    });
    number.addEventListener('input', () => {
      const value = parseNumber(number.value);
      if (Number.isFinite(value)) {
        if (value < Number(range.min)) range.min = String(value);
        if (value > Number(range.max)) range.max = String(value);
        range.value = String(value);
      }
      callback();
    });
  }

  function niceTicks(min, max, count = 6) {
    const span = Math.max(Math.abs(max - min), 1e-12);
    const raw = span / count;
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    const step = nice * power;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let x = start; x <= max + step * 0.001; x += step) ticks.push(Math.abs(x) < step * 1e-10 ? 0 : x);
    return ticks;
  }

  function seriesMethod(method = state.method) {
    const values = state.series.filter(Number.isFinite);
    if (!values.length) return null;
    const center = mean(values);
    let used = values.map((_, index) => index);
    let uncertainty = 0;
    if (method === 'extreme') {
      const manual = state.extremeMode === 'manual';
      if (manual) used = used.filter(index => !state.excluded.has(index));
      else if (values.length > 2) {
        const minIndex = values.indexOf(Math.min(...values));
        const maxIndex = values.lastIndexOf(Math.max(...values));
        used = used.filter(index => index !== minIndex && index !== maxIndex);
      }
      uncertainty = used.length ? Math.max(...used.map(index => Math.abs(values[index] - center))) : NaN;
    } else if (method === 'middle') {
      const fraction = Number($('#middle-percent').value) / 100;
      used = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
      while (used.length > 2 && used.length - 2 >= values.length * fraction - 1e-10) used = used.slice(1, -1);
      used = used.map(item => item.index);
      uncertainty = Math.max(...used.map(index => Math.abs(values[index] - center)));
    } else if (method === 'mad') {
      uncertainty = values.reduce((sum, value) => sum + Math.abs(value - center), 0) / values.length;
    } else if (method === 'sd') {
      uncertainty = Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length);
    } else if (method === 'known') {
      uncertainty = Math.abs(parseNumber($('#known-uncertainty').value));
    } else {
      uncertainty = Math.max(...values.map(value => Math.abs(value - center)));
    }
    return { values, center, uncertainty, used, excluded: values.map((_, i) => !used.includes(i)) };
  }

  function renderSeriesTable() {
    const body = $('#series-table');
    body.innerHTML = '';
    state.series.forEach((value, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${index + 1}</td><td><input type="text" inputmode="decimal" value="${formatNumber(value)}" aria-label="Messwert ${index + 1}"></td><td class="manual-column"><input type="checkbox" aria-label="Messwert ${index + 1} ausschließen" ${state.excluded.has(index) ? 'checked' : ''}></td><td><button class="delete-row" aria-label="Messwert ${index + 1} löschen">×</button></td>`;
      const input = $('input[type="text"]', row);
      input.addEventListener('change', () => {
        const parsed = parseNumber(input.value);
        if (Number.isFinite(parsed)) state.series[index] = parsed;
        renderSeries();
      });
      const checkbox = $('input[type="checkbox"]', row);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.excluded.add(index); else state.excluded.delete(index);
        state.extremeMode = 'manual'; const auto = $('input[name="extreme-mode"][value="auto"]'); const manual = $('input[name="extreme-mode"][value="manual"]'); if (auto) auto.checked = false; if (manual) manual.checked = true;
        activateMethod('extreme');
      });
      $('.delete-row', row).addEventListener('click', () => {
        state.series.splice(index, 1);
        state.excluded = new Set([...state.excluded].filter(i => i !== index).map(i => i > index ? i - 1 : i));
        renderSeriesTable(); renderSeries();
      });
      body.appendChild(row);
    });
  }

  function renderSeries() {
    const result = seriesMethod();
    state.currentSeriesResult = result;
    const symbol = $('#series-symbol').value.trim();
    const unit = $('#series-unit').value.trim();
    const name = $('#series-name').value.trim();
    const label = `${symbol || 'Messwert'}${unit ? ` (in ${unit})` : ''}`;
    $('#series-table-heading').textContent = label;
    $('#series-chart-title').textContent = name || symbol ? `${name}${name && symbol ? ' ' : ''}${symbol}${unit ? ` (in ${unit})` : ''}` : 'Messreihe';
    if (!result || !Number.isFinite(result.uncertainty)) {
      $('#series-result').textContent = state.series.length ? 'Unsicherheit noch nicht bestimmbar' : 'Noch keine Messwerte';
      $('#series-mean').textContent = '–'; $('#series-uncertainty').textContent = '–'; $('#series-used').textContent = '–';
      drawEmptyChart($('#series-chart'), 'Noch keine Messwerte', 'Werte eingeben oder ein Beispiel auswählen.', 420);
      return;
    }
    $('#series-result').textContent = measurementText(symbol || 'x', unit, result.center, result.uncertainty);
    $('#series-mean').textContent = `${formatNumber(result.center)}${unit ? ` ${unit}` : ''}`;
    $('#series-uncertainty').textContent = `${formatNumber(result.uncertainty)}${unit ? ` ${unit}` : ''}`;
    $('#series-used').textContent = `${result.used.length} von ${result.values.length}`;
    drawSeriesChart(result, label);
    if (!$('#method-comparison').hidden) renderMethodComparison();
  }

  function drawSeriesChart(result, axisLabel) {
    const svg = $('#series-chart'); clearSvg(svg);
    const W = 1000, H = 420, left = 75, right = 40, axisY = 292;
    let min = Math.min(...result.values, result.center - result.uncertainty);
    let max = Math.max(...result.values, result.center + result.uncertainty);
    let span = max - min || Math.abs(max) * 0.1 || 1;
    min -= span * .1; max += span * .1; span = max - min;
    const x = value => left + (value - min) / span * (W - left - right);
    svg.append(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#fcfdfc' }));
    svg.append(svgEl('line', { x1: left, y1: axisY, x2: W - right, y2: axisY, stroke: '#667269', 'stroke-width': 2 }));
    niceTicks(min, max).forEach(tick => {
      const px = x(tick);
      svg.append(svgEl('line', { x1: px, y1: axisY - 7, x2: px, y2: axisY + 7, stroke: '#667269' }));
      svg.append(svgEl('text', { x: px, y: axisY + 30, fill: '#4f5b53', 'font-size': 17, 'text-anchor': 'middle' }, formatNumber(tick, 6)));
    });
    const lo = x(result.center - result.uncertainty), hi = x(result.center + result.uncertainty);
    svg.append(svgEl('line', { x1: lo, y1: 218, x2: hi, y2: 218, stroke: '#05a535', 'stroke-width': 10, 'stroke-linecap': 'round' }));
    [lo, hi].forEach(px => svg.append(svgEl('line', { x1: px, y1: 198, x2: px, y2: 238, stroke: '#05a535', 'stroke-width': 4 })));
    const mx = x(result.center);
    svg.append(svgEl('line', { x1: mx, y1: 92, x2: mx, y2: axisY + 4, stroke: '#245f99', 'stroke-width': 4 }));
    svg.append(svgEl('text', { x: mx, y: 72, fill: '#245f99', 'font-size': 17, 'font-weight': 600, 'text-anchor': 'middle' }, 'Mittelwert'));
    result.values.forEach((value, index) => {
      const cy = 132 + (index % 4) * 19;
      const excluded = result.excluded[index];
      const point = svgEl('circle', { cx: x(value), cy, r: 9, fill: excluded ? '#adb5af' : '#e87524', stroke: '#fff', 'stroke-width': 2, tabindex: 0, role: 'button', 'aria-label': `Messwert ${index + 1} ${excluded ? 'wieder einbeziehen' : 'ausschließen'}`, style: 'cursor:pointer' });
      const togglePoint = () => {
        if (state.excluded.has(index)) state.excluded.delete(index); else state.excluded.add(index);
        state.extremeMode = 'manual'; const auto = $('input[name="extreme-mode"][value="auto"]'); const manual = $('input[name="extreme-mode"][value="manual"]'); if (auto) auto.checked = false; if (manual) manual.checked = true;
        activateMethod('extreme', false); renderSeriesTable(); renderSeries();
      };
      point.addEventListener('click', togglePoint);
      point.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePoint(); } });
      svg.append(point);
    });
    svg.append(svgEl('text', { x: (left + W - right) / 2, y: 390, fill: '#172019', 'font-size': 19, 'font-weight': 600, 'text-anchor': 'middle' }, axisLabel));
  }

  function renderMethodComparison() {
    const methods = [
      ['max', 'Maximalabstand'], ['extreme', 'Extremwerte ausschließen'], ['middle', `Mittlere ${$('#middle-percent').value} %`],
      ['mad', 'Mittlere absolute Abweichung'], ['sd', 'Standardabweichung']
    ];
    if (Number.isFinite(parseNumber($('#known-uncertainty').value))) methods.push(['known', 'Bekannte Unsicherheit']);
    const body = $('#method-comparison-body'); body.innerHTML = '';
    const symbol = $('#series-symbol').value, unit = $('#series-unit').value;
    methods.forEach(([id, label]) => {
      const result = seriesMethod(id); if (!result || !Number.isFinite(result.uncertainty)) return;
      const row = document.createElement('tr');
      row.innerHTML = `<td>${label}</td><td>${formatNumber(result.uncertainty)}${unit ? ` ${unit}` : ''}</td><td><strong>${measurementText(symbol, unit, result.center, result.uncertainty)}</strong></td>`;
      body.appendChild(row);
    });
  }

  function parseSeriesText(text) {
    const tokens = text.split(/[;\t\n\r]+/).flatMap(part => {
      const trimmed = part.trim();
      if (!trimmed) return [];
      if (/^-?\d+(?:[.,]\d+)?(?:\s+-?\d+(?:[.,]\d+)?)+$/.test(trimmed)) return trimmed.split(/\s+/);
      return [trimmed];
    });
    return tokens.map(parseNumber).filter(Number.isFinite);
  }

  function parseTableText(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return { headers: [], rows: [], hasHeader: false };
    const tabCount = lines.reduce((n, line) => n + (line.match(/\t/g) || []).length, 0);
    const semicolonCount = lines.reduce((n, line) => n + (line.match(/;/g) || []).length, 0);
    let delimiter = tabCount ? '\t' : semicolonCount ? ';' : null;
    if (!delimiter) {
      const commaDelimited = lines.some(line => (line.match(/,/g) || []).length > 1) && lines.some(line => /\d\.\d/.test(line));
      delimiter = commaDelimited ? ',' : 'space';
    }
    const split = line => delimiter === 'space' ? line.split(/\s+/) : line.split(delimiter);
    const raw = lines.map(split).map(row => row.map(cell => cell.trim()));
    const width = Math.max(...raw.map(row => row.length));
    const firstNumeric = raw[0].filter(cell => Number.isFinite(parseNumber(cell))).length;
    const hasHeader = firstNumeric < Math.max(1, Math.ceil(width / 2));
    const headers = hasHeader ? raw.shift().map((cell, i) => cell || `Spalte ${i + 1}`) : Array.from({ length: width }, (_, i) => `Spalte ${i + 1}`);
    const rows = raw.map(row => Array.from({ length: width }, (_, i) => parseNumber(row[i])));
    return { headers, rows, hasHeader };
  }

  function metadataFromHeader(header) {
    const raw = String(header || '').trim();
    if (!raw || /^Spalte \d+$/i.test(raw)) return null;
    const unitMatch = raw.match(/(?:\[|\(\s*in\s+|\()\s*([^\]\)]+)\s*[\]\)]\s*$/i);
    const unit = unitMatch ? unitMatch[1].trim() : '';
    const base = unitMatch ? raw.slice(0, unitMatch.index).trim() : raw;
    const tokens = base.split(/\s+/);
    const last = tokens.at(-1) || '';
    const symbol = /^[A-Za-zÄÖÜäöüα-ωΑ-Ω][A-Za-z0-9₀-₉α-ωΑ-Ω]{0,3}$/.test(last) ? last : base;
    const name = symbol !== base ? tokens.slice(0, -1).join(' ') : '';
    return { name, symbol, unit };
  }

  function applyMetadataFromHeader(header, prefix) {
    const meta = metadataFromHeader(header); if (!meta) return;
    if (prefix === 'series') {
      if (meta.name) $('#series-name').value = meta.name;
      if (meta.symbol) $('#series-symbol').value = meta.symbol;
      if (meta.unit) $('#series-unit').value = meta.unit;
    } else {
      if (meta.name) $(`#${prefix}-name`).value = meta.name;
      if (meta.symbol) $(`#${prefix}-symbol`).value = meta.symbol;
      if (meta.unit) $(`#${prefix}-unit`).value = meta.unit;
    }
  }

  function updateColumnSelects(parsed, selectors) {
    selectors.forEach(selector => {
      const select = $(selector); select.innerHTML = '';
      parsed.headers.forEach((header, index) => {
        const option = document.createElement('option'); option.value = index; option.textContent = header; select.appendChild(option);
      });
    });
  }

  function handleFile(file, mode) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTableText(reader.result);
      if (!parsed.rows.length) return toast('Keine numerischen Daten gefunden.');
      if (mode === 'series') {
        state.seriesImport = parsed; updateColumnSelects(parsed, ['#series-column']); $('#series-import-map').hidden = false;
      } else {
        state.linearImport = parsed; updateColumnSelects(parsed, ['#linear-x-column', '#linear-y-column']);
        if (parsed.headers.length > 1) $('#linear-y-column').value = '1';
        $('#linear-import-map').hidden = false;
      }
      toast('Datei eingelesen – bitte Spalten zuordnen.');
    };
    reader.readAsText(file);
  }

  function setSeriesExample(id) {
    if (id === 'random') return openRandomDialog('series');
    const datasets = {
      pendulum: { name: 'Periodendauer', symbol: 'T', unit: 's', values: [30.39, 30.24, 30.28, 30.26, 30.15, 30.24, 30.09, 30.26] },
      outlier: { name: 'Fallzeit', symbol: 't', unit: 's', values: [1.23, 1.19, 1.21, 1.20, 1.18, 1.24, 1.22, 1.81] },
      length: { name: 'Länge', symbol: 'l', unit: 'cm', values: [12.42, 12.38, 12.45, 12.40, 12.41, 12.37, 12.43, 12.39, 12.44, 12.41] }
    };
    const data = datasets[id]; if (!data) return;
    $('#series-name').value = data.name; $('#series-symbol').value = data.symbol; $('#series-unit').value = data.unit;
    state.series = data.values; state.excluded.clear();
    $('#series-paste').value = data.values.map(formatNumber).join('; ');
    renderSeriesTable(); renderSeries();
  }

  function renderCompare() {
    const items = ['a', 'b'].map(id => ({
      id, label: $(`#compare-${id}-label`).value.trim() || `Ergebnis ${id.toUpperCase()}`,
      symbol: $(`#compare-${id}-symbol`).value.trim() || id.toUpperCase(),
      unit: $(`#compare-${id}-unit`).value.trim(), value: parseNumber($(`#compare-${id}-value`).value), u: Math.abs(parseNumber($(`#compare-${id}-u`).value))
    }));
    items.forEach(item => { $(`#compare-${item.id}-result`).textContent = Number.isFinite(item.value) && Number.isFinite(item.u) ? measurementText(item.symbol, item.unit, item.value, item.u) : '–'; });
    const valid = items.filter(item => Number.isFinite(item.value) && Number.isFinite(item.u));
    const svg = $('#compare-chart'); clearSvg(svg);
    if (valid.length < 2) {
      drawEmptyChart(svg, 'Noch keine vollständigen Ergebnisse', 'Beide Bestwerte und Unsicherheiten eingeben oder ein Beispiel auswählen.', 360);
      return;
    }
    const W = 1000, left = 180, right = 45;
    let min = Math.min(...valid.map(item => item.value - item.u)); let max = Math.max(...valid.map(item => item.value + item.u));
    const rawSpan = max - min || Math.abs(max) * .1 || 1; min -= rawSpan * .14; max += rawSpan * .14;
    const span = max - min; const x = value => left + (value - min) / span * (W - left - right);
    svg.append(svgEl('rect', { width: W, height: 360, fill: '#fcfdfc' }));
    const axisY = 285; svg.append(svgEl('line', { x1: left, y1: axisY, x2: W - right, y2: axisY, stroke: '#667269', 'stroke-width': 2 }));
    niceTicks(min, max).forEach(tick => { const px = x(tick); svg.append(svgEl('line', { x1: px, y1: axisY - 6, x2: px, y2: axisY + 6, stroke: '#667269' })); svg.append(svgEl('text', { x: px, y: axisY + 28, 'text-anchor': 'middle', fill: '#4f5b53', 'font-size': 17 }, formatNumber(tick, 6))); });
    valid.forEach((item, i) => {
      const y = 95 + i * 105, color = i ? '#e87524' : '#245f99', lo = x(item.value - item.u), hi = x(item.value + item.u), mid = x(item.value);
      svg.append(svgEl('text', { x: left - 18, y: y + 6, 'text-anchor': 'end', fill: '#172019', 'font-size': 20, 'font-weight': 600 }, item.label));
      svg.append(svgEl('line', { x1: lo, y1: y, x2: hi, y2: y, stroke: color, 'stroke-width': 10, 'stroke-linecap': 'round' }));
      [lo, hi].forEach(px => svg.append(svgEl('line', { x1: px, y1: y - 18, x2: px, y2: y + 18, stroke: color, 'stroke-width': 4 })));
      svg.append(svgEl('circle', { cx: mid, cy: y, r: 10, fill: '#fff', stroke: color, 'stroke-width': 5 }));
    });
    const commonUnit = valid[0].unit === valid[1].unit ? valid[0].unit : '';
    svg.append(svgEl('text', { x: (left + W - right) / 2, y: 348, 'text-anchor': 'middle', fill: '#172019', 'font-size': 19, 'font-weight': 600 }, commonUnit ? `Messwert (in ${commonUnit})` : 'Messwert'));
  }

  function renderLinearTable() {
    const body = $('#linear-table'); body.innerHTML = '';
    state.linear.forEach((pair, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${index + 1}</td><td><input type="text" inputmode="decimal" value="${formatNumber(pair[0])}" aria-label="x-Wert ${index + 1}"></td><td><input type="text" inputmode="decimal" value="${formatNumber(pair[1])}" aria-label="y-Wert ${index + 1}"></td><td><button class="delete-row" aria-label="Datenpaar ${index + 1} löschen">×</button></td>`;
      const inputs = $$('input', row);
      inputs.forEach((input, coordinate) => input.addEventListener('change', () => { const value = parseNumber(input.value); if (Number.isFinite(value)) state.linear[index][coordinate] = value; renderLinear(); }));
      $('.delete-row', row).addEventListener('click', () => { state.linear.splice(index, 1); renderLinearTable(); renderLinear(); });
      body.appendChild(row);
    });
  }

  function feasibleIntercept(points, ux, uy, slope) {
    let lower = -Infinity, upper = Infinity;
    points.forEach(([x, y]) => {
      const xForLower = slope >= 0 ? x + ux : x - ux;
      const xForUpper = slope >= 0 ? x - ux : x + ux;
      lower = Math.max(lower, y - uy - slope * xForLower);
      upper = Math.min(upper, y + uy - slope * xForUpper);
    });
    return { feasible: lower <= upper + 1e-9, lower, upper };
  }

  function slopeBounds(points, ux, uy, theorySlope = 0) {
    if (points.length < 2) return null;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const xr = Math.max(...xs) - Math.min(...xs), yr = Math.max(...ys) - Math.min(...ys);
    const xMean = mean(xs), yMean = mean(ys);
    const denom = points.reduce((sum, p) => sum + (p[0] - xMean) ** 2, 0);
    const ols = denom ? points.reduce((sum, p) => sum + (p[0] - xMean) * (p[1] - yMean), 0) / denom : 0;
    let limit = Math.max(1, Math.abs(ols), Math.abs(theorySlope), (yr + 2 * uy) / Math.max(xr - 2 * ux, xr * .05, 1e-6)) * 24;
    let samples, feasibleIndices;
    for (let attempt = 0; attempt < 4; attempt++) {
      const count = 16000;
      samples = Array.from({ length: count + 1 }, (_, i) => -limit + 2 * limit * i / count);
      feasibleIndices = samples.map((a, i) => feasibleIntercept(points, ux, uy, a).feasible ? i : -1).filter(i => i >= 0);
      if (feasibleIndices.length && feasibleIndices[0] > 0 && feasibleIndices.at(-1) < count) break;
      limit *= 8;
    }
    if (!feasibleIndices.length) return null;
    let first = feasibleIndices[0], last = feasibleIndices.at(-1);
    const refine = (outside, inside) => {
      let a = outside, b = inside;
      for (let i = 0; i < 60; i++) { const mid = (a + b) / 2; if (feasibleIntercept(points, ux, uy, mid).feasible) b = mid; else a = mid; }
      return b;
    };
    const refineMax = (inside, outside) => {
      let a = inside, b = outside;
      for (let i = 0; i < 60; i++) { const mid = (a + b) / 2; if (feasibleIntercept(points, ux, uy, mid).feasible) a = mid; else b = mid; }
      return a;
    };
    const minSlope = first === 0 ? samples[0] : refine(samples[first - 1], samples[first]);
    const maxSlope = last === samples.length - 1 ? samples.at(-1) : refineMax(samples[last], samples[last + 1]);
    const minRange = feasibleIntercept(points, ux, uy, minSlope), maxRange = feasibleIntercept(points, ux, uy, maxSlope);
    const fitSlope = Math.tan((Math.atan(minSlope) + Math.atan(maxSlope)) / 2);
    const fitRange = feasibleIntercept(points, ux, uy, fitSlope);
    return {
      min: { a: minSlope, b: (minRange.lower + minRange.upper) / 2 },
      max: { a: maxSlope, b: (maxRange.lower + maxRange.upper) / 2 },
      fit: { a: fitSlope, b: (fitRange.lower + fitRange.upper) / 2 }
    };
  }

  function renderLinear() {
    const xName = $('#x-name').value.trim(), xSymbol = $('#x-symbol').value.trim() || 'x', xUnit = $('#x-unit').value.trim();
    const yName = $('#y-name').value.trim(), ySymbol = $('#y-symbol').value.trim() || 'y', yUnit = $('#y-unit').value.trim();
    $('#x-table-heading').textContent = `${xSymbol || 'x-Wert'}${xUnit ? ` (in ${xUnit})` : ''}`;
    $('#y-table-heading').textContent = `${ySymbol || 'y-Wert'}${yUnit ? ` (in ${yUnit})` : ''}`;
    $('#linear-chart-title').textContent = state.linear.length ? `${yName || ySymbol} ${ySymbol}${yUnit ? ` (in ${yUnit})` : ''} in Abhängigkeit von ${xName || xSymbol} ${xSymbol}${xUnit ? ` (in ${xUnit})` : ''}` : 'Linearer Zusammenhang';
    $('#theory-formula').textContent = `${ySymbol} = a · ${xSymbol} + b`;
    const points = state.linear.filter(pair => pair.every(Number.isFinite));
    const ux = Math.abs(parseNumber($('#x-uncertainty').value)), uy = Math.abs(parseNumber($('#y-uncertainty').value));
    const theoryA = parseNumber($('#theory-a').value), theoryB = parseNumber($('#theory-b').value);
    const bounds = Number.isFinite(ux) && Number.isFinite(uy) ? slopeBounds(points, ux, uy, theoryA) : null;
    state.currentLineResult = bounds;
    if (bounds) {
      $('#slope-min').textContent = formatNumber(bounds.min.a, 6); $('#slope-max').textContent = formatNumber(bounds.max.a, 6);
      $('#fit-equation').textContent = `${ySymbol} = ${formatNumber(bounds.fit.a, 6)} · ${xSymbol} ${bounds.fit.b < 0 ? '−' : '+'} ${formatNumber(Math.abs(bounds.fit.b), 6)}`;
      $('#line-note').textContent = 'Nutze Diagramm und Geraden für deine eigene fachliche Bewertung.';
    } else {
      $('#slope-min').textContent = '–'; $('#slope-max').textContent = '–'; $('#fit-equation').textContent = '–';
      $('#line-note').textContent = points.length < 2 ? 'Mindestens zwei Datenpaare eingeben.' : 'Für diese Unsicherheitsrechtecke wurde kein gemeinsamer Steigungsbereich gefunden.';
    }
    if (!points.length) drawEmptyChart($('#linear-chart'), 'Noch keine Datenpaare', 'Werte eingeben oder ein Beispiel auswählen.', 620);
    else drawLinearChart(points, ux, uy, theoryA, theoryB, bounds, { xSymbol, xUnit, ySymbol, yUnit });
  }

  function drawLinearChart(points, ux, uy, theoryA, theoryB, bounds, labels) {
    const svg = $('#linear-chart'); clearSvg(svg); if (!points.length) return;
    const W = 1000, H = 620, left = 92, right = 42, top = 35, bottom = 82;
    ux = Number.isFinite(ux) ? ux : 0; uy = Number.isFinite(uy) ? uy : 0;
    let xmin = Math.min(...points.map(p => p[0] - ux)), xmax = Math.max(...points.map(p => p[0] + ux));
    let ymin = Math.min(...points.map(p => p[1] - uy)), ymax = Math.max(...points.map(p => p[1] + uy));
    const xSpanRaw = xmax - xmin || 1, ySpanRaw = ymax - ymin || 1;
    xmin -= xSpanRaw * .09; xmax += xSpanRaw * .09; ymin -= ySpanRaw * .12; ymax += ySpanRaw * .12;
    const xScale = value => left + (value - xmin) / (xmax - xmin) * (W - left - right);
    const yScale = value => H - bottom - (value - ymin) / (ymax - ymin) * (H - top - bottom);
    svg.append(svgEl('rect', { width: W, height: H, fill: '#fcfdfc' }));
    niceTicks(xmin, xmax).forEach(tick => { const px = xScale(tick); svg.append(svgEl('line', { x1: px, y1: top, x2: px, y2: H - bottom, stroke: '#e5ebe7' })); svg.append(svgEl('text', { x: px, y: H - bottom + 28, 'text-anchor': 'middle', fill: '#536058', 'font-size': 16 }, formatNumber(tick, 5))); });
    niceTicks(ymin, ymax).forEach(tick => { const py = yScale(tick); svg.append(svgEl('line', { x1: left, y1: py, x2: W - right, y2: py, stroke: '#e5ebe7' })); svg.append(svgEl('text', { x: left - 13, y: py + 5, 'text-anchor': 'end', fill: '#536058', 'font-size': 16 }, formatNumber(tick, 5))); });
    svg.append(svgEl('line', { x1: left, y1: H - bottom, x2: W - right, y2: H - bottom, stroke: '#56635a', 'stroke-width': 2 }));
    svg.append(svgEl('line', { x1: left, y1: top, x2: left, y2: H - bottom, stroke: '#56635a', 'stroke-width': 2 }));
    points.forEach(([x, y]) => {
      const rx = xScale(x - ux), ry = yScale(y + uy), rw = xScale(x + ux) - rx, rh = yScale(y - uy) - ry;
      svg.append(svgEl('rect', { x: rx, y: ry, width: Math.max(rw, 2), height: Math.max(rh, 2), fill: 'rgba(5,165,53,.13)', stroke: '#05a535', 'stroke-width': 1.5 }));
      svg.append(svgEl('circle', { cx: xScale(x), cy: yScale(y), r: 5.5, fill: '#172019' }));
    });
    const drawLine = (line, color, width, dash = '') => {
      if (!line || !Number.isFinite(line.a) || !Number.isFinite(line.b)) return;
      const x1 = xmin, x2 = xmax, y1 = line.a * x1 + line.b, y2 = line.a * x2 + line.b;
      const attrs = { x1: xScale(x1), y1: yScale(y1), x2: xScale(x2), y2: yScale(y2), stroke: color, 'stroke-width': width, 'clip-path': 'url(#plot-clip)' };
      if (dash) attrs['stroke-dasharray'] = dash;
      svg.append(svgEl('line', attrs));
    };
    const defs = svgEl('defs'); const clip = svgEl('clipPath', { id: 'plot-clip' }); clip.append(svgEl('rect', { x: left, y: top, width: W - left - right, height: H - top - bottom })); defs.append(clip); svg.insertBefore(defs, svg.firstChild);
    if ($('#show-theory').checked && Number.isFinite(theoryA) && Number.isFinite(theoryB)) drawLine({ a: theoryA, b: theoryB }, '#05a535', 4);
    if (bounds && $('#show-bounds').checked) { drawLine(bounds.min, '#e87524', 3, '10 7'); drawLine(bounds.max, '#e87524', 3, '10 7'); }
    if (bounds && $('#show-fit').checked) drawLine(bounds.fit, '#245f99', 4);
    svg.append(svgEl('text', { x: (left + W - right) / 2, y: H - 24, 'text-anchor': 'middle', fill: '#172019', 'font-size': 19, 'font-weight': 600 }, `${labels.xSymbol}${labels.xUnit ? ` (in ${labels.xUnit})` : ''}`));
    const yLabel = svgEl('text', { x: 22, y: (top + H - bottom) / 2, 'text-anchor': 'middle', fill: '#172019', 'font-size': 19, 'font-weight': 600, transform: `rotate(-90 22 ${(top + H - bottom) / 2})` }, `${labels.ySymbol}${labels.yUnit ? ` (in ${labels.yUnit})` : ''}`); svg.append(yLabel);
  }

  function setLinearExample(id) {
    if (id === 'random') return openRandomDialog('linear');
    const examples = {
      ohm: { x: ['Spannung', 'U', 'V'], y: ['Stromstärke', 'I', 'mA'], ux: .08, uy: .8, a: 10, b: 0, values: [[.5, 5.2], [1, 10.4], [1.5, 15.1], [2, 20.7], [2.5, 25.5], [3, 30.8]] },
      hooke: { x: ['Kraft', 'F', 'N'], y: ['Dehnung', 's', 'cm'], ux: .05, uy: .15, a: 2.4, b: .2, values: [[.5, 1.3], [1, 2.65], [1.5, 3.75], [2, 5.1], [2.5, 6.1], [3, 7.45]] },
      motion: { x: ['Zeit', 't', 's'], y: ['Strecke', 's', 'm'], ux: .1, uy: .25, a: 1.8, b: .3, values: [[0, .35], [1, 2.0], [2, 3.95], [3, 5.62], [4, 7.55], [5, 9.2]] }
    };
    const data = examples[id]; if (!data) return;
    [['#x-name', data.x[0]], ['#x-symbol', data.x[1]], ['#x-unit', data.x[2]], ['#y-name', data.y[0]], ['#y-symbol', data.y[1]], ['#y-unit', data.y[2]], ['#x-uncertainty', formatNumber(data.ux)], ['#y-uncertainty', formatNumber(data.uy)], ['#theory-a', formatNumber(data.a)], ['#theory-b', formatNumber(data.b)]].forEach(([selector, value]) => $(selector).value = value);
    [['#x-uncertainty-range', data.ux], ['#y-uncertainty-range', data.uy], ['#theory-a-range', data.a], ['#theory-b-range', data.b]].forEach(([selector, value]) => $(selector).value = String(value));
    state.linear = data.values; $('#linear-paste').value = data.values.map(pair => pair.map(formatNumber).join('\t')).join('\n');
    renderLinearTable(); renderLinear();
  }

  function setCompareExample(id) {
    const examples = {
      overlap: {
        a: ['Pendel A', 'T₁', 's', 2.04, .06], b: ['Pendel B', 'T₂', 's', 2.13, .08]
      },
      separate: {
        a: ['Stab A', 'l₁', 'cm', 12.4, .15], b: ['Stab B', 'l₂', 'cm', 13.1, .18]
      },
      precision: {
        a: ['Messung A', 'U₁', 'V', 5, .5], b: ['Messung B', 'U₂', 'V', 5, .12]
      }
    };
    const data = examples[id]; if (!data) return;
    ['a', 'b'].forEach(key => {
      const [label, symbol, unit, value, uncertainty] = data[key];
      $(`#compare-${key}-label`).value = label; $(`#compare-${key}-symbol`).value = symbol; $(`#compare-${key}-unit`).value = unit;
      $(`#compare-${key}-value`).value = formatNumber(value); $(`#compare-${key}-u`).value = formatNumber(uncertainty);
      $(`#compare-${key}-value-range`).value = String(value); $(`#compare-${key}-u-range`).value = String(uncertainty);
    });
    renderCompare();
  }

  function openExamples(mode) {
    const options = mode === 'series' ? seriesExamples : mode === 'linear' ? linearExamples : compareExamples;
    $('#example-title').textContent = mode === 'series' ? 'Messreihen' : mode === 'linear' ? 'Lineare Datensätze' : 'Messergebnisse';
    const box = $('#example-options'); box.innerHTML = '';
    options.forEach(option => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'example-option';
      button.innerHTML = `<strong>${option.title}</strong><span>${option.text}</span>`;
      button.addEventListener('click', () => { $('#example-dialog').close(); if (mode === 'series') setSeriesExample(option.id); else if (mode === 'linear') setLinearExample(option.id); else setCompareExample(option.id); });
      box.appendChild(button);
    });
    $('#example-dialog').showModal();
  }

  function openRandomDialog(mode) {
    state.randomMode = mode;
    $('#random-title').textContent = mode === 'series' ? 'Messreihe erzeugen' : 'Lineare Daten erzeugen';
    $('#random-fields').innerHTML = mode === 'series'
      ? `<div class="slider-field"><label>Anzahl<input id="random-n" type="text" inputmode="numeric" value="12"></label><input id="random-n-range" type="range" min="3" max="50" value="12" step="1"></div><div class="slider-field"><label>Mittelwert<input id="random-mean" type="text" inputmode="decimal" value="10"></label><input id="random-mean-range" type="range" min="-50" max="50" value="10" step="0.1"></div><div class="slider-field"><label>Streuung σ<input id="random-spread" type="text" inputmode="decimal" value="0,3"></label><input id="random-spread-range" type="range" min="0" max="10" value="0.3" step="0.05"></div>`
      : `<div class="slider-field"><label>Anzahl<input id="random-n" type="text" inputmode="numeric" value="10"></label><input id="random-n-range" type="range" min="3" max="50" value="10" step="1"></div><div class="slider-field"><label>Steigung a<input id="random-a" type="text" inputmode="decimal" value="2"></label><input id="random-a-range" type="range" min="-20" max="20" value="2" step="0.1"></div><div class="slider-field"><label>Abschnitt b<input id="random-b" type="text" inputmode="decimal" value="0,5"></label><input id="random-b-range" type="range" min="-20" max="20" value="0.5" step="0.1"></div><div class="slider-field"><label>Streuung y<input id="random-spread" type="text" inputmode="decimal" value="0,25"></label><input id="random-spread-range" type="range" min="0" max="10" value="0.25" step="0.05"></div><div class="slider-field"><label>x-Unsicherheit<input id="random-ux" type="text" inputmode="decimal" value="0,1"></label><input id="random-ux-range" type="range" min="0" max="5" value="0.1" step="0.01"></div><div class="slider-field"><label>y-Unsicherheit<input id="random-uy" type="text" inputmode="decimal" value="0,3"></label><input id="random-uy-range" type="range" min="0" max="10" value="0.3" step="0.01"></div>`;
    bindSliderPair('#random-n', '#random-n-range', () => {});
    if (mode === 'series') {
      bindSliderPair('#random-mean', '#random-mean-range', () => {}); bindSliderPair('#random-spread', '#random-spread-range', () => {});
    } else {
      bindSliderPair('#random-a', '#random-a-range', () => {}); bindSliderPair('#random-b', '#random-b-range', () => {}); bindSliderPair('#random-spread', '#random-spread-range', () => {}); bindSliderPair('#random-ux', '#random-ux-range', () => {}); bindSliderPair('#random-uy', '#random-uy-range', () => {});
    }
    $('#random-dialog').showModal();
  }

  function generateRandom() {
    const n = clamp(Math.round(parseNumber($('#random-n').value) || 10), 3, state.randomMode === 'series' ? 200 : 100);
    if (state.randomMode === 'series') {
      const center = parseNumber($('#random-mean').value), spread = Math.abs(parseNumber($('#random-spread').value));
      if (!Number.isFinite(center) || !Number.isFinite(spread)) return toast('Bitte gültige Werte eingeben.');
      state.series = Array.from({ length: n }, () => center + gaussian() * spread); state.excluded.clear();
      $('#series-name').value = 'Messgröße'; $('#series-symbol').value = 'x'; $('#series-unit').value = '';
      $('#series-paste').value = state.series.map(value => formatNumber(value, 5)).join('; '); renderSeriesTable(); renderSeries();
    } else {
      const a = parseNumber($('#random-a').value), b = parseNumber($('#random-b').value), spread = Math.abs(parseNumber($('#random-spread').value));
      const ux = Math.abs(parseNumber($('#random-ux').value)), uy = Math.abs(parseNumber($('#random-uy').value));
      if (![a, b, spread, ux, uy].every(Number.isFinite)) return toast('Bitte gültige Werte eingeben.');
      state.linear = Array.from({ length: n }, (_, i) => { const x = n === 1 ? 0 : i * 10 / (n - 1); return [x, a * x + b + gaussian() * spread]; });
      $('#x-name').value = 'x-Größe'; $('#x-symbol').value = 'x'; $('#x-unit').value = ''; $('#y-name').value = 'y-Größe'; $('#y-symbol').value = 'y'; $('#y-unit').value = '';
      $('#x-uncertainty').value = formatNumber(ux); $('#y-uncertainty').value = formatNumber(uy); $('#theory-a').value = formatNumber(a); $('#theory-b').value = formatNumber(b);
      $('#x-uncertainty-range').value = String(ux); $('#y-uncertainty-range').value = String(uy); $('#theory-a-range').value = String(a); $('#theory-b-range').value = String(b);
      $('#linear-paste').value = state.linear.map(pair => pair.map(value => formatNumber(value, 5)).join('\t')).join('\n'); renderLinearTable(); renderLinear();
    }
    $('#random-dialog').close();
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportSvgPng(svg, filename) {
    const clone = svg.cloneNode(true); clone.setAttribute('xmlns', NS); clone.setAttribute('width', 1400);
    const vb = svg.viewBox.baseVal; clone.setAttribute('height', Math.round(1400 * vb.height / vb.width));
    const xml = new XMLSerializer().serializeToString(clone); const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob);
    const image = new Image(); image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = Math.round(1400 * vb.height / vb.width); const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url);
      canvas.toBlob(png => { const pngUrl = URL.createObjectURL(png); const link = document.createElement('a'); link.href = pngUrl; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(pngUrl), 500); }, 'image/png');
    }; image.onerror = () => { URL.revokeObjectURL(url); toast('PNG konnte nicht erzeugt werden.'); }; image.src = url;
  }

  function seriesCsv() {
    const symbol = $('#series-symbol').value.trim() || 'x', unit = $('#series-unit').value.trim();
    const lines = [`Nr.;${symbol}${unit ? ` [${unit}]` : ''}`]; state.series.forEach((value, i) => lines.push(`${i + 1};${formatNumber(value)}`));
    download('messreihe.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function linearCsv() {
    const xs = $('#x-symbol').value.trim() || 'x', xu = $('#x-unit').value.trim(), ys = $('#y-symbol').value.trim() || 'y', yu = $('#y-unit').value.trim();
    const lines = [`${xs}${xu ? ` [${xu}]` : ''};${ys}${yu ? ` [${yu}]` : ''}`]; state.linear.forEach(pair => lines.push(pair.map(formatNumber).join(';')));
    download('lineare-messdaten.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function bindEvents() {
    window.addEventListener('hashchange', routeFromHash);
    $$('.collapse-toggle').forEach(button => button.addEventListener('click', () => {
      const content = document.getElementById(button.dataset.collapseTarget);
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      button.firstChild.textContent = expanded ? 'Daten ausklappen' : 'Daten einklappen';
      content.hidden = expanded;
    }));
    $$('.method-button').forEach(button => button.addEventListener('click', event => {
      if (event.target.closest('.help-dot')) return;
      activateMethod(button.dataset.method);
    }));
    $$('.help-dot').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); const [title, text] = help[button.dataset.help]; $('#help-title').textContent = title; $('#help-content').innerHTML = `<p>${text}</p>`; $('#help-dialog').showModal(); }));
    ['#series-name', '#series-symbol', '#series-unit'].forEach(selector => $(selector).addEventListener('input', renderSeries));
    $('#middle-percent').addEventListener('input', () => { $('#middle-output').textContent = `${$('#middle-percent').value} %`; renderSeries(); });
    bindSliderPair('#known-uncertainty', '#known-uncertainty-range', renderSeries);
    $$('input[name="extreme-mode"]').forEach(input => input.addEventListener('change', () => { state.extremeMode = input.value; renderSeries(); }));
    $('#series-apply').addEventListener('click', () => {
      const text = $('#series-paste').value; const parsed = parseTableText(text);
      if (parsed.headers.length > 1 && parsed.rows.length > 1) {
        state.seriesImport = parsed; updateColumnSelects(parsed, ['#series-column']); $('#series-import-map').hidden = false;
        return toast('Mehrere Spalten erkannt – bitte eine Spalte auswählen.');
      }
      const values = parseSeriesText(text); if (!values.length) return toast('Keine Messwerte erkannt.'); state.series = values; state.excluded.clear(); renderSeriesTable(); renderSeries();
    });
    $('#series-add-row').addEventListener('click', () => { state.series.push(state.series.at(-1) ?? 0); renderSeriesTable(); renderSeries(); });
    $('#series-file').addEventListener('change', event => handleFile(event.target.files[0], 'series'));
    $('#series-use-column').addEventListener('click', () => { const col = Number($('#series-column').value); const values = state.seriesImport.rows.map(row => row[col]).filter(Number.isFinite); if (!values.length) return toast('Diese Spalte enthält keine Zahlen.'); state.series = values; state.excluded.clear(); applyMetadataFromHeader(state.seriesImport.headers[col], 'series'); $('#series-import-map').hidden = true; renderSeriesTable(); renderSeries(); });
    $('#series-example-button').addEventListener('click', () => openExamples('series'));
    $('#compare-methods').addEventListener('click', () => { $('#method-comparison').hidden = false; renderMethodComparison(); $('#method-comparison').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    $('#close-method-comparison').addEventListener('click', () => $('#method-comparison').hidden = true);
    $('#series-png').addEventListener('click', () => exportSvgPng($('#series-chart'), 'messreihe.png')); $('#series-csv').addEventListener('click', seriesCsv);
    ['#compare-a-label', '#compare-a-symbol', '#compare-a-unit', '#compare-b-label', '#compare-b-symbol', '#compare-b-unit'].forEach(selector => $(selector).addEventListener('input', renderCompare));
    ['a', 'b'].forEach(id => { bindSliderPair(`#compare-${id}-value`, `#compare-${id}-value-range`, renderCompare); bindSliderPair(`#compare-${id}-u`, `#compare-${id}-u-range`, renderCompare); });
    $$('.use-series').forEach(button => button.addEventListener('click', () => { const r = state.currentSeriesResult; if (!r || !Number.isFinite(r.uncertainty)) return toast('Zuerst eine Messreihe auswerten.'); const id = button.dataset.target; $(`#compare-${id}-label`).value = $('#series-name').value; $(`#compare-${id}-symbol`).value = $('#series-symbol').value; $(`#compare-${id}-unit`).value = $('#series-unit').value; $(`#compare-${id}-value`).value = formatNumber(r.center); $(`#compare-${id}-u`).value = formatNumber(r.uncertainty); $(`#compare-${id}-value-range`).value = String(r.center); $(`#compare-${id}-u-range`).value = String(r.uncertainty); renderCompare(); }));
    $('#compare-example-button').addEventListener('click', () => openExamples('compare'));
    $('#compare-png').addEventListener('click', () => exportSvgPng($('#compare-chart'), 'messergebnisse-vergleich.png'));
    ['#x-name', '#x-symbol', '#x-unit', '#y-name', '#y-symbol', '#y-unit'].forEach(selector => $(selector).addEventListener('input', renderLinear));
    bindSliderPair('#x-uncertainty', '#x-uncertainty-range', renderLinear); bindSliderPair('#y-uncertainty', '#y-uncertainty-range', renderLinear); bindSliderPair('#theory-a', '#theory-a-range', renderLinear); bindSliderPair('#theory-b', '#theory-b-range', renderLinear);
    ['#show-theory', '#show-bounds', '#show-fit'].forEach(selector => $(selector).addEventListener('change', renderLinear));
    $('#linear-apply').addEventListener('click', () => { const parsed = parseTableText($('#linear-paste').value); const pairs = parsed.rows.map(row => [row[0], row[1]]).filter(pair => pair.every(Number.isFinite)); if (!pairs.length) return toast('Keine Datenpaare erkannt.'); state.linear = pairs; renderLinearTable(); renderLinear(); });
    $('#linear-add-row').addEventListener('click', () => { const last = state.linear.at(-1) || [0, 0]; state.linear.push([last[0] + 1, last[1]]); renderLinearTable(); renderLinear(); });
    $('#linear-file').addEventListener('change', event => handleFile(event.target.files[0], 'linear'));
    $('#linear-use-columns').addEventListener('click', () => { const xcol = Number($('#linear-x-column').value), ycol = Number($('#linear-y-column').value); if (xcol === ycol) return toast('Bitte zwei verschiedene Spalten wählen.'); const pairs = state.linearImport.rows.map(row => [row[xcol], row[ycol]]).filter(pair => pair.every(Number.isFinite)); if (!pairs.length) return toast('Keine vollständigen Datenpaare gefunden.'); state.linear = pairs; applyMetadataFromHeader(state.linearImport.headers[xcol], 'x'); applyMetadataFromHeader(state.linearImport.headers[ycol], 'y'); $('#linear-import-map').hidden = true; renderLinearTable(); renderLinear(); });
    $('#linear-example-button').addEventListener('click', () => openExamples('linear'));
    $('#linear-png').addEventListener('click', () => exportSvgPng($('#linear-chart'), 'linearer-zusammenhang.png')); $('#linear-csv').addEventListener('click', linearCsv);
    $('#random-generate').addEventListener('click', event => { event.preventDefault(); generateRandom(); });
  }

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: 'set_series_data', title: 'Messreihe setzen', description: 'Setzt die sichtbare Messreihe und ihre frei wählbaren Größenangaben.',
        inputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' }, minItems: 1 }, name: { type: 'string' }, symbol: { type: 'string' }, unit: { type: 'string' } }, required: ['values'], additionalProperties: false },
        execute(input) { if (!Array.isArray(input.values) || !input.values.every(Number.isFinite)) throw new Error('values muss ein Zahlenfeld sein'); state.series = input.values; if (input.name != null) $('#series-name').value = input.name; if (input.symbol != null) $('#series-symbol').value = input.symbol; if (input.unit != null) $('#series-unit').value = input.unit; renderSeriesTable(); renderSeries(); return { count: state.series.length, result: $('#series-result').textContent }; }
      },
      {
        name: 'set_linear_data', title: 'Lineare Messdaten setzen', description: 'Setzt die sichtbaren x-/y-Datenpaare und die konstanten Unsicherheiten.',
        inputSchema: { type: 'object', properties: { points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 2 }, xUncertainty: { type: 'number', minimum: 0 }, yUncertainty: { type: 'number', minimum: 0 } }, required: ['points'], additionalProperties: false },
        execute(input) { if (!Array.isArray(input.points) || !input.points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new Error('points muss Datenpaare enthalten'); state.linear = input.points; if (Number.isFinite(input.xUncertainty)) $('#x-uncertainty').value = formatNumber(input.xUncertainty); if (Number.isFinite(input.yUncertainty)) $('#y-uncertainty').value = formatNumber(input.yUncertainty); renderLinearTable(); renderLinear(); return { count: state.linear.length, bounds: state.currentLineResult }; }
      }
    ];
    tools.forEach(tool => { try { Promise.resolve(context.registerTool({ ...tool, annotations: { readOnlyHint: false, untrustedContentHint: false } })).catch(() => {}); } catch (_) {} });
  }

  bindEvents(); renderSeriesTable(); renderSeries(); renderCompare(); renderLinearTable(); renderLinear(); routeFromHash(); registerWebMcp();
})();
