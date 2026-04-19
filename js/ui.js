// webapp/js/ui.js
import { fetchManifest, fetchData, VARIABLES } from './data.js';
import * as mapMod   from './map.js';
import * as chartMod from './chart.js';

let _manifest    = null;
let _currentData = null;
let _otherData   = null;
let _loadSeq     = 0;
let _run       = 'mars';
let _ship      = null;
let _year      = null;
let _res       = '1h';
let _varKey    = 'enthalpy_m';
let _chartType = 'timeseries';
let _startMonth = null;
let _startDay   = null;
let _endMonth   = null;
let _endDay     = null;

const _otherRun = () => _run === 'mars' ? 'yuc' : 'mars';

export async function init() {
  // Init map and chart
  mapMod.initMap('map');
  chartMod.initChart('chart-modal', 'chart-modal-backdrop', 'chart-canvas', 'chart-modal-title');

  // Cross-highlight wiring
  mapMod.onMarkerHover(idx => chartMod.setHighlight(idx));
  chartMod.onChartHover(idx => {
    if (idx !== null) mapMod.highlightIndex(idx);
    else              mapMod.resetHighlight();
  });
  chartMod.onChartClick(idx => {
    if (idx !== null) mapMod.zoomToIndex(idx);
    else mapMod.unpinMarker();
  });

  // Date range filters
  document.getElementById('filter-start-month').addEventListener('change', e => {
    _startMonth = e.target.value ? Number(e.target.value) : null;
    _startDay = null;
    document.getElementById('filter-start-day').value = '';
    if (_currentData) { _populateDaySelect('filter-start-day', _currentData, _startMonth); _renderAll(true); }
  });
  document.getElementById('filter-start-day').addEventListener('change', e => {
    _startDay = e.target.value ? Number(e.target.value) : null;
    if (_currentData) _renderAll(true);
  });
  document.getElementById('filter-end-month').addEventListener('change', e => {
    _endMonth = e.target.value ? Number(e.target.value) : null;
    _endDay = null;
    document.getElementById('filter-end-day').value = '';
    if (_currentData) { _populateDaySelect('filter-end-day', _currentData, _endMonth); _renderAll(true); }
  });
  document.getElementById('filter-end-day').addEventListener('change', e => {
    _endDay = e.target.value ? Number(e.target.value) : null;
    if (_currentData) _renderAll(true);
  });

  // Chart type selector
  document.getElementById('select-chart-type').addEventListener('change', async e => {
    _chartType = e.target.value;
    chartMod.setChartType(_chartType);
    if (_chartType === 'scatter' && !_otherData && _currentData) {
      await _loadOtherData();
    }
    _renderChart();
  });

  // Chart modal
  document.getElementById('btn-chart').addEventListener('click', () => chartMod.toggleModal());
  document.getElementById('chart-modal-close').addEventListener('click', () => chartMod.closeModal());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') chartMod.closeModal(); });

  // Error banner close
  document.getElementById('error-close').addEventListener('click', () => {
    document.getElementById('error-banner').style.display = 'none';
  });

  // Layer toggles
  document.getElementById('btn-markers').addEventListener('click', e => {
    e.currentTarget.classList.toggle('active');
    mapMod.setLayerVisible('markers', e.currentTarget.classList.contains('active'));
  });
  document.getElementById('btn-track').addEventListener('click', e => {
    e.currentTarget.classList.toggle('active');
    mapMod.setLayerVisible('polylines', e.currentTarget.classList.contains('active'));
  });

  // Run toggle
  document.querySelectorAll('#run-group [data-run]').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#run-group [data-run]').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      _run = e.currentTarget.dataset.run;
      _updateYearDropdown();
      _loadData(true);
    });
  });

  // Resolution buttons
  document.querySelectorAll('#res-group [data-res]').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#res-group [data-res]').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      _res = e.currentTarget.dataset.res;
      _loadData(true);
    });
  });

  // Variable dropdown — populate from VARIABLES
  const varSelect = document.getElementById('select-variable');
  VARIABLES.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.key;
    opt.textContent = v.label;
    varSelect.appendChild(opt);
  });
  varSelect.value = _varKey;
  varSelect.addEventListener('change', e => {
    _varKey = e.target.value;
    if (_currentData) _renderAll(true);
  });

  // Ship dropdown — populated after manifest loads
  document.getElementById('select-ship').addEventListener('change', e => {
    _ship = e.target.value;
    _updateYearDropdown();
    _loadData();
  });

  // Year dropdown
  document.getElementById('select-year').addEventListener('change', e => {
    _year = parseInt(e.target.value, 10);
    _loadData();
  });

  // Load manifest
  try {
    _manifest = await fetchManifest();
  } catch (e) {
    _showError('Failed to load manifest.json. Make sure the data files are in place.');
    return;
  }

  // Populate ship dropdown
  const shipSelect = document.getElementById('select-ship');
  const ships = Object.keys(_manifest.ships).sort();
  ships.forEach(ship => {
    const opt = document.createElement('option');
    opt.value = ship;
    opt.textContent = ship;
    shipSelect.appendChild(opt);
  });

  if (ships.length) {
    _ship = ships[0];
    shipSelect.value = _ship;
    _updateYearDropdown();
    await _loadData();
  }
}

function _updateYearDropdown() {
  const yearSelect = document.getElementById('select-year');
  yearSelect.innerHTML = '';
  const shipData = (_manifest?.ships[_ship]) || {};
  const years = ((shipData[_run] || []).slice()).map(Number).sort((a, b) => b - a); // descending
  years.forEach(year => {
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year;
    yearSelect.appendChild(opt);
  });
  if (years.includes(_year)) {
    yearSelect.value = _year;
  } else {
    _year = years[0] || null;
    if (_year) yearSelect.value = _year;
  }
}

async function _loadData(keepView = false) {
  if (!_ship || !_year) return;
  _hideError();
  _setLoading(true);
  const seq = ++_loadSeq;
  try {
    const data = await fetchData(_run, _ship, _year, _res);
    if (seq !== _loadSeq) return;
    _currentData = data;
    if (_chartType === 'scatter') {
      try { _otherData = await fetchData(_otherRun(), _ship, _year, _res); }
      catch { _otherData = null; }
      if (seq !== _loadSeq) return;
    } else {
      _otherData = null;
    }
    const saved = keepView
      ? { sm: _startMonth, sd: _startDay, em: _endMonth, ed: _endDay }
      : null;
    _startMonth = null; _startDay = null; _endMonth = null; _endDay = null;
    _populateMonthSelects(data);
    _populateDaySelect('filter-start-day', data, null);
    _populateDaySelect('filter-end-day', data, null);
    if (saved) {
      _tryRestoreFilter('filter-start-month', saved.sm, v => { _startMonth = v; });
      if (_startMonth) {
        _populateDaySelect('filter-start-day', data, _startMonth);
        _tryRestoreFilter('filter-start-day', saved.sd, v => { _startDay = v; });
      }
      _tryRestoreFilter('filter-end-month', saved.em, v => { _endMonth = v; });
      if (_endMonth) {
        _populateDaySelect('filter-end-day', data, _endMonth);
        _tryRestoreFilter('filter-end-day', saved.ed, v => { _endDay = v; });
      }
    }
    _renderAll(keepView);
  } catch (e) {
    if (seq !== _loadSeq) return;
    const msg = (e instanceof TypeError) ? 'Network error — check your connection.' : e.message;
    _showError(msg);
    _currentData = null;
  } finally {
    if (seq === _loadSeq) _setLoading(false);
  }
}

function _tryRestoreFilter(selectId, value, setter) {
  if (value === null) return;
  const sel = document.getElementById(selectId);
  if ([...sel.options].some(o => Number(o.value) === value)) {
    sel.value = value;
    setter(value);
  }
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _populateMonthSelects(data) {
  const months = new Set();
  for (const ts of data.timestamps) {
    if (ts !== null) months.add(new Date(ts).getUTCMonth() + 1);
  }
  for (const id of ['filter-start-month', 'filter-end-month']) {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">—</option>';
    for (let m = 1; m <= 12; m++) {
      if (!months.has(m)) continue;
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = MONTH_NAMES[m - 1];
      sel.appendChild(opt);
    }
    sel.value = '';
  }
  _startMonth = null; _endMonth = null;
}

function _populateDaySelect(selectId, data, month) {
  const days = new Set();
  for (const ts of data.timestamps) {
    if (ts === null) continue;
    const d = new Date(ts);
    if (month === null || d.getUTCMonth() + 1 === month) days.add(d.getUTCDate());
  }
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">—</option>';
  for (let d = 1; d <= 31; d++) {
    if (!days.has(d)) continue;
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  }
  sel.value = '';
}

function _applyFilter(data) {
  if (!data || (!_startMonth && !_startDay && !_endMonth && !_endDay)) return data;
  // Build start/end ms boundaries from selected year + month + day
  let startMs = -Infinity, endMs = Infinity;
  if (_startMonth) {
    const day = _startDay || 1;
    startMs = Date.UTC(_year, _startMonth - 1, day, 0, 0, 0, 0);
  }
  if (_endMonth) {
    const day = _endDay || new Date(Date.UTC(_year, _endMonth, 0)).getUTCDate();
    endMs = Date.UTC(_year, _endMonth - 1, day, 23, 59, 59, 999);
  }
  const indices = [];
  for (let i = 0; i < data.n; i++) {
    const ts = data.timestamps[i];
    if (ts === null) continue;
    if (ts >= startMs && ts <= endMs) indices.push(i);
  }
  if (indices.length === data.n) return data;
  const keys = ['time','lat','lon','timestamps',
    'hfss_m','hfss_s','hfls_m','hfls_s','tau_m','tau_s',
    'dmo','T_s','TS_s','RH_s','P_s','SPD_s','enthalpy_m','enthalpy_s'];
  const out = { n: indices.length, t0: data.t0 };
  for (const k of keys) {
    if (Array.isArray(data[k])) out[k] = indices.map(i => data[k][i]);
  }
  return out;
}

async function _loadOtherData() {
  try { _otherData = await fetchData(_otherRun(), _ship, _year, _res); }
  catch { _otherData = null; }
}

function _renderChart() {
  if (!_currentData) return;
  const f1 = _applyFilter(_currentData);
  if (_chartType === 'scatter') {
    if (_otherData) chartMod.renderScatter(f1, _applyFilter(_otherData), _varKey);
  } else {
    chartMod.render(f1, _varKey);
  }
}

function _renderAll(keepView = false) {
  const filtered = _applyFilter(_currentData);
  mapMod.render(filtered, _varKey, keepView);
  _renderChart();
}

function _setLoading(on) {
  document.getElementById('map-loading').classList.toggle('hidden', !on);
}

function _showError(msg) {
  document.getElementById('error-text').textContent = msg;
  document.getElementById('error-banner').style.display = 'flex';
}

function _hideError() {
  document.getElementById('error-banner').style.display = 'none';
}
