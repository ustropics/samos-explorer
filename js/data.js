// webapp/js/data.js

export const RUNS = { 'Run 1': 'mars', 'Run 2': 'yuc' };

export const RESOLUTIONS = ['1d', '1h', '30m', '10m', '1min'];

export const VARIABLES = [
  { key: 'enthalpy_m', label: 'Enthalpy Flux Mean' },
  { key: 'enthalpy_s', label: 'Enthalpy Flux Stdv' },
  { key: 'hfss_m',    label: 'Sensible Heat Mean' },
  { key: 'hfss_s',    label: 'Sensible Heat Stdv' },
  { key: 'hfls_m',    label: 'Latent Heat Mean' },
  { key: 'hfls_s',    label: 'Latent Heat Stdv' },
  { key: 'tau_m',     label: 'Wind Stress Mean' },
  { key: 'tau_s',     label: 'Wind Stress Stdv' },
  { key: 'dmo',       label: 'DMO' },
  { key: 'T_s',       label: 'Air Temp Stdv' },
  { key: 'TS_s',      label: 'Sea Temp Stdv' },
  { key: 'RH_s',      label: 'Humidity Stdv' },
  { key: 'P_s',       label: 'Pressure Stdv' },
  { key: 'SPD_s',     label: 'Wind Speed Stdv' },
];

const R2_BASE_URL = 'https://pub-889e6578da3a46b0a63deecd0b051bdf.r2.dev';

export async function fetchManifest() {
  const resp = await fetch(`${R2_BASE_URL}/manifest.json`);
  if (!resp.ok) throw new Error(`Failed to load manifest (${resp.status})`);
  return resp.json();
}

export async function fetchData(run, ship, year, resolution) {
  const path = `${R2_BASE_URL}/${run}/${ship}/${ship}_${year}_${resolution}.json`;
  const resp = await fetch(path);
  if (!resp.ok) {
    const runLabel = Object.keys(RUNS).find(k => RUNS[k] === run) ?? run;
    throw new Error(`No data for ${ship} ${year} (${runLabel})`);
  }
  const raw = await resp.json();
  return _processData(raw);
}

function _nullArr(n) { return new Array(n).fill(null); }

function _processData(raw) {
  const n = raw.n;
  const t0 = raw.t0;

  if (!Array.isArray(raw.time) || raw.time.length !== n) {
    throw new Error(`Data integrity error: n=${n} but time has ${raw.time?.length ?? 0} entries`);
  }

  const timestamps = raw.time.map(offset => (t0 + offset) * 1000);

  const hfss_m = Array.isArray(raw.hfss_m) ? raw.hfss_m : _nullArr(n);
  const hfls_m = Array.isArray(raw.hfls_m) ? raw.hfls_m : _nullArr(n);
  const hfss_s = Array.isArray(raw.hfss_s) ? raw.hfss_s : _nullArr(n);
  const hfls_s = Array.isArray(raw.hfls_s) ? raw.hfls_s : _nullArr(n);

  const enthalpy_m = hfss_m.map((v, i) =>
    (v === null || hfls_m[i] === null) ? null : v + hfls_m[i]
  );
  const enthalpy_s = hfss_s.map((v, i) =>
    (v === null || hfls_s[i] === null) ? null : Math.sqrt(v * v + hfls_s[i] * hfls_s[i])
  );

  return {
    n,
    timestamps,
    lat:    Array.isArray(raw.lat)    ? raw.lat    : _nullArr(n),
    lon:    Array.isArray(raw.lon)    ? raw.lon    : _nullArr(n),
    enthalpy_m,
    enthalpy_s,
    hfss_m,
    hfss_s,
    hfls_m,
    hfls_s,
    tau_m:  Array.isArray(raw.tau_m)  ? raw.tau_m  : _nullArr(n),
    tau_s:  Array.isArray(raw.tau_s)  ? raw.tau_s  : _nullArr(n),
    dmo:    Array.isArray(raw.dmo)    ? raw.dmo    : _nullArr(n),
    T_s:    Array.isArray(raw.T_s)    ? raw.T_s    : _nullArr(n),
    TS_s:   Array.isArray(raw.TS_s)   ? raw.TS_s   : _nullArr(n),
    RH_s:   Array.isArray(raw.RH_s)   ? raw.RH_s   : _nullArr(n),
    P_s:    Array.isArray(raw.P_s)    ? raw.P_s    : _nullArr(n),
    SPD_s:  Array.isArray(raw.SPD_s)  ? raw.SPD_s  : _nullArr(n),
  };
}