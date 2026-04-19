// webapp/js/chart.js
import { VARIABLES } from './data.js';

let _chart        = null;
let _canvasId     = null;
let _modalEl      = null;
let _titleEl      = null;
let _chartType    = 'timeseries'; // 'timeseries' | 'scatter'
let _highlightIdx = null;
// _scatterIdxMap[ds][ptIdx] → data1 index  (ds 0 = normal, 1 = >50% diff)
let _scatterIdxMap = null;
// _scatterRevMap: data1 index → { ds, idx }
let _scatterRevMap = null;
let _onChartHoverCb  = null;
let _onChartClickCb  = null;
let _pinnedChartIdx  = null; // data1 index pinned by click, null if unpinned

// ── Helpers ────────────────────────────────────────────
function _linearRegression(pts) {
  const n = pts.length;
  if (n < 2) return { m: 1, b: 0, r2: null };
  // Use centered deviations — avoids catastrophic cancellation when R² ≈ 1
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
  // Pearson r² — same as R² for OLS, but numerically cleaner near 1.0
  const r2 = sy2 === 0 ? 1 : Math.min(1, (sxy * sxy) / (sx2 * sy2));
  return { m, b, r2 };
}

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
    if (_chartType === 'scatter') {
      const pts = chart.getElementsAtEventForMode(
        args.event.native, 'nearest', { intersect: true }, false
      );
      const pt = pts.find(p => p.datasetIndex === 0 || p.datasetIndex === 1);
      if (pt !== undefined && _scatterIdxMap) {
        _onChartHoverCb(_scatterIdxMap[pt.datasetIndex]?.[pt.index] ?? null);
      } else if (_pinnedChartIdx !== null) {
        // Mouse left a point but something is pinned — restore pinned highlight
        const loc = _scatterRevMap?.get(_pinnedChartIdx);
        chart.setActiveElements(loc ? [{ datasetIndex: loc.ds, index: loc.idx }] : []);
        chart.update('none');
        _onChartHoverCb(_pinnedChartIdx);
      } else {
        _onChartHoverCb(null);
      }
    } else {
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
          minute: 'MMM d HH:mm',
          hour:   'MMM d HH:mm',
          day:    'MMM d',
          week:   'MMM d',
          month:  'MMM yyyy',
        },
      },
      ticks: { ..._TICK, maxTicksLimit: 10 },
      grid: _GRID,
    },
    y: {
      ticks: _TICK, grid: _GRID, border: _BORDER,
      title: _TITLE(),
    },
  };
}

function _scatterScales() {
  return {
    x: {
      type: 'linear',
      ticks: _TICK, grid: _GRID, border: _BORDER,
      title: _TITLE('Run 1'),
    },
    y: {
      type: 'linear',
      ticks: _TICK, grid: _GRID, border: _BORDER,
      title: _TITLE('Run 2'),
    },
  };
}

// ── Chart creation ─────────────────────────────────────
function _buildChart() {
  const isScatter = _chartType === 'scatter';
  return new Chart(document.getElementById(_canvasId), {
    type: isScatter ? 'scatter' : 'line',
    data: { datasets: [] },
    options: {
      animation: false,
      spanGaps: !isScatter,
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: !isScatter,
      scales: isScatter ? _scatterScales() : _timeseriesScales(),
      onClick: (evt, elements) => {
        if (_chartType !== 'scatter') return;
        const el = elements.find(e => e.datasetIndex === 0 || e.datasetIndex === 1);
        if (el !== undefined && _scatterIdxMap) {
          const data1Idx = _scatterIdxMap[el.datasetIndex]?.[el.index];
          if (data1Idx != null) {
            if (_pinnedChartIdx === data1Idx) {
              // Click same point → unpin
              _pinnedChartIdx = null;
              if (_onChartClickCb) _onChartClickCb(null);
            } else {
              _pinnedChartIdx = data1Idx;
              if (_onChartClickCb) _onChartClickCb(data1Idx);
            }
            return;
          }
        }
        // Clicked empty space → unpin
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
          display: isScatter,
          labels: {
            color: '#d8e4f5',
            font: { family: 'Inter', size: 11 },
            boxWidth: 24,
            boxHeight: 3,
            padding: 14,
          },
        },
        tooltip: { enabled: false },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
          pan:  { enabled: true, mode: 'xy' },
        },
      },
    },
    plugins: [_verticalLinePlugin, _hoverSyncPlugin],
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
    borderColor: '#22d3ee',
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: '#22d3ee',
  }];
  _chart.options.scales.y.title.text = label;
  if (_titleEl) _titleEl.textContent = `Time Series — ${label}`;
  _highlightIdx = null;
  _chart.update();
}

export function renderScatter(data1, data2, varKey) {
  if (!_chart || _chartType !== 'scatter') return;
  _pinnedChartIdx = null;
  const varMeta = VARIABLES.find(v => v.key === varKey);
  const label   = varMeta ? varMeta.label : varKey;

  // Inner-join on timestamps
  const tsMap = new Map();
  for (let j = 0; j < data2.n; j++) {
    if (data2.timestamps[j] !== null) tsMap.set(data2.timestamps[j], j);
  }

  const normalPts = [], diffPts = [];
  const normalIdx = [], diffIdx = [];
  const revMap = new Map();

  for (let i = 0; i < data1.n; i++) {
    const ts = data1.timestamps[i];
    if (ts === null) continue;
    const j = tsMap.get(ts);
    if (j === undefined) continue;
    const x = data1[varKey]?.[i], y = data2[varKey]?.[j];
    if (x == null || y == null) continue;
    const maxAbs = Math.max(Math.abs(x), Math.abs(y));
    const isDiff = maxAbs > 1e-10 && Math.abs(x - y) / maxAbs > 0.5;
    if (isDiff) {
      revMap.set(i, { ds: 1, idx: diffPts.length });
      diffPts.push({ x, y });
      diffIdx.push(i);
    } else {
      revMap.set(i, { ds: 0, idx: normalPts.length });
      normalPts.push({ x, y });
      normalIdx.push(i);
    }
  }
  _scatterIdxMap = [normalIdx, diffIdx];
  _scatterRevMap = revMap;

  // All points for regression + bounds
  const allPts = [...normalPts, ...diffPts];
  let mn = Infinity, mx = -Infinity;
  for (const p of allPts) {
    if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x;
    if (p.y < mn) mn = p.y; if (p.y > mx) mx = p.y;
  }
  const diag = mn < Infinity ? [{ x: mn, y: mn }, { x: mx, y: mx }] : [];

  const { m, b, r2 } = _linearRegression(allPts);
  const r2Label = r2 !== null ? r2.toFixed(4) : '—';
  const fitLine = mn < Infinity
    ? [{ x: mn, y: m * mn + b }, { x: mx, y: m * mx + b }]
    : [];

  const _ptStyle = (bg, border) => ({
    type: 'scatter',
    backgroundColor: bg,
    borderColor:     border,
    borderWidth: 1,
    pointRadius: 3,
    pointHoverRadius: 7,
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 1.5,
  });

  _chart.data.datasets = [
    { label: 'All points',   data: normalPts, ..._ptStyle('rgba(34,211,238,0.35)', 'rgba(34,211,238,0.75)') },
    { label: '>50% diff',    data: diffPts,   ..._ptStyle('rgba(239,100,100,0.55)', 'rgba(239,100,100,0.85)'), pointHoverBackgroundColor: '#ef6464' },
    {
      label: '1:1 line',
      type: 'line',
      data: diag,
      borderColor: 'rgba(239,100,100,0.55)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
    },
    {
      label: `Fit (R²=${r2Label})`,
      type: 'line',
      data: fitLine,
      borderColor: 'rgba(255,255,255,0.80)',
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 0,
    },
  ];
  _chart.options.scales.x.title.text = `Run 1 — ${label}`;
  _chart.options.scales.y.title.text = `Run 2 — ${label}`;
  if (_titleEl) _titleEl.textContent = `Run 1 vs Run 2 — ${label}`;
  _chart.update();
}

export function setHighlight(idx) {
  if (_chartType === 'scatter') {
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

export function openModal()   { if (_modalEl) _modalEl.classList.add('open'); }
export function closeModal()  { if (_modalEl) _modalEl.classList.remove('open'); }
export function toggleModal() { if (_modalEl) (_modalEl.classList.contains('open') ? closeModal : openModal)(); }
