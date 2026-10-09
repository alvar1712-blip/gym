// builders.mjs — generadores de archivos de actividad para las pruebas de importación (Node).
// Los usan tests/unit/import.test.mjs y make-fixtures.mjs (que escribe los archivos de ejemplo de esta carpeta).
//   - Recorridos sintéticos deterministas (sin aleatoriedad real).
//   - GPX 1.1 con extensiones Garmin TrackPointExtension (hr, cad) y TCX con extensiones TPX (Watts).
//   - Escritor FIT mínimo: cabecera de 14 bytes con CRC, definiciones little/big endian, cabeceras de marca de
//     tiempo comprimida, campos de desarrollador y mensajes desconocidos (que el lector debe saltar).
//   - ZIP (entradas 'stored' y 'deflate') y gzip con zlib.
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Recorridos
// ---------------------------------------------------------------------------
/** Generador pseudoaleatorio determinista en [-1, 1]. */
export function noise(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * Recorrido por fases: [{ sec, speed (m/s), climb (m totales en la fase), hr, cad, power, jitter (m) }].
 * @returns {{ points: Point[], distanceM, movingSec, elapsedSec }}
 */
export function makeTrack({ start, stepSec = 10, lat = 40.4168, lon = -3.7038, ele = 650, heading = 45, phases, seed = 7 }) {
  const rnd = noise(seed);
  const points = [];
  const R = 111320;
  let t = start;
  let dist = 0;
  let movingSec = 0;
  const h = (heading * Math.PI) / 180;
  const push = (ph) => {
    const jit = ph.jitter || 0;
    const jLat = (rnd() * jit) / R;
    const jLon = (rnd() * jit) / (R * Math.cos((lat * Math.PI) / 180));
    points.push({
      t, lat: lat + jLat, lon: lon + jLon, ele: ele + rnd() * (ph.eleNoise ?? 1), dist, speed: ph.speed,
      hr: ph.hr != null ? Math.round(ph.hr + rnd() * 4) : null,
      cad: ph.cad != null ? Math.round(ph.cad + rnd()) : null,
      power: ph.power != null ? Math.round(ph.power + rnd() * 20) : null,
    });
  };
  push(phases[0]);
  for (const ph of phases) {
    const steps = Math.round(ph.sec / (ph.step || stepSec));
    const dt = ph.sec / steps;
    for (let k = 0; k < steps; k++) {
      const d = ph.speed * dt;
      lat += (d * Math.cos(h)) / R;
      lon += (d * Math.sin(h)) / (R * Math.cos((lat * Math.PI) / 180));
      ele += (ph.climb || 0) / steps;
      dist += d;
      t += dt * 1000;
      if (ph.speed >= 0.5) movingSec += dt;
      if (!ph.skip) push(ph);
    }
  }
  return { points, distanceM: dist, movingSec, elapsedSec: (t - start) / 1000 };
}

// ---------------------------------------------------------------------------
// GPX / TCX
// ---------------------------------------------------------------------------
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const f6 = (v) => v.toFixed(7);

export function gpxFromPoints(points, { type = 'running', name = 'Carrera', creator = 'Garmin Connect', extensions = true } = {}) {
  const pts = points.map((p) => {
    const ext = extensions && (p.hr != null || p.cad != null)
      ? `<extensions><ns3:TrackPointExtension>${p.hr != null ? `<ns3:hr>${p.hr}</ns3:hr>` : ''}${p.cad != null ? `<ns3:cad>${p.cad}</ns3:cad>` : ''}</ns3:TrackPointExtension></extensions>`
      : '';
    return `      <trkpt lat="${f6(p.lat)}" lon="${f6(p.lon)}"><ele>${p.ele.toFixed(1)}</ele><time>${iso(p.t)}</time>${ext}</trkpt>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="${creator}" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><link href="connect.garmin.com"><text>Garmin Connect</text></link><time>${iso(points[0].t)}</time></metadata>
  <trk>
    <name>${name}</name>
${type ? `    <type>${type}</type>\n` : ''}    <trkseg>
${pts.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
}

export function tcxFromPoints(points, { sport = 'Biking', laps = 2 } = {}) {
  const per = Math.ceil(points.length / laps);
  const lapXml = [];
  for (let l = 0; l < laps; l++) {
    const pts = points.slice(l * per, (l + 1) * per);
    if (!pts.length) continue;
    const prev = l > 0 ? points[l * per - 1] : pts[0];
    const time = (pts[pts.length - 1].t - prev.t) / 1000;
    const dist = pts[pts.length - 1].dist - prev.dist;
    const hrs = pts.map((p) => p.hr).filter((v) => v != null);
    const tp = pts.map((p) => `          <Trackpoint>
            <Time>${iso(p.t)}</Time>
            <Position><LatitudeDegrees>${f6(p.lat)}</LatitudeDegrees><LongitudeDegrees>${f6(p.lon)}</LongitudeDegrees></Position>
            <AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>
            <DistanceMeters>${p.dist.toFixed(1)}</DistanceMeters>
            ${p.hr != null ? `<HeartRateBpm><Value>${p.hr}</Value></HeartRateBpm>` : ''}
            ${p.cad != null ? `<Cadence>${p.cad}</Cadence>` : ''}
            <Extensions><ns3:TPX><ns3:Speed>${p.speed.toFixed(3)}</ns3:Speed>${p.power != null ? `<ns3:Watts>${p.power}</ns3:Watts>` : ''}</ns3:TPX></Extensions>
          </Trackpoint>`).join('\n');
    lapXml.push(`      <Lap StartTime="${iso(prev.t)}">
        <TotalTimeSeconds>${time.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${dist.toFixed(1)}</DistanceMeters>
        <Calories>300</Calories>
        <AverageHeartRateBpm><Value>${Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length)}</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>${Math.max(...hrs)}</Value></MaximumHeartRateBpm>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${tp}
        </Track>
      </Lap>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="${sport}">
      <Id>${iso(points[0].t)}</Id>
${lapXml.join('\n')}
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Edge 530</Name></Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

// ---------------------------------------------------------------------------
// FIT
// ---------------------------------------------------------------------------
export const FIT_EPOCH_S = 631065600;
export const fitTs = (ms) => Math.round(ms / 1000) - FIT_EPOCH_S;
export const semis = (deg) => Math.round((deg * 2 ** 31) / 180);

/** Tipos base FIT: [byte del tipo, tamaño, valor inválido]. */
export const T = {
  enum: [0x00, 1, 0xff], sint8: [0x01, 1, 0x7f], uint8: [0x02, 1, 0xff], sint16: [0x83, 2, 0x7fff],
  uint16: [0x84, 2, 0xffff], sint32: [0x85, 4, 0x7fffffff], uint32: [0x86, 4, 0xffffffff], string: [0x07, 1, 0],
  float32: [0x88, 4, null], uint8z: [0x0a, 1, 0], uint16z: [0x8b, 2, 0], uint32z: [0x8c, 4, 0], byte: [0x0d, 1, 0xff],
};

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
export function fitCrc(bytes, crc = 0) {
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

export class FitWriter {
  constructor() {
    this.bytes = [];
    this.defs = {};
  }

  /** fields: [[num, T.x, size?]]; devFields: [[num, size, devIndex]]. */
  define(local, global, fields, { bigEndian = false, devFields = [] } = {}) {
    const fs = fields.map(([num, type, size]) => ({ num, type, size: size || type[1] }));
    const out = [0x40 | (devFields.length ? 0x20 : 0) | local, 0, bigEndian ? 1 : 0];
    out.push(...(bigEndian ? [global >> 8, global & 0xff] : [global & 0xff, global >> 8]), fs.length);
    for (const f of fs) out.push(f.num, f.size, f.type[0]);
    if (devFields.length) {
      out.push(devFields.length);
      for (const d of devFields) out.push(...d);
    }
    this.bytes.push(...out);
    this.defs[local] = { fs, bigEndian, devSize: devFields.reduce((s, d) => s + d[1], 0) };
    return this;
  }

  /** values: { [num]: valor | null }. compressed: desfase (0–31) de una cabecera de marca de tiempo comprimida. */
  data(local, values, { compressed = null } = {}) {
    const def = this.defs[local];
    if (!def) throw new Error(`sin definición local ${local}`);
    this.bytes.push(compressed == null ? local : 0x80 | ((local & 3) << 5) | (compressed & 0x1f));
    for (const f of def.fs) this.bytes.push(...encode(f, values[f.num], def.bigEndian));
    for (let i = 0; i < def.devSize; i++) this.bytes.push(0x2a);
    return this;
  }

  raw(bytes) {
    this.bytes.push(...bytes);
    return this;
  }

  build() {
    const data = Uint8Array.from(this.bytes);
    const head = new Uint8Array(14);
    const dv = new DataView(head.buffer);
    head[0] = 14;
    head[1] = 0x20;
    dv.setUint16(2, 2132, true);
    dv.setUint32(4, data.length, true);
    head.set([0x2e, 0x46, 0x49, 0x54], 8);
    dv.setUint16(12, fitCrc(head.subarray(0, 12)), true);
    const out = new Uint8Array(14 + data.length + 2);
    out.set(head, 0);
    out.set(data, 14);
    new DataView(out.buffer).setUint16(14 + data.length, fitCrc(out.subarray(0, 14 + data.length)), true);
    return out;
  }
}

function encode(f, value, bigEndian) {
  const [code, size, invalid] = f.type;
  const buf = new Uint8Array(f.size);
  const dv = new DataView(buf.buffer);
  const le = !bigEndian;
  if (code === 0x07) {
    const b = new TextEncoder().encode(value || '');
    buf.set(b.subarray(0, f.size - 1));
    return buf;
  }
  const v = value == null ? invalid : value;
  if (code === 0x88) { dv.setFloat32(0, value == null ? NaN : value, le); return buf; }
  if (size === 1) dv.setUint8(0, v & 0xff);
  else if (size === 2) (code === 0x83 ? dv.setInt16(0, v, le) : dv.setUint16(0, v, le));
  else if (size === 4) (code === 0x85 ? dv.setInt32(0, v, le) : dv.setUint32(0, v >>> 0, le));
  for (let i = size; i < f.size; i++) buf[i] = 0xff; // resto del array: inválido
  return buf;
}

/**
 * FIT de actividad al estilo Garmin: file_id, device_info (desconocido), sport, event, records (con marcas de
 * tiempo comprimidas cuando el salto es < 32 s y campos de desarrollador), lap, session (big endian si se pide)
 * y activity.
 * laps: [{ start (ms), elapsedSec, timerSec, distanceM }] para escribir varias vueltas (por defecto una sola con
 * toda la actividad); records: false escribe solo vueltas y sesión (sin puntos). Sin puntos, start/end salen de las
 * vueltas.
 */
export function buildFitActivity({
  points, sport = 1, subSport = 0, name = '', session = {}, compressed = true, devFields = true, bigEndianSession = true,
  enhanced = true, created = null, laps = null, records = true,
}) {
  const w = new FitWriter();
  const lastLap = laps && laps.length ? laps[laps.length - 1] : null;
  const start = points.length ? points[0].t : laps[0].start;
  const end = points.length ? points[points.length - 1].t : lastLap.start + (lastLap.elapsedSec ?? lastLap.timerSec) * 1000;
  w.define(0, 0, [[0, T.enum], [1, T.uint16], [2, T.uint16], [3, T.uint32z], [4, T.uint32]]);
  w.data(0, { 0: 4, 1: 1, 2: 3121, 3: 123456789, 4: fitTs(created ?? start) });
  // device_info (23): mensaje que el lector no usa
  w.define(1, 23, [[253, T.uint32], [0, T.uint8], [2, T.uint16], [4, T.uint16]]);
  w.data(1, { 253: fitTs(start), 0: 0, 2: 1, 4: 3121 });
  w.define(2, 12, [[0, T.enum], [1, T.enum], [3, T.string, 16]]);
  w.data(2, { 0: sport, 1: subSport, 3: name });
  // event (21): arranque del cronómetro
  w.define(3, 21, [[253, T.uint32], [0, T.enum], [1, T.enum]]);
  w.data(3, { 253: fitTs(start), 0: 0, 1: 0 });
  const altF = enhanced ? [78, T.uint32] : [2, T.uint16];
  const spdF = enhanced ? [73, T.uint32] : [6, T.uint16];
  const recFields = [[0, T.sint32], [1, T.sint32], altF, [3, T.uint8], [4, T.uint8], [5, T.uint32], spdF, [7, T.uint16]];
  const dev = devFields ? { devFields: [[0, 2, 0]] } : {};
  w.define(4, 20, [[253, T.uint32], ...recFields], dev); // con marca de tiempo completa
  w.define(1, 20, recFields, dev); // para cabeceras comprimidas (local 0–3); sustituye a device_info
  let last = null;
  for (const p of records ? points : []) {
    const ts = fitTs(p.t);
    const vals = {
      253: ts, 0: p.lat != null ? semis(p.lat) : null, 1: p.lon != null ? semis(p.lon) : null,
      [altF[0]]: p.ele != null ? Math.round((p.ele + 500) * 5) : null,
      3: p.hr ?? null, 4: p.cad ?? null, 5: p.dist != null ? Math.round(p.dist * 100) : null,
      [spdF[0]]: p.speed != null ? Math.round(p.speed * 1000) : null, 7: p.power ?? null,
    };
    if (compressed && last != null && ts - last > 0 && ts - last < 32) w.data(1, vals, { compressed: ts & 0x1f });
    else w.data(4, vals);
    last = ts;
  }
  const s = {
    elapsedSec: (end - start) / 1000, timerSec: (end - start) / 1000,
    distanceM: points.length ? points[points.length - 1].dist ?? null : laps.reduce((a, l) => a + l.distanceM, 0),
    hrAvg: null, hrMax: null, cadence: null, powerAvg: null, ascent: null, descent: null, maxAltM: null, ...session,
  };
  w.define(5, 19, [[253, T.uint32], [2, T.uint32], [7, T.uint32], [8, T.uint32], [9, T.uint32], [25, T.enum]]);
  const lapList = laps || [{ start, elapsedSec: s.elapsedSec, timerSec: s.timerSec, distanceM: s.distanceM }];
  for (const l of lapList) {
    const lapEnd = l.start + (l.elapsedSec ?? l.timerSec ?? 0) * 1000;
    w.data(5, {
      253: fitTs(lapEnd), 2: fitTs(l.start), 7: l.elapsedSec != null ? Math.round(l.elapsedSec * 1000) : null,
      8: l.timerSec != null ? Math.round(l.timerSec * 1000) : null, 9: l.distanceM != null ? Math.round(l.distanceM * 100) : null, 25: sport,
    });
  }
  w.define(6, 18, [
    [253, T.uint32], [2, T.uint32], [5, T.enum], [6, T.enum], [7, T.uint32], [8, T.uint32], [9, T.uint32],
    [16, T.uint8], [17, T.uint8], [18, T.uint8], [20, T.uint16], [22, T.uint16], [23, T.uint16], [128, T.uint32], [44, T.uint16],
  ], { bigEndian: bigEndianSession });
  w.data(6, {
    253: fitTs(end), 2: fitTs(start), 5: sport, 6: subSport,
    7: Math.round(s.elapsedSec * 1000), 8: Math.round(s.timerSec * 1000),
    9: s.distanceM != null ? Math.round(s.distanceM * 100) : null,
    16: s.hrAvg, 17: s.hrMax, 18: s.cadence, 20: s.powerAvg, 22: s.ascent, 23: s.descent,
    128: s.maxAltM != null ? Math.round((s.maxAltM + 500) * 5) : null,
    44: s.poolLengthM != null ? Math.round(s.poolLengthM * 100) : null,
  });
  w.define(7, 34, [[253, T.uint32], [0, T.uint32], [1, T.uint16]]);
  w.data(7, { 253: fitTs(end), 0: Math.round(s.timerSec * 1000), 1: 1 });
  return w.build();
}

// ---------------------------------------------------------------------------
// ZIP y gzip
// ---------------------------------------------------------------------------
/** ZIP con entradas [{ name, data (Uint8Array|string), method: 0|8 }]. */
export function makeZip(entries) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const comp = method === 8 ? new Uint8Array(zlib.deflateRawSync(raw)) : raw;
    const name = enc.encode(e.name);
    const crc = zlib.crc32(raw) >>> 0;
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    local.push(lh, comp);
    central.push(ch);
    offset += lh.length + comp.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...local, ...central, eocd];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

export const gzip = (data) => new Uint8Array(zlib.gzipSync(typeof data === 'string' ? Buffer.from(data) : data));

// ---------------------------------------------------------------------------
// Actividades de ejemplo (las mismas en las pruebas unitarias, en los archivos de ejemplo y en la E2E)
// ---------------------------------------------------------------------------
/** Carrera: dom 20 sep 2026 08:00 (Madrid), 5 km en 25 min en movimiento + 2 min parado a mitad. */
export function sampleRun() {
  return makeTrack({
    start: Date.UTC(2026, 8, 20, 6, 0, 0), stepSec: 10, ele: 650, seed: 11,
    phases: [
      { sec: 750, speed: 10 / 3, climb: 30, hr: 150, cad: 85 },
      { sec: 120, speed: 0, climb: 0, hr: 120, cad: 0, jitter: 1.5 },
      { sec: 750, speed: 10 / 3, climb: -30, hr: 158, cad: 86 },
    ],
  });
}

/** Bici: lun 21 sep 2026 18:00 (Madrid), 20 km en 45 min, 2 vueltas. */
export function sampleRide({ stepSec = 15 } = {}) {
  return makeTrack({
    start: Date.UTC(2026, 8, 21, 16, 0, 0), stepSec, ele: 700, heading: 120, seed: 5,
    phases: [
      { sec: 1350, speed: 20000 / 2700, climb: 60, hr: 138, cad: 88, power: 200 },
      { sec: 1350, speed: 20000 / 2700, climb: -60, hr: 146, cad: 90, power: 210 },
    ],
  });
}

/**
 * Senderismo: sáb 19 sep 2026 10:00 (Madrid). Subida de 600 m en 90 min, 10 min parado en la cima (puntos cada
 * 20 s sin avance), 5 min sin puntos (pausa automática) y bajada en 75 min.
 */
export function sampleHike() {
  return makeTrack({
    start: Date.UTC(2026, 8, 19, 8, 0, 0), stepSec: 20, ele: 900, heading: 10, seed: 3,
    phases: [
      { sec: 5400, speed: 1.1, climb: 600, hr: 128, cad: 55 },
      { sec: 600, speed: 0, climb: 0, hr: 95, cad: 0, jitter: 1 },
      { sec: 300, speed: 0, climb: 0, skip: true, step: 300 },
      { sec: 4500, speed: 1.2, climb: -600, hr: 118, cad: 57 },
    ],
  });
}
