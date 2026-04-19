// webapp/js/chart.js
import { VARIABLES } from './data.js';

let _chart        = null;
let _canvasId     = null;
let _modalEl      = null;
let _titleEl      = null;
let _chartType    = 'timeseries';
let _highlightIdx = null;
// _scatterIdxMap[ds][ptIdx] → data1 index  (ds 0 = normal, 1 = >50% diff)
let _scatterIdxMap = null;
// _scatterRevMap: data1 index → { ds, idx }
let _scatterRevMap = null;
let _onChartHoverCb  = null;
let _onChartClickCb  = null;
let _pinnedChartIdx  = null;
let _heatmapCorr     = null; // correlation matrix for heatmap plugin

const _SCATTER_LIKE = new Set(['scatter', 'bland-altman', 'pctdiff']);

// ── Helpers ────────────────────────────────────────────
function _linearRegression(pts) {
  const n = pts.length;
  if (n < 2) return { m: 1, b: 0, r2: null };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sx2 = 0, sy2 = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxy += dx * dy; sx2 += dx * dx; sy2 += dy * dy;
  }
  if (sx2 === 0) return { m: 0, b: my, r2: null };
  const m  = sxy / sx2;
  const b  = my - m * mx;
  const r2 = sy2 === 0 ? 1 : Math.min(1, (sxy * sxy) / (sx2 * sy2));
  return { m, b, r2 };
}

function _pearsonR(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  let sa = 0, sb = 0, pairs = 0;
  const va = [], vb = [];
  for (let i = 0; i < n; i++) {
    if (a[i] != null && b[i] != null) { va.push(a[i]); vb.push(b[i]); sa += a[i]; sb += b[i]; pairs++; }
  }
  if (pairs < 2) return 0;
  const ma = sa / pairs, mb = sb / pairs;
  let num = 0, da2 = 0, db2 = 0;
  for (let i = 0; i < pairs; i++) {
    const da = va[i] - ma, db = vb[i] - mb;
    num += da * db; da2 += da * da; db2 += db * db;
  }
  return (da2 === 0 || db2 === 0) ? 0 : num / Math.sqrt(da2 * db2);
}

function _corrColor(r) {
  const t = Math.max(-1, Math.min(1, r));
  if (t >= 0) return `rgb(${Math.round(40 + 195 * t)},${Math.round(45 + 5 * t)},${Math.round(60 - 10 * t)})`;
  const s = -t;
  return `rgb(${Math.round(40 - 10 * s)},${Math.round(45 + 55 * s)},${Math.round(60 + 185 * s)})`;
}

// ── Heatmap ────────────────────────────────────────────
const HEATMAP_VARS = [
  { key: 'hfss_m', label: 'SHF \u03bc' },
  { key: 'hfss_s', label: 'SHF \u03c3' },
  { key: 'hfls_m', label: 'LHF \u03bc' },
  { key: 'hfls_s', label: 'LHF \u03c3' },
  { key: 'tau_m',  label: '\u03c4 \u03bc' },
  { key: 'tau_s',  label: '\u03c4 \u03c3' },
  { key: 'dmo',    label: 'DMO' },
  { key: 'T_s',    label: 'T \u03c3' },
  { key: 'TS_s',   label: 'TS \u03c3' },
  { key: 'RH_s',   label: 'RH \u03c3' },
  { key: 'P_s',    label: 'P \u03c3' },
  { key: 'SPD_s',  label: 'SPD \u03c3' },
  { key: 'enthalpy_m', label: 'H \u03bc' },
  { key: 'enthalpy_s', label: 'H \u03c3' },
];

const _heatmapPlugin = {
  id: 'heatmapDraw',
  afterDraw(chart) {
    if (_chartType !== 'heatmap' || !_heatmapCorr) return;
    const { ctx, width, height } = chart;
    const vars = HEATMAP_VARS;
    const n = vars.length;
    const marginL = 52, marginB = 54, marginT = 10, marginR = 10;
    const gridW = width  - marginL - marginR;
    const gridH = height - marginT - marginB;
    const cell  = Math.min(gridW / n, gridH / n);
    const offX  = marginL + (gridW - cell * n) / 2;
    const offY  = marginT + (gridH - cell * n) / 2;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const r = _heatmapCorr[i][j];
        ctx.fillStyle = _corrColor(r);
        ctx.fillRect(offX + j * cell, offY + i * cell, cell, cell);
        if (cell >= 22) {
          const fs = Math.min(9, cell * 0.28);
          ctx.font = `${fs}px Inter, sans-serif`;
          ctx.fillStyle = Math.abs(r) > 0.55 ? '#fff' : '#9ab';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(r.toFixed(2), offX + (j + 0.5) * cell, offY + (i + 0.5) * cell);
        }
      }
    }

    const labelFs = Math.min(11, cell * 0.38);
    ctx.fillStyle = '#a5f3fc';
    ctx.font = `${labelFs}px Inter, sans-serif`;

    // Row labels (left)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++)
      ctx.fillText(vars[i].label, offX - 5, offY + (i + 0.5) * cell);

    // Column labels (bottom, rotated)
    for (let j = 0; j < n; j++) {
      ctx.save();
      ctx.translate(offX + (j + 0.5) * cell, offY + n * cell + 5);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(vars[j].label, 0, 0);
      ctx.restore();
    }

    // Color scale bar
    const barX = offX + n * cell + 8, barY = offY, barW = 12, barH = n * cell;
    const grad = ctx.createLinearGradient(0, barY, 0, barY + barH);
    grad.addColorStop(0,   _corrColor(1));
    grad.addColorStop(0.5, _corrColor(0));
    grad.addColorStop(1,   _corrColor(-1));
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#6b7f9e';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('+1', barX + barW + 3, barY);
    ctx.fillText(' 0', barX + barW + 3, barY + barH / 2);
    ctx.fillText('\u22121', barX + barW + 3, barY + barH);

    ctx.restore();
  },
};

// ── Plugins ────────────────────────────────────────────
const _verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw(chart) {
    if (_chartType !== 'timeseries' || _highlightIdx === null) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data[_highlightIdx]) return;
    const x = meta.data[_highlightIdx].x;
    const { ctx, scales: { y } } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y.top);
    ctx.lineTo(x, y.bottom);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

const _hoverSyncPlugin = {
  id: 'hoverSync',
  afterEvent(chart, args) {
    if (args.event.type !== 'mousemove' && args.event.type !== 'mouseout') return;
    if (!_onChartHoverCb) return;
    if (_SCATTER_LIKE.has(_chartType)) {
      const pts = chart.getElementsAtEventForMode(
        args.event.native, 'nearest', { intersect: true }, false
      );
      const pt = pts.find(p => p.datasetIndex === 0 || p.datasetIndex === 1);
      if (pt !== undefined && _scatterIdxMap) {
        _onChartHoverCb(_scatterIdxMap[pt.datasetIndex]?.[pt.index] ?? null);
      } else if (_pinnedChartIdx !== null) {
        const loc = _scatterRevMap?.get(_pinnedChartIdx);
        chart.setActiveElements(loc ? [{ datasetIndex: loc.ds, index: loc.idx }] : []);
        chart.update('none');
        _onChartHoverCb(_pinnedChartIdx);
      } else {
        _onChartHoverCb(null);
      }
    } else if (_chartType === 'timeseries') {
      const pts = chart.getElementsAtEventForMode(
        args.event.native, 'index', { intersect: false }, false
      );
      _onChartHoverCb(pts.length ? pts[0].index : null);
    }
  },
};

// ── Scale configs ──────────────────────────────────────
const _TICK   = { color: '#6b7f9e', font: { family: 'Inter', size: 11 } };
const _GRID   = { color: 'rgba(255,255,255,0.05)' };
const _BORDER = { color: 'rgba(255,255,255,0.08)' };
const _TITLE  = (text = '') => ({
  display: true, text,
  color: '#a5f3fc',
  font: { family: 'Inter', size: 11, weight: '500' },
});

function _timeseriesScales() {
  return {
    x: {
      type: 'time',
      border: _BORDER,
      time: {
        displayFormats: {
          minute: 'MMM d HH:mm', hour: 'MMM d HH:mm',
          day: 'MMM d', week: 'MMM d', month: 'MMM yyyy',
        },
      },
      ticks: { ..._TICK, maxTicksLimit: 10 },
      grid: _GRID,
    },
    y: { ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE() },
  };
}

function _scatterScales() {
  return {
    x: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Run 1') },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Run 2') },
  };
}

function _blandAltmanScales() {
  return {
    x: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Mean of Run 1 and Run 2') },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Run 2 \u2212 Run 1') },
  };
}

function _histScales() {
  return {
    x: { type: 'linear', ticks: { ..._TICK, maxTicksLimit: 14 }, grid: _GRID, border: _BORDER, title: _TITLE() },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Count'), beginAtZero: true },
  };
}

function _cdfScales() {
  return {
    x: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE() },
    y: {
      type: 'linear', min: 0, max: 1,
      ticks: { ..._TICK, callback: v => v.toFixed(1) },
      grid: _GRID, border: _BORDER, title: _TITLE('Cumulative Probability'),
    },
  };
}

function _boxplotScales() {
  return {
    x: { ticks: { ..._TICK, maxTicksLimit: 12 }, grid: _GRID, border: _BORDER },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE() },
  };
}

function _diurnalScales() {
  return {
    x: {
      type: 'linear', min: 0, max: 23,
      ticks: { ..._TICK, stepSize: 3, callback: h => `${h}:00` },
      grid: _GRID, border: _BORDER, title: _TITLE('Hour of Day (UTC)'),
    },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE() },
  };
}

function _latvarScales() {
  return {
    x: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Latitude (\u00b0N)') },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE() },
  };
}

function _pctdiffScales() {
  return {
    x: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Mean of Run 1 and Run 2') },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('% Difference') },
  };
}

function _qqplotScales() {
  return {
    x: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Run 1 Quantiles') },
    y: { type: 'linear', ticks: _TICK, grid: _GRID, border: _BORDER, title: _TITLE('Run 2 Quantiles') },
  };
}

function _heatmapScales() {
  return {
    x: { display: false },
    y: { display: false },
  };
}

// ── Chart creation ─────────────────────────────────────
function _buildChart() {
  const isSL      = _SCATTER_LIKE.has(_chartType);
  const isHist    = _chartType === 'histogram';
  const isCDF     = _chartType === 'cdf';
  const isBox     = _chartType === 'boxplot';
  const isDiurnal = _chartType === 'diurnal';
  const isLatvar  = _chartType === 'latvar';
  const isQQ      = _chartType === 'qqplot';
  const isHeatmap = _chartType === 'heatmap';

  const hasLegend = isSL || isCDF || isHist || isDiurnal || isQQ;
  const baseType  = isBox || isHist ? 'bar' : isSL || isCDF || isQQ || isLatvar || isDiurnal || isHeatmap ? 'scatter' : 'line';
  const spanGaps  = !isSL && !isCDF && !isHist && !isBox && !isHeatmap && !isDiurnal && !isQQ && !isLatvar;
  const normalized = !isSL && !isCDF && !isHist && !isBox && !isHeatmap && !isDiurnal && !isQQ && !isLatvar;

  const scales =
    _chartType === 'bland-altman' ? _blandAltmanScales() :
    isSL        ? _scatterScales() :
    isHist      ? _histScales()    :
    isCDF       ? _cdfScales()     :
    isBox       ? _boxplotScales() :
    isDiurnal   ? _diurnalScales() :
    isLatvar    ? _latvarScales()  :
    _chartType === 'pctdiff' ? _pctdiffScales() :
    isQQ        ? _qqplotScales()  :
    isHeatmap   ? _heatmapScales() :
    _timeseriesScales();

  return new Chart(document.getElementById(_canvasId), {
    type: baseType,
    data: { datasets: [] },
    options: {
      animation: false,
      spanGaps,
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized,
      scales,
      onClick: (evt, elements) => {
        if (!isSL) return;
        const el = elements.find(e => e.datasetIndex === 0 || e.datasetIndex === 1);
        if (el !== undefined && _scatterIdxMap) {
          const data1Idx = _scatterIdxMap[el.datasetIndex]?.[el.index];
          if (data1Idx != null) {
            if (_pinnedChartIdx === data1Idx) {
              _pinnedChartIdx = null;
              if (_onChartClickCb) _onChartClickCb(null);
            } else {
              _pinnedChartIdx = data1Idx;
              if (_onChartClickCb) _onChartClickCb(data1Idx);
            }
            return;
          }
        }
        if (_pinnedChartIdx !== null) {
          _pinnedChartIdx = null;
          if (_onChartClickCb) _onChartClickCb(null);
          _chart?.setActiveElements([]);
          _chart?.update('none');
          if (_onChartHoverCb) _onChartHoverCb(null);
        }
      },
      plugins: {
        legend: {
          display: hasLegend,
          labels: {
            color: '#d8e4f5',
            font: { family: 'Inter', size: 11 },
            boxWidth: 24, boxHeight: 3, padding: 14,
            filter: item => item.text != null,
          },
        },
        tooltip: { enabled: false },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
          pan:  { enabled: true, mode: 'xy' },
        },
      },
    },
    plugins: [_verticalLinePlugin, _hoverSyncPlugin, _heatmapPlugin],
  });
}

// ── Public API ─────────────────────────────────────────
export function initChart(modalId, _backdropId, canvasId, titleId) {
  if (_modalEl) return;
  _canvasId = canvasId;
  _modalEl  = document.getElementById(modalId);
  _titleEl  = document.getElementById(titleId);
  _chart    = _buildChart();
  document.getElementById(canvasId).addEventListener('dblclick', () => _chart?.resetZoom());
}

export function onChartHover(cb)  { _onChartHoverCb = cb; }
export function onChartClick(cb)  { _onChartClickCb = cb; }

export function setChartType(type) {
  if (_chartType === type) return;
  _chartType      = type;
  _highlightIdx   = null;
  _scatterIdxMap  = null;
  _scatterRevMap  = null;
  _pinnedChartIdx = null;
  _heatmapCorr    = null;
  if (_chart) { _chart.destroy(); _chart = null; }
  if (_canvasId)  _chart = _buildChart();
}

export function render(data, varKey) {
  if (!_chart || _chartType !== 'timeseries') return;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;
  const values  = data[varKey];
  _chart.data.datasets = [{
    data: data.timestamps.map((ts, i) => ({ x: ts, y: values[i] })),
    borderColor: '#22d3ee', borderWidth: 1.5,
    pointRadius: 0, pointHoverRadius: 4,
    pointHoverBackgroundColor: '#22d3ee',
  }];
  _chart.options.scales.y.title.text = label;
  if (_titleEl) _titleEl.textContent = `Time Series \u2014 ${label}`;
  _highlightIdx = null;
  _chart.update();
}

// ── Shared scatter-like builder ────────────────────────
function _buildScatterPairs(data1, data2, varKey, xFn, yFn) {
  const tsMap = new Map();
  for (let j = 0; j < data2.n; j++) {
    if (data2.timestamps[j] !== null) tsMap.set(data2.timestamps[j], j);
  }
  const normalPts = [], diffPts = [], normalIdx = [], diffIdx = [];
  const revMap = new Map();
  for (let i = 0; i < data1.n; i++) {
    const ts = data1.timestamps[i];
    if (ts === null) continue;
    const j = tsMap.get(ts);
    if (j === undefined) continue;
    const v1 = data1[varKey]?.[i], v2 = data2[varKey]?.[j];
    if (v1 == null || v2 == null) continue;
    const maxAbs = Math.max(Math.abs(v1), Math.abs(v2));
    const isDiff = maxAbs > 1e-10 && Math.abs(v1 - v2) / maxAbs > 0.5;
    const pt = { x: xFn(v1, v2), y: yFn(v1, v2) };
    if (isDiff) { revMap.set(i, { ds: 1, idx: diffPts.length }); diffPts.push(pt); diffIdx.push(i); }
    else        { revMap.set(i, { ds: 0, idx: normalPts.length }); normalPts.push(pt); normalIdx.push(i); }
  }
  return { normalPts, diffPts, normalIdx, diffIdx, revMap };
}

function _scatterDatasets(normalPts, diffPts) {
  const _pt = (bg, border) => ({
    type: 'scatter', backgroundColor: bg, borderColor: border,
    borderWidth: 1, pointRadius: 3, pointHoverRadius: 7,
    pointHoverBorderColor: '#fff', pointHoverBorderWidth: 1.5,
  });
  return [
    { label: 'All points', data: normalPts, ..._pt('rgba(34,211,238,0.35)', 'rgba(34,211,238,0.75)') },
    { label: '>50% diff',  data: diffPts,   ..._pt('rgba(239,100,100,0.55)', 'rgba(239,100,100,0.85)'), pointHoverBackgroundColor: '#ef6464' },
  ];
}

function _hLines(allPts, extraY = null) {
  let xMin = Infinity, xMax = -Infinity;
  for (const p of allPts) { if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x; }
  if (extraY !== null) { if (extraY < xMin) xMin = extraY; if (extraY > xMax) xMax = extraY; }
  const pad = xMin < Infinity ? (xMax - xMin) * 0.02 : 0;
  const x0 = xMin - pad, x1 = xMax + pad;
  return (y, color, dash, lbl) => ({
    label: lbl, type: 'line',
    data: xMin < Infinity ? [{ x: x0, y }, { x: x1, y }] : [],
    borderColor: color, borderWidth: 1.5, borderDash: dash,
    pointRadius: 0, pointHoverRadius: 0,
  });
}

function _diffStats(pts) {
  let sum = 0; for (const p of pts) sum += p.y;
  const mean = pts.length ? sum / pts.length : 0;
  let sq = 0; for (const p of pts) sq += (p.y - mean) ** 2;
  const std = pts.length > 1 ? Math.sqrt(sq / (pts.length - 1)) : 0;
  return { mean, loa: 1.96 * std };
}

// ── Render functions ───────────────────────────────────
export function renderScatter(data1, data2, varKey) {
  if (!_chart || _chartType !== 'scatter') return;
  _pinnedChartIdx = null;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const { normalPts, diffPts, normalIdx, diffIdx, revMap } =
    _buildScatterPairs(data1, data2, varKey, (a) => a, (_, b) => b);
  _scatterIdxMap = [normalIdx, diffIdx];
  _scatterRevMap = revMap;

  const allPts = [...normalPts, ...diffPts];
  let mn = Infinity, mx = -Infinity;
  for (const p of allPts) {
    if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x;
    if (p.y < mn) mn = p.y; if (p.y > mx) mx = p.y;
  }
  const diag = mn < Infinity ? [{ x: mn, y: mn }, { x: mx, y: mx }] : [];
  const { m, b, r2 } = _linearRegression(allPts);
  const fitLine = mn < Infinity ? [{ x: mn, y: m * mn + b }, { x: mx, y: m * mx + b }] : [];

  _chart.data.datasets = [
    ..._scatterDatasets(normalPts, diffPts),
    { label: '1:1 line', type: 'line', data: diag, borderColor: 'rgba(239,100,100,0.55)', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0 },
    { label: `Fit (R\u00b2=${r2 !== null ? r2.toFixed(4) : '\u2014'})`, type: 'line', data: fitLine, borderColor: 'rgba(255,255,255,0.80)', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0 },
  ];
  _chart.options.scales.x.title.text = `Run 1 \u2014 ${label}`;
  _chart.options.scales.y.title.text = `Run 2 \u2014 ${label}`;
  if (_titleEl) _titleEl.textContent = `Run 1 vs Run 2 \u2014 ${label}`;
  _chart.update();
}

export function renderHistDiff(data1, data2, varKey) {
  if (!_chart || _chartType !== 'histogram') return;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const tsMap = new Map();
  for (let j = 0; j < data2.n; j++) {
    if (data2.timestamps[j] !== null) tsMap.set(data2.timestamps[j], j);
  }
  const diffs = [];
  for (let i = 0; i < data1.n; i++) {
    const ts = data1.timestamps[i];
    if (ts === null) continue;
    const j = tsMap.get(ts);
    if (j === undefined) continue;
    const v1 = data1[varKey]?.[i], v2 = data2[varKey]?.[j];
    if (v1 == null || v2 == null) continue;
    diffs.push(v2 - v1);
  }
  if (!diffs.length) { _chart.data.datasets = []; _chart.update(); return; }

  const nBins    = Math.min(60, Math.max(10, Math.ceil(Math.sqrt(diffs.length))));
  const dMin     = Math.min(...diffs), dMax = Math.max(...diffs);
  const binWidth = (dMax - dMin) / nBins || 1;
  const counts   = new Array(nBins).fill(0);
  for (const d of diffs) counts[Math.min(Math.floor((d - dMin) / binWidth), nBins - 1)]++;

  let sumD = 0; for (const d of diffs) sumD += d;
  const meanD = sumD / diffs.length;
  let sumSq = 0; for (const d of diffs) sumSq += (d - meanD) ** 2;
  const stdD = Math.sqrt(sumSq / (diffs.length - 1));
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(3);

  _chart.data.datasets = [{
    label: `n=${diffs.length}   \u03bc=${fmt(meanD)}   \u03c3=${stdD.toFixed(3)}`,
    data: counts.map((y, i) => ({ x: dMin + (i + 0.5) * binWidth, y })),
    backgroundColor: 'rgba(34,211,238,0.35)',
    borderColor: 'rgba(34,211,238,0.75)',
    borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0,
  }];
  _chart.options.scales.x.title.text = `Run 2 \u2212 Run 1 \u2014 ${label}`;
  _chart.options.scales.y.title.text = 'Count';
  if (_titleEl) _titleEl.textContent = `Difference Distribution \u2014 ${label}`;
  _chart.update();
}

export function renderCDF(data1, data2, varKey) {
  if (!_chart || _chartType !== 'cdf') return;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const _ecdf = vals => {
    const sorted = vals.filter(v => v != null).sort((a, b) => a - b);
    const n = sorted.length;
    if (!n) return [];
    const step = Math.max(1, Math.floor(n / 2000));
    const pts = [];
    for (let i = 0; i < n; i += step) pts.push({ x: sorted[i], y: (i + 1) / n });
    if (pts[pts.length - 1]?.x !== sorted[n - 1]) pts.push({ x: sorted[n - 1], y: 1.0 });
    return pts;
  };
  const _lineDs = (data, color, lbl) => ({
    label: lbl, type: 'line', data, borderColor: color, borderWidth: 1.5,
    pointRadius: 0, pointHoverRadius: 0, stepped: 'before', fill: false,
  });

  _chart.data.datasets = [
    _lineDs(_ecdf(data1[varKey] ?? []), 'rgba(34,211,238,0.85)',  'Run 1'),
    _lineDs(_ecdf(data2[varKey] ?? []), 'rgba(251,191,36,0.85)',  'Run 2'),
  ];
  _chart.options.scales.x.title.text = label;
  _chart.options.scales.y.title.text = 'Cumulative Probability';
  if (_titleEl) _titleEl.textContent = `CDF \u2014 ${label}`;
  _chart.update();
}

export function renderBlandAltman(data1, data2, varKey) {
  if (!_chart || _chartType !== 'bland-altman') return;
  _pinnedChartIdx = null;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const { normalPts, diffPts, normalIdx, diffIdx, revMap } =
    _buildScatterPairs(data1, data2, varKey, (a, b) => (a + b) / 2, (a, b) => b - a);
  _scatterIdxMap = [normalIdx, diffIdx];
  _scatterRevMap = revMap;

  const allPts = [...normalPts, ...diffPts];
  const { mean: meanDiff, loa } = _diffStats(allPts);
  const hLine = _hLines(allPts);
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(3);

  _chart.data.datasets = [
    ..._scatterDatasets(normalPts, diffPts),
    hLine(meanDiff,       'rgba(59,130,246,0.85)',  [6, 4], `Mean diff = ${fmt(meanDiff)}`),
    hLine(meanDiff + loa, 'rgba(160,160,160,0.70)', [4, 4], `\u00b11.96\u03c3 = ${fmt(loa)}`),
    hLine(meanDiff - loa, 'rgba(160,160,160,0.70)', [4, 4], null),
  ];
  _chart.options.scales.x.title.text = `Mean of Run 1 and Run 2 \u2014 ${label}`;
  _chart.options.scales.y.title.text = 'Run 2 \u2212 Run 1';
  if (_titleEl) _titleEl.textContent = `Bland\u2013Altman \u2014 ${label}`;
  _chart.update();
}

export function renderPctDiff(data1, data2, varKey) {
  if (!_chart || _chartType !== 'pctdiff') return;
  _pinnedChartIdx = null;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const { normalPts, diffPts, normalIdx, diffIdx, revMap } =
    _buildScatterPairs(data1, data2, varKey,
      (a, b) => (a + b) / 2,
      (a, b) => { const m = (a + b) / 2; return m !== 0 ? (b - a) / Math.abs(m) * 100 : 0; }
    );
  _scatterIdxMap = [normalIdx, diffIdx];
  _scatterRevMap = revMap;

  const allPts = [...normalPts, ...diffPts];
  const { mean: meanPct, loa } = _diffStats(allPts);
  const hLine = _hLines(allPts);
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);

  _chart.data.datasets = [
    ..._scatterDatasets(normalPts, diffPts),
    hLine(0,              'rgba(100,100,100,0.50)', [4, 4], '0%'),
    hLine(meanPct,        'rgba(59,130,246,0.85)',  [6, 4], `Mean = ${fmt(meanPct)}%`),
    hLine(meanPct + loa,  'rgba(160,160,160,0.70)', [4, 4], `\u00b11.96\u03c3 = ${fmt(loa)}%`),
    hLine(meanPct - loa,  'rgba(160,160,160,0.70)', [4, 4], null),
  ];
  _chart.options.scales.x.title.text = `Mean of Run 1 and Run 2 \u2014 ${label}`;
  _chart.options.scales.y.title.text = '(R2\u2212R1) / |mean| \u00d7 100 %';
  if (_titleEl) _titleEl.textContent = `% Difference \u2014 ${label}`;
  _chart.update();
}

export function renderQQPlot(data1, data2, varKey) {
  if (!_chart || _chartType !== 'qqplot') return;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const _sort = arr => (arr ?? []).filter(v => v != null).sort((a, b) => a - b);
  const v1 = _sort(data1[varKey]), v2 = _sort(data2[varKey]);
  if (!v1.length || !v2.length) { _chart.data.datasets = []; _chart.update(); return; }

  const nQ = Math.min(500, v1.length, v2.length);
  const _q = (s, p) => { const pos = p * (s.length - 1), lo = Math.floor(pos); return s[lo] + (s[lo + 1] - s[lo] || 0) * (pos - lo); };
  const qqPts = Array.from({ length: nQ }, (_, k) => {
    const p = k / Math.max(nQ - 1, 1);
    return { x: _q(v1, p), y: _q(v2, p) };
  });

  let mn = Infinity, mx = -Infinity;
  for (const p of qqPts) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; if (p.y < mn) mn = p.y; if (p.y > mx) mx = p.y; }
  const diag = mn < Infinity ? [{ x: mn, y: mn }, { x: mx, y: mx }] : [];

  _chart.data.datasets = [
    { label: 'Quantiles', data: qqPts, backgroundColor: 'rgba(34,211,238,0.5)', borderColor: 'rgba(34,211,238,0.85)', borderWidth: 1, pointRadius: 2, pointHoverRadius: 5 },
    { label: '1:1', type: 'line', data: diag, borderColor: 'rgba(239,100,100,0.6)', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0 },
  ];
  _chart.options.scales.x.title.text = `Run 1 \u2014 ${label}`;
  _chart.options.scales.y.title.text = `Run 2 \u2014 ${label}`;
  if (_titleEl) _titleEl.textContent = `Q\u2013Q Plot \u2014 ${label}`;
  _chart.update();
}

export function renderBoxplot(data, varKey) {
  if (!_chart || _chartType !== 'boxplot') return;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < data.n; i++) {
    const ts = data.timestamps[i], v = data[varKey]?.[i];
    if (ts === null || v == null) continue;
    byMonth[new Date(ts).getUTCMonth()].push(v);
  }

  const labels = [], whiskerData = [], boxData = [], medianData = [];
  for (let m = 0; m < 12; m++) {
    const vals = byMonth[m].sort((a, b) => a - b);
    if (!vals.length) continue;
    const n = vals.length;
    const _q = p => { const pos = p * (n - 1), lo = Math.floor(pos); return vals[lo] + (vals[lo + 1] - vals[lo] || 0) * (pos - lo); };
    const Q1 = _q(0.25), Q2 = _q(0.5), Q3 = _q(0.75);
    const IQR = Q3 - Q1;
    const wLo = Math.max(vals[0], Q1 - 1.5 * IQR);
    const wHi = Math.min(vals[n - 1], Q3 + 1.5 * IQR);
    labels.push(MONTHS[m]);
    whiskerData.push([wLo, wHi]);
    boxData.push([Q1, Q3]);
    medianData.push(Q2);
  }

  _chart.data.labels = labels;
  _chart.data.datasets = [
    {
      label: 'Whiskers',
      data: whiskerData,
      backgroundColor: 'rgba(34,211,238,0.15)',
      borderColor: 'rgba(34,211,238,0.5)',
      borderWidth: 1,
      barPercentage: 0.12,
      categoryPercentage: 1.0,
      grouped: false,
    },
    {
      label: 'IQR (Q1\u2013Q3)',
      data: boxData,
      backgroundColor: 'rgba(34,211,238,0.25)',
      borderColor: 'rgba(34,211,238,0.75)',
      borderWidth: 1.5,
      barPercentage: 0.55,
      categoryPercentage: 1.0,
      grouped: false,
    },
    {
      label: 'Median',
      type: 'line',
      data: medianData,
      borderColor: 'rgba(251,191,36,0.9)',
      borderWidth: 0,
      pointRadius: 4,
      pointBackgroundColor: 'rgba(251,191,36,0.9)',
      pointBorderColor: 'rgba(251,191,36,0.9)',
      showLine: false,
    },
  ];
  _chart.options.scales.y.title.text = label;
  if (_titleEl) _titleEl.textContent = `Monthly Box Plot \u2014 ${label}`;
  _chart.update();
}

export function renderDiurnal(data, varKey) {
  if (!_chart || _chartType !== 'diurnal') return;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const sum = new Array(24).fill(0), cnt = new Array(24).fill(0), sq = new Array(24).fill(0);
  for (let i = 0; i < data.n; i++) {
    const ts = data.timestamps[i], v = data[varKey]?.[i];
    if (ts === null || v == null) continue;
    const h = new Date(ts).getUTCHours();
    sum[h] += v; sq[h] += v * v; cnt[h]++;
  }

  const meanPts = [], upperPts = [], lowerPts = [];
  for (let h = 0; h < 24; h++) {
    if (!cnt[h]) continue;
    const mean = sum[h] / cnt[h];
    const std  = Math.sqrt(Math.max(0, sq[h] / cnt[h] - mean * mean));
    meanPts.push({ x: h, y: mean });
    upperPts.push({ x: h, y: mean + std });
    lowerPts.push({ x: h, y: mean - std });
  }

  _chart.data.datasets = [
    {
      label: '\u00b11\u03c3 band',
      type: 'line', data: upperPts,
      borderColor: 'rgba(34,211,238,0.25)', borderWidth: 1, borderDash: [3, 3],
      pointRadius: 0, spanGaps: true,
      fill: { target: '+1', above: 'rgba(34,211,238,0.08)', below: 'rgba(34,211,238,0.08)' },
    },
    {
      label: null,
      type: 'line', data: lowerPts,
      borderColor: 'rgba(34,211,238,0.25)', borderWidth: 1, borderDash: [3, 3],
      pointRadius: 0, spanGaps: true, fill: false,
    },
    {
      label: 'Mean',
      type: 'line', data: meanPts,
      borderColor: 'rgba(34,211,238,0.9)', borderWidth: 2,
      pointRadius: 3, pointBackgroundColor: 'rgba(34,211,238,0.9)', spanGaps: true, fill: false,
    },
  ];
  _chart.options.scales.x.title.text = 'Hour of Day (UTC)';
  _chart.options.scales.y.title.text = label;
  if (_titleEl) _titleEl.textContent = `Diurnal Composite \u2014 ${label}`;
  _chart.update();
}

export function renderLatVar(data, varKey) {
  if (!_chart || _chartType !== 'latvar') return;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  const pts = [];
  for (let i = 0; i < data.n; i++) {
    const lat = data.lat?.[i], v = data[varKey]?.[i];
    if (lat == null || v == null) continue;
    pts.push({ x: lat, y: v });
  }

  _chart.data.datasets = [{
    label: label, data: pts,
    backgroundColor: 'rgba(34,211,238,0.35)', borderColor: 'rgba(34,211,238,0.75)',
    borderWidth: 1, pointRadius: 2, pointHoverRadius: 5,
  }];
  _chart.options.scales.x.title.text = 'Latitude (\u00b0N)';
  _chart.options.scales.y.title.text = label;
  if (_titleEl) _titleEl.textContent = `Latitude vs ${label}`;
  _chart.update();
}

export function renderHeatmap(data) {
  if (!_chart || _chartType !== 'heatmap') return;
  const n = HEATMAP_VARS.length;
  const arrays = HEATMAP_VARS.map(v => data[v.key] ?? []);
  const corr = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(_pearsonR(arrays[i], arrays[j]));
    corr.push(row);
  }
  _heatmapCorr = corr;
  _chart.data.datasets = [];
  if (_titleEl) _titleEl.textContent = 'Correlation Matrix';
  _chart.update();
}

export function setHighlight(idx) {
  if (_SCATTER_LIKE.has(_chartType)) {
    if (!_chart || !_scatterRevMap) return;
    if (idx !== null) {
      const loc = _scatterRevMap.get(idx);
      _chart.setActiveElements(loc !== undefined ? [{ datasetIndex: loc.ds, index: loc.idx }] : []);
    } else {
      _chart.setActiveElements([]);
    }
    _chart.update('none');
    return;
  }
  if (idx === _highlightIdx) return;
  _highlightIdx = idx;
  if (_chart) _chart.update('none');
}

export function downloadChart(filename = 'chart.png') {
  const canvas = document.getElementById(_canvasId);
  if (!canvas) return;
  // Composite chart onto a white-background offscreen canvas for clean PNG export
  const off = document.createElement('canvas');
  off.width  = canvas.width;
  off.height = canvas.height;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(canvas, 0, 0);
  const a = document.createElement('a');
  a.href     = off.toDataURL('image/png');
  a.download = filename;
  a.click();
}

export function openModal()   { if (_modalEl) _modalEl.classList.add('open'); }
export function closeModal()  { if (_modalEl) _modalEl.classList.remove('open'); }
export function toggleModal() { if (_modalEl) (_modalEl.classList.contains('open') ? closeModal : openModal)(); }
