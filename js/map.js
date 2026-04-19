// webapp/js/map.js
import { VARIABLES } from './data.js';

const VIRIDIS = [
  [68,  1,  84], [72, 40, 120], [62, 74, 137], [49, 104, 142],
  [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206,  88],
  [181, 222,  43], [253, 231,  37],
];

function _viridisColor(t) {
  t = Math.max(0, Math.min(1, t));
  const pos = t * (VIRIDIS.length - 1);
  const lo  = Math.floor(pos);
  const hi  = Math.min(lo + 1, VIRIDIS.length - 1);
  const f   = pos - lo;
  const r   = Math.round(VIRIDIS[lo][0] + f * (VIRIDIS[hi][0] - VIRIDIS[lo][0]));
  const g   = Math.round(VIRIDIS[lo][1] + f * (VIRIDIS[hi][1] - VIRIDIS[lo][1]));
  const b   = Math.round(VIRIDIS[lo][2] + f * (VIRIDIS[hi][2] - VIRIDIS[lo][2]));
  return `rgb(${r},${g},${b})`;
}

function _percentile(sorted, p) {
  const idx = p * (sorted.length - 1);
  const lo  = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function _formatTs(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function _formatVal(v) {
  if (v === null || v === undefined) return '—';
  return Number(v.toPrecision(6)).toString();
}

let _map, _markerLayer, _polylineLayer;
let _markers = [];
let _markersVisible = true, _polylinesVisible = true;
let _onHoverCb = null;
let _tooltipEl = null;
let _pinnedIdx = null;
let _data = null;

const _TT_SECTIONS = [
  {
    label: 'Location',
    rows: [
      { label: 'Latitude',  fn: (d,i) => _formatVal(d.lat[i]), coord: true },
      { label: 'Longitude', fn: (d,i) => _formatVal(d.lon[i]), coord: true },
    ],
  },
  {
    label: 'Atmospheric Conditions',
    rows: [
      { label: 'Enthalpy Flux Mean', key: 'enthalpy_m' },
      { label: 'Sensible Heat Mean', key: 'hfss_m' },
      { label: 'Latent Heat Mean',   key: 'hfls_m' },
      { label: 'Wind Stress Mean',   key: 'tau_m' },
      { label: 'DMO',                key: 'dmo' },
    ],
  },
  {
    label: 'Standard Deviations',
    rows: [
      { label: 'Enthalpy Flux',  key: 'enthalpy_s' },
      { label: 'Sensible Heat',  key: 'hfss_s' },
      { label: 'Latent Heat',    key: 'hfls_s' },
      { label: 'Wind Stress',    key: 'tau_s' },
      { label: 'Air Temp',       key: 'T_s' },
      { label: 'Sea Temp',       key: 'TS_s' },
      { label: 'Humidity',       key: 'RH_s' },
      { label: 'Pressure',       key: 'P_s' },
      { label: 'Wind Speed',     key: 'SPD_s' },
    ],
  },
];

function _showTooltip(data, idx) {
  if (!_tooltipEl) return;
  let body = '';
  for (const section of _TT_SECTIONS) {
    body += `<tr class="tt-section"><td colspan="2">${section.label}</td></tr>`;
    for (const row of section.rows) {
      const val = row.fn ? row.fn(data, idx) : _formatVal(data[row.key]?.[idx]);
      const cls = row.coord ? 'tt-value tt-coord' : 'tt-value';
      body += `<tr><td class="tt-label">${row.label}</td><td class="${cls}">${val}</td></tr>`;
    }
  }
  _tooltipEl.innerHTML =
    `<div class="tt-head">${_formatTs(data.timestamps[idx])}</div>` +
    `<div class="tt-body"><table class="tt">${body}</table></div>`;
  _tooltipEl.classList.remove('hidden');
}

function _hideTooltip() {
  if (!_tooltipEl) return;
  _tooltipEl.classList.add('hidden');
  _tooltipEl.classList.remove('pinned');
}

function _baseRadius() {
  // Scale linearly: 2.5px at zoom ≤4, 5px at zoom ≥8
  const zoom = _map ? _map.getZoom() : 8;
  return Math.max(2.5, Math.min(5, 2.5 + (zoom - 4) * (2.5 / 4)));
}

export function initMap(containerId) {
  if (_map) return;
  _tooltipEl = document.getElementById('map-tooltip');
  _map = L.map(containerId, { preferCanvas: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(_map);
  _markerLayer   = L.layerGroup().addTo(_map);
  _polylineLayer = L.layerGroup().addTo(_map);
  _map.on('zoomend', () => {
    const r = _baseRadius();
    _markers.forEach(m => { if (m) m.setRadius(r); });
    if (_pinnedIdx !== null) highlightIndex(_pinnedIdx);
  });
  _map.on('click', () => {
    if (_pinnedIdx !== null) {
      _pinnedIdx = null;
      _hideTooltip();
      resetHighlight();
      if (_onHoverCb) _onHoverCb(null);
    }
  });
}

export function onMarkerHover(cb) { _onHoverCb = cb; }

export function render(data, varKey, keepView = false) {
  _data = data;
  _markerLayer.clearLayers();
  _polylineLayer.clearLayers();
  _markers = [];

  const values   = data[varKey];
  const nonNull  = values.filter(v => v !== null);
  let vmin = 0, vmax = 1;
  if (nonNull.length) {
    const sorted = nonNull.slice().sort((a, b) => a - b);
    vmin = _percentile(sorted, 0.02);
    vmax = _percentile(sorted, 0.98);
  }
  const range = vmax - vmin || 1;
  const norm  = v => (v === null) ? null : Math.max(0, Math.min(1, (v - vmin) / range));
  const color = t => (t === null) ? '#888' : _viridisColor(t);
  const normLon  = lon => (lon === null) ? null : (lon > 180 ? lon - 360 : lon);

  // Draw polyline segments (skip if too many points for performance)
  if (data.n <= 100000) {
    for (let i = 0; i < data.n - 1; i++) {
      const lat0 = data.lat[i],   lon0 = normLon(data.lon[i]);
      const lat1 = data.lat[i+1], lon1 = normLon(data.lon[i+1]);
      if (lat0 === null || lon0 === null || lat1 === null || lon1 === null) continue;
      if (Math.abs(lon1 - lon0) > 180) continue; // antimeridian crossing — skip
      const t0 = norm(values[i]), t1 = norm(values[i + 1]);
      const avgT = (t0 !== null && t1 !== null) ? (t0 + t1) / 2 : null;
      L.polyline([[lat0, lon0], [lat1, lon1]], {
        color: color(avgT), weight: 2, opacity: 0.75,
      }).addTo(_polylineLayer);
    }
  } else {
    console.info(`[map] Skipping polyline for n=${data.n} (>100k points). Switch to coarser resolution.`);
  }

  // Draw circle markers
  _pinnedIdx = null;
  _hideTooltip();
  const validBounds = [];
  for (let i = 0; i < data.n; i++) {
    const lat = data.lat[i], lon = normLon(data.lon[i]);
    if (lat === null || lon === null) { _markers.push(null); continue; }

    const t = norm(values[i]);
    const m = L.circleMarker([lat, lon], {
      radius: _baseRadius(),
      fillColor: color(t),
      color: 'transparent',
      weight: 0,
      fillOpacity: 1.0,
      opacity: 1.0,
    });

    const idx = i;
    m.on('mouseover', () => {
      _showTooltip(data, idx);
      highlightIndex(idx);
    });
    m.on('mouseout', () => {
      if (_pinnedIdx !== null) {
        _showTooltip(data, _pinnedIdx);
        highlightIndex(_pinnedIdx);
        if (_onHoverCb) _onHoverCb(_pinnedIdx);
      } else {
        _hideTooltip();
        resetHighlight();
        if (_onHoverCb) _onHoverCb(null);
      }
    });
    m.on('click', e => {
      L.DomEvent.stopPropagation(e);
      if (_pinnedIdx === idx) {
        _pinnedIdx = null;
        _tooltipEl.classList.remove('pinned');
      } else {
        _pinnedIdx = idx;
        _showTooltip(data, idx);
        highlightIndex(idx);
        _tooltipEl.classList.add('pinned');
        if (_onHoverCb) _onHoverCb(idx);
      }
    });
    _markers.push(m);
    _markerLayer.addLayer(m);
    validBounds.push([lat, lon]);
  }

  if (!_markersVisible)   _map.removeLayer(_markerLayer);
  if (!_polylinesVisible) _map.removeLayer(_polylineLayer);

  if (!keepView && validBounds.length) _map.fitBounds(validBounds, { padding: [20, 20] });
}

export function setLayerVisible(layer, visible) {
  if (layer === 'markers') {
    _markersVisible = visible;
    visible ? _markerLayer.addTo(_map) : _map.removeLayer(_markerLayer);
  } else {
    _polylinesVisible = visible;
    visible ? _polylineLayer.addTo(_map) : _map.removeLayer(_polylineLayer);
  }
}

export function highlightIndex(i) {
  const r = _baseRadius();
  _markers.forEach((m, j) => {
    if (!m) return;
    if (j === i) {
      m.setRadius(r * 1.8);
      m.setStyle({ fillOpacity: 1.0, opacity: 1.0, color: 'rgba(255,255,255,0.9)', weight: 2 });
    } else {
      m.setRadius(r);
      m.setStyle({ fillOpacity: 0.2, opacity: 0.2, color: 'transparent', weight: 0 });
    }
  });
}

export function unpinMarker() {
  if (_pinnedIdx === null) return;
  _pinnedIdx = null;
  _hideTooltip();
  resetHighlight();
  if (_onHoverCb) _onHoverCb(null);
}

export function zoomToIndex(idx) {
  const m = _markers[idx];
  if (!m || !_data) return;
  const latlng = m.getLatLng();
  const targetZoom = Math.max(_map.getZoom(), 8);
  // Offset center southward so marker appears in upper ~25% of map,
  // clear of the chart modal that covers the bottom half.
  const mapH   = _map.getSize().y;
  const chartH  = window.innerHeight * 0.5;
  const visibleH = mapH - chartH;
  const offsetPx = mapH / 2 - visibleH * 0.25;
  const markerPt   = _map.project(latlng, targetZoom);
  const adjustedPt = markerPt.add([0, offsetPx]);
  const center     = _map.unproject(adjustedPt, targetZoom);
  _map.flyTo(center, targetZoom, { duration: 0.8 });
  _pinnedIdx = idx;
  _showTooltip(_data, idx);
  highlightIndex(idx);
  _tooltipEl.classList.add('pinned');
  if (_onHoverCb) _onHoverCb(idx);
}

export function resetHighlight() {
  const r = _baseRadius();
  _markers.forEach(m => {
    if (!m) return;
    m.setRadius(r);
    m.setStyle({ fillOpacity: 1.0, opacity: 1.0, color: 'transparent', weight: 0 });
  });
}
