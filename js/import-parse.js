// import-parse.js — lectura de archivos de actividad: GPX 1.1, TCX y FIT (también dentro de .gz o .zip).
// PURO (sin DOM ni store): se prueba en Node (tests/unit/import.test.mjs). El XML se recorre con un lector
// mínimo propio (walkXml) en lugar de DOMParser, para usar el mismo código en Safari y en las pruebas.
//
// Cada parser devuelve una lista de «actividades leídas» (ParsedActivity):
//   { format:'gpx'|'tcx'|'fit', sport:'texto del archivo', subSport, name, startTime (ms|null),
//     points:[Point], totals:{ elapsedSec, timerSec, movingSec, distanceM, ascentM, descentM, altMaxM,
//     hrAvg, hrMax, cadence, powerAvg, powerNp, poolLengthM } (lo que traiga el archivo; puede ir vacío),
//     laps:[{ startT (ms|null), elapsedSec (tiempo total|null), timerSec (cronómetro|null), distanceM }] }
//     (vueltas FIT de la sesión; TCX con elapsedSec = inicio de la siguiente − inicio; GPX sin vueltas)
//   Point = { t (ms), lat, lon, ele (m), hr, cad, power, dist (m acumulados del dispositivo), speed (m/s) }
//   (los cortes entre <trkseg>/<Track> no se marcan: los huecos se tratan con la regla de huecos sin avance)
// summarize(parsed) las convierte en métricas (Summary), con la serie distancia–tiempo (`series`, best-efforts.js) y
// las vueltas para los parciales de las carreras. readActivityFile(nombre, bytes) hace todo el proceso.
import { ImportError, toU8, isGzip, isZip, gunzip, zipEntries, zipRead, baseName, isJunkEntry } from './import-zip.js';
import { buildSeries } from './best-efforts.js';

export { ImportError };

// ---------------------------------------------------------------------------
// Parámetros de cálculo
// ---------------------------------------------------------------------------
/** Por debajo de esta velocidad se considera parado (m/s). */
export const MOVING_MIN_SPEED = 0.5;
/** Un hueco entre puntos de más de estos segundos solo cuenta como movimiento si hubo avance. */
export const MAX_GAP_SEC = 30;
/** Ventana (± s) para estimar la velocidad en cada punto sin sumar el ruido del GPS. */
export const SPEED_WINDOW_SEC = 10;
/** Umbral de desnivel: los cambios de altitud menores no se suman (ruido del GPS). */
export const ELEV_THRESHOLD_M = 3;
/** Suavizado de la altitud: media de ± este número de puntos. */
export const ELEV_SMOOTH_POINTS = 2;

const fin = Number.isFinite;
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim());
  return fin(n) ? n : null;
};
const parseTime = (s) => {
  if (!s) return null;
  const t = Date.parse(String(s).trim());
  return fin(t) ? t : null;
};
const hasPos = (p) => fin(p.lat) && fin(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Distancia en metros entre dos puntos {lat, lon} (fórmula del haversine). */
export function haversine(a, b) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ---------------------------------------------------------------------------
// Texto y detección de formato
// ---------------------------------------------------------------------------
/** Decodifica texto (UTF-8 por defecto; UTF-16 si trae BOM). */
export function decodeText(input) {
  const u8 = toU8(input);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  return new TextDecoder('utf-8').decode(u8);
}

const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

const isFitAt = (u8, pos = 0) => u8.length >= pos + 12 && (u8[pos] === 12 || u8[pos] === 14)
  && u8[pos + 8] === 0x2e && u8[pos + 9] === 0x46 && u8[pos + 10] === 0x49 && u8[pos + 11] === 0x54; // «.FIT»

/**
 * Formato por el contenido (y, si no se reconoce, por la extensión).
 * @returns {'gzip'|'zip'|'fit'|'gpx'|'tcx'|null}
 */
export function detectFormat(input, name = '') {
  const u8 = toU8(input);
  if (isGzip(u8)) return 'gzip';
  if (isZip(u8)) return 'zip';
  if (isFitAt(u8)) return 'fit';
  const head = decodeText(u8.subarray(0, 4096)).toLowerCase();
  if (/<(\w+:)?gpx[\s>]/.test(head)) return 'gpx';
  if (/<(\w+:)?trainingcenterdatabase[\s>]/.test(head)) return 'tcx';
  const ext = extOf(name);
  if ((ext === 'gpx' || ext === 'tcx') && head.includes('<')) return ext;
  if (ext === 'fit' && u8.length >= 12) return 'fit';
  return null;
}

// ---------------------------------------------------------------------------
// Lector XML mínimo
// ---------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return fin(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const localName = (qname) => {
  const i = qname.indexOf(':');
  return (i >= 0 ? qname.slice(i + 1) : qname).toLowerCase();
};

const attrRe = new Map();
/** Valor de un atributo en el texto crudo de una etiqueta (sin distinguir mayúsculas ni prefijo). */
export function getAttr(raw, key) {
  let re = attrRe.get(key);
  if (!re) {
    re = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
    attrRe.set(key, re);
  }
  const m = re.exec(raw);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : null;
}

function tagEnd(xml, from) {
  let q = 0;
  for (let j = from; j < xml.length; j++) {
    const ch = xml.charCodeAt(j);
    if (q) { if (ch === q) q = 0; } else if (ch === 34 || ch === 39) q = ch;
    else if (ch === 62) return j;
  }
  return -1;
}

/**
 * Recorre un XML: onOpen(name, rawAttrs, stack) y onClose(name, text, stack).
 * name = nombre local en minúsculas (sin prefijo). text = texto directo del elemento (sin espacios a los lados).
 * stack = elementos abiertos que lo contienen (el último es el padre). Tolera cierres que no casan.
 */
export function walkXml(xml, { onOpen = () => {}, onClose = () => {} } = {}) {
  const stack = [];
  const texts = [];
  const n = xml.length;
  let i = 0;
  const close = () => {
    const name = stack.pop();
    const text = texts.pop();
    onClose(name, decodeEntities(text).trim(), stack);
  };
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && texts.length) texts[texts.length - 1] += xml.slice(i, lt);
    const c = xml.charCodeAt(lt + 1);
    if (c === 33) { // <!
      if (xml.startsWith('<!--', lt)) {
        const e = xml.indexOf('-->', lt + 4);
        i = e < 0 ? n : e + 3;
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const e = xml.indexOf(']]>', lt + 9);
        if (texts.length) texts[texts.length - 1] += xml.slice(lt + 9, e < 0 ? n : e).replace(/&/g, '&amp;');
        i = e < 0 ? n : e + 3;
      } else {
        const e = xml.indexOf('>', lt);
        i = e < 0 ? n : e + 1;
      }
      continue;
    }
    if (c === 63) { // <?
      const e = xml.indexOf('?>', lt);
      i = e < 0 ? n : e + 2;
      continue;
    }
    const gt = tagEnd(xml, lt + 1);
    if (gt < 0) break;
    i = gt + 1;
    if (c === 47) { // </
      const name = localName(xml.slice(lt + 2, gt).trim());
      const k = stack.lastIndexOf(name);
      if (k >= 0) while (stack.length > k) close();
      continue;
    }
    let body = xml.slice(lt + 1, gt);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const sp = body.search(/\s/);
    const name = localName(sp < 0 ? body : body.slice(0, sp));
    if (!name) continue;
    const raw = sp < 0 ? '' : body.slice(sp);
    onOpen(name, raw, stack);
    stack.push(name);
    texts.push('');
    if (selfClosing) close();
  }
  while (stack.length) close();
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------
/** GPX 1.0/1.1 (con extensiones Garmin TrackPointExtension: hr, cad; también power y speed). */
export function parseGPX(xml) {
  const points = [];
  const route = [];
  let cur = null;
  let trkName = '';
  let trkType = '';
  let metaName = '';
  let metaTime = null;
  walkXml(xml, {
    onOpen(name, raw) {
      if (name === 'trkpt' || name === 'rtept') {
        cur = { lat: num(getAttr(raw, 'lat')), lon: num(getAttr(raw, 'lon')) };
      }
    },
    onClose(name, text, stack) {
      if (cur) {
        if (name === 'trkpt') {
          points.push(cur);
          cur = null;
        } else if (name === 'rtept') {
          route.push(cur);
          cur = null;
        } else if (name === 'ele') cur.ele = num(text);
        else if (name === 'time') cur.t = parseTime(text);
        else if (name === 'hr' || name === 'heartrate') cur.hr = num(text);
        else if (name === 'cad' || name === 'cadence' || name === 'runcadence') cur.cad = num(text);
        else if (name === 'power' || name === 'watts') cur.power = num(text);
        else if (name === 'speed') cur.speed = num(text);
        return;
      }
      const parent = stack[stack.length - 1];
      if (name === 'name') {
        if (parent === 'trk' && !trkName) trkName = text;
        else if (parent === 'metadata' && !metaName) metaName = text;
      } else if (name === 'type' && parent === 'trk' && !trkType) {
        trkType = text;
      } else if (name === 'time' && parent === 'metadata') {
        metaTime = parseTime(text);
      }
    },
  });
  const pts = points.length ? points : route;
  if (!pts.length) throw new ImportError('El GPX no tiene puntos de recorrido.');
  const first = pts.find((p) => fin(p.t));
  return [{
    format: 'gpx', sport: trkType, subSport: '', name: trkName || metaName,
    startTime: first ? first.t : metaTime, points: pts, totals: {}, laps: [],
  }];
}

// ---------------------------------------------------------------------------
// TCX
// ---------------------------------------------------------------------------
/** TCX (Garmin Training Center): una actividad por <Activity>. */
export function parseTCX(xml) {
  const acts = [];
  let act = null;
  let lap = null;
  let cur = null;
  walkXml(xml, {
    onOpen(name, raw) {
      if (name === 'activity') {
        act = { sport: getAttr(raw, 'Sport') || '', id: null, notes: '', laps: [], points: [] };
      } else if (!act) {
        // fuera de una actividad (cursos, autor…)
      } else if (name === 'lap') {
        lap = { start: parseTime(getAttr(raw, 'StartTime')), time: null, dist: null, hrAvg: null, hrMax: null, lastT: null };
      } else if (name === 'trackpoint') {
        cur = {};
      }
    },
    onClose(name, text, stack) {
      if (!act) return;
      const parent = stack[stack.length - 1];
      const grand = stack[stack.length - 2];
      if (cur) {
        if (name === 'trackpoint') {
          act.points.push(cur);
          if (lap && fin(cur.t)) lap.lastT = cur.t;
          cur = null;
        } else if (name === 'time') cur.t = parseTime(text);
        else if (name === 'latitudedegrees') cur.lat = num(text);
        else if (name === 'longitudedegrees') cur.lon = num(text);
        else if (name === 'altitudemeters') cur.ele = num(text);
        else if (name === 'distancemeters') cur.dist = num(text);
        else if (name === 'value' && parent === 'heartratebpm') cur.hr = num(text);
        else if (name === 'cadence' || name === 'runcadence') cur.cad = num(text);
        else if (name === 'speed') cur.speed = num(text);
        else if (name === 'watts') cur.power = num(text);
        return;
      }
      if (lap) {
        if (name === 'lap') { act.laps.push(lap); lap = null; } else if (parent === 'lap' && name === 'totaltimeseconds') lap.time = num(text);
        else if (parent === 'lap' && name === 'distancemeters') lap.dist = num(text);
        else if (name === 'value' && grand === 'lap' && parent === 'averageheartratebpm') lap.hrAvg = num(text);
        else if (name === 'value' && grand === 'lap' && parent === 'maximumheartratebpm') lap.hrMax = num(text);
        return;
      }
      if (name === 'activity') { acts.push(act); act = null; } else if (name === 'id' && parent === 'activity') act.id = parseTime(text);
      else if (name === 'notes' && parent === 'activity') act.notes = text;
    },
  });
  const out = [];
  for (const a of acts) {
    if (!a.points.length && !a.laps.length) continue;
    const laps = a.laps;
    const timed = laps.filter((l) => l.time > 0);
    const timerSec = timed.length ? timed.reduce((s, l) => s + l.time, 0) : null;
    const distLaps = laps.filter((l) => l.dist > 0);
    const distanceM = distLaps.length ? distLaps.reduce((s, l) => s + l.dist, 0) : null;
    const hrLaps = laps.filter((l) => l.hrAvg > 0 && l.time > 0);
    const hrAvg = hrLaps.length ? hrLaps.reduce((s, l) => s + l.hrAvg * l.time, 0) / hrLaps.reduce((s, l) => s + l.time, 0) : null;
    const hrMaxes = laps.map((l) => l.hrMax).filter((v) => v > 0);
    const firstPt = a.points.find((p) => fin(p.t));
    // Tiempo total de cada vuelta: hasta el inicio de la siguiente; la última, hasta su último punto (o se desconoce).
    const lapList = laps.map((l, i) => {
      const next = laps[i + 1]?.start;
      const end = next != null ? next : l.lastT;
      return {
        startT: l.start,
        elapsedSec: fin(l.start) && fin(end) && end > l.start ? (end - l.start) / 1000 : null,
        timerSec: l.time > 0 ? l.time : null,
        distanceM: l.dist > 0 ? l.dist : null,
      };
    });
    out.push({
      format: 'tcx', sport: a.sport, subSport: '', name: a.notes,
      startTime: a.id ?? laps[0]?.start ?? firstPt?.t ?? null,
      points: a.points,
      totals: { timerSec, distanceM, hrAvg, hrMax: hrMaxes.length ? Math.max(...hrMaxes) : null },
      laps: lapList,
    });
  }
  if (!out.length) throw new ImportError('El TCX no tiene actividades.');
  return out;
}

// ---------------------------------------------------------------------------
// FIT (decodificador mínimo propio)
// ---------------------------------------------------------------------------
/** Segundos entre 1970-01-01 y el origen FIT (1989-12-31 00:00:00 UTC). */
export const FIT_EPOCH_S = 631065600;
const SEMICIRCLE = 180 / 2 ** 31;
/** Instante FIT → ms. Valores < 0x10000000 son relativos al dispositivo (sin hora real): null. */
const fitTime = (v) => (v == null || v < 0x10000000 ? null : (v + FIT_EPOCH_S) * 1000);
const fitAlt = (v) => (v == null ? null : v / 5 - 500);

/** Deportes FIT (enum sport) → texto que entiende sportToKind. */
export const FIT_SPORTS = {
  0: 'generic', 1: 'running', 2: 'cycling', 3: 'transition', 4: 'fitness_equipment', 5: 'swimming',
  6: 'basketball', 7: 'soccer', 8: 'tennis', 10: 'training', 11: 'walking', 12: 'cross_country_skiing',
  13: 'alpine_skiing', 15: 'rowing', 16: 'mountaineering', 17: 'hiking', 19: 'paddling', 21: 'e_biking',
  30: 'inline_skating', 31: 'rock_climbing', 35: 'snowshoeing', 37: 'rafting',
};
export const FIT_SUB_SPORTS = {
  1: 'treadmill', 2: 'street', 3: 'trail', 4: 'track', 5: 'spin', 6: 'indoor_cycling', 7: 'road', 8: 'mountain',
  11: 'cyclocross', 13: 'track_cycling', 17: 'lap_swimming', 18: 'open_water', 46: 'gravel_cycling', 58: 'virtual_activity',
};

/** Tamaño de cada tipo base (índice = número de tipo base, los 5 bits bajos). */
const BASE_SIZE = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];

function readBase(dv, off, base, little) {
  switch (base) {
    case 0: case 2: case 13: { const v = dv.getUint8(off); return v === 0xff ? null : v; }
    case 10: { const v = dv.getUint8(off); return v === 0 ? null : v; }
    case 1: { const v = dv.getInt8(off); return v === 0x7f ? null : v; }
    case 3: { const v = dv.getInt16(off, little); return v === 0x7fff ? null : v; }
    case 4: { const v = dv.getUint16(off, little); return v === 0xffff ? null : v; }
    case 11: { const v = dv.getUint16(off, little); return v === 0 ? null : v; }
    case 5: { const v = dv.getInt32(off, little); return v === 0x7fffffff ? null : v; }
    case 6: { const v = dv.getUint32(off, little); return v === 0xffffffff ? null : v; }
    case 12: { const v = dv.getUint32(off, little); return v === 0 ? null : v; }
    case 8: { const v = dv.getFloat32(off, little); return fin(v) ? v : null; }
    case 9: { const v = dv.getFloat64(off, little); return fin(v) ? v : null; }
    default: return null; // enteros de 64 bits: no se usan
  }
}

/** Campos que se leen de cada mensaje (número global → números de campo). El resto se salta. */
const FIT_WANT = {
  0: [0, 4], // file_id: type, time_created
  12: [0, 1, 3], // sport: sport, sub_sport, name
  18: [2, 5, 6, 7, 8, 9, 16, 17, 18, 20, 22, 23, 34, 44, 50, 59, 128], // session
  19: [2, 7, 8, 9, 25, 39], // lap
  20: [0, 1, 2, 3, 4, 5, 6, 7, 73, 78], // record
};
const FIT_LISTS = { 0: 'fileIds', 12: 'sports', 18: 'sessions', 19: 'laps', 20: 'records' };
const WANT_SETS = Object.fromEntries(Object.entries(FIT_WANT).map(([k, v]) => [k, new Set([...v, 253])]));
const utf8 = new TextDecoder('utf-8');

/** Decodifica los mensajes de un bloque FIT [p, end). Devuelve false si el bloque está dañado. */
function decodeFitBlock(u8, dv, p, end, out) {
  const defs = new Map();
  let lastTs = null;
  const readMsg = (def, at, compressedTs) => {
    const want = WANT_SETS[def.global];
    if (!want) {
      if (def.tsField) {
        const v = readBase(dv, at + def.tsField.off, 6, def.little);
        if (v != null) lastTs = v;
      }
      return;
    }
    const msg = {};
    for (const f of def.fields) {
      if (!want.has(f.num)) continue;
      let v = null;
      if (f.base === 7) {
        const bytes = u8.subarray(at + f.off, at + f.off + f.size);
        const z = bytes.indexOf(0);
        v = utf8.decode(z >= 0 ? bytes.subarray(0, z) : bytes) || null;
      } else if (f.size >= (BASE_SIZE[f.base] || 99)) {
        v = readBase(dv, at + f.off, f.base, def.little);
      }
      if (v == null) continue;
      msg[f.num] = v;
    }
    if (msg[253] != null) lastTs = msg[253];
    else if (compressedTs != null) msg[253] = compressedTs;
    out[FIT_LISTS[def.global]].push(msg);
  };
  while (p < end) {
    const hdr = u8[p++];
    if (hdr & 0x80) { // cabecera de marca de tiempo comprimida
      const def = defs.get((hdr >> 5) & 0x03);
      if (!def) return false;
      const offset = hdr & 0x1f;
      let ts = null;
      if (lastTs != null) {
        ts = lastTs - (lastTs % 32) + offset;
        if (offset < lastTs % 32) ts += 32;
        lastTs = ts;
      }
      if (p + def.size > end) return true;
      readMsg(def, p, ts);
      p += def.size;
    } else if (hdr & 0x40) { // definición
      if (p + 5 > end) return true;
      const little = u8[p + 1] === 0;
      const global = dv.getUint16(p + 2, little);
      const count = u8[p + 4];
      p += 5;
      const fields = [];
      let size = 0;
      let tsField = null;
      for (let k = 0; k < count; k++) {
        if (p + 3 > end) return true;
        const f = { num: u8[p], size: u8[p + 1], base: u8[p + 2] & 0x1f, off: size };
        if (f.num === 253 && f.size === 4) tsField = f;
        fields.push(f);
        size += f.size;
        p += 3;
      }
      if (hdr & 0x20) { // campos de desarrollador: solo se saltan
        const devCount = u8[p++];
        for (let k = 0; k < devCount; k++) { size += u8[p + 1]; p += 3; }
      }
      defs.set(hdr & 0x0f, { global, little, fields, size, tsField });
    } else { // datos
      const def = defs.get(hdr & 0x0f);
      if (!def) return false;
      if (p + def.size > end) return true;
      readMsg(def, p, null);
      p += def.size;
    }
  }
  return true;
}

/** FIT binario (actividades de Garmin, Wahoo, Coros, Suunto, Zwift…): una actividad por sesión. */
export function parseFIT(input) {
  const u8 = toU8(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = { fileIds: [], sports: [], sessions: [], laps: [], records: [] };
  let pos = 0;
  let blocks = 0;
  while (pos + 12 <= u8.length && isFitAt(u8, pos)) {
    const hsize = u8[pos];
    const dataSize = dv.getUint32(pos + 4, true);
    const ok = decodeFitBlock(u8, dv, pos + hsize, Math.min(u8.length, pos + hsize + dataSize), out);
    blocks++;
    if (!ok) break;
    pos += hsize + dataSize + 2; // + CRC; puede haber varios archivos encadenados
  }
  if (!blocks) throw new ImportError('El archivo FIT no es válido.');
  if (!out.records.length && !out.sessions.length && !out.laps.length) {
    throw new ImportError('El archivo FIT no tiene datos de actividad (¿es un archivo de ajustes o de salud?).');
  }
  return fitActivities(out);
}

function fitActivities(msgs) {
  const records = msgs.records.map((r) => {
    const pos = r[0] != null && r[1] != null && !(r[0] === 0 && r[1] === 0);
    const hr = r[3] > 0 ? r[3] : null;
    return {
      t: fitTime(r[253]),
      lat: pos ? r[0] * SEMICIRCLE : null,
      lon: pos ? r[1] * SEMICIRCLE : null,
      ele: fitAlt(r[78] ?? r[2] ?? null),
      hr,
      cad: r[4] ?? null,
      power: r[7] ?? null,
      dist: r[5] != null ? r[5] / 100 : null,
      speed: r[73] != null ? r[73] / 1000 : r[6] != null ? r[6] / 1000 : null,
    };
  });
  const sportMsg = msgs.sports[0] || {};
  const created = fitTime(msgs.fileIds[0]?.[4] ?? null);
  const sportText = (n) => (n == null ? '' : FIT_SPORTS[n] ?? `sport_${n}`);
  const firstT = (pts) => pts.find((p) => p.t != null)?.t ?? null;
  const sessions = msgs.sessions.filter((s) => s[5] !== 3); // sin transiciones de multideporte
  const lapOf = (l) => ({
    startT: fitTime(l[2] ?? null),
    elapsedSec: l[7] != null ? l[7] / 1000 : null,
    timerSec: l[8] != null ? l[8] / 1000 : null,
    distanceM: l[9] != null ? l[9] / 100 : null,
  });

  if (!sessions.length) {
    const laps = msgs.laps;
    const sum = (k, scale) => (laps.some((l) => l[k] != null) ? laps.reduce((s, l) => s + (l[k] ?? 0), 0) / scale : null);
    const sport = laps.find((l) => l[25] != null)?.[25] ?? sportMsg[0];
    const sub = laps.find((l) => l[39] != null)?.[39] ?? sportMsg[1];
    return [{
      format: 'fit', sport: sportText(sport), subSport: FIT_SUB_SPORTS[sub] || '', name: sportMsg[3] || '',
      startTime: fitTime(laps[0]?.[2] ?? null) ?? firstT(records) ?? created,
      points: records,
      totals: { elapsedSec: sum(7, 1000), timerSec: sum(8, 1000), distanceM: sum(9, 100) },
      laps: laps.map(lapOf),
    }];
  }

  return sessions.map((s) => {
    const start = fitTime(s[2] ?? null);
    const elapsedSec = s[7] != null ? s[7] / 1000 : null;
    const end = start != null && elapsedSec != null ? start + elapsedSec * 1000 : fitTime(s[253] ?? null);
    const pts = sessions.length === 1 || start == null || end == null
      ? records
      : records.filter((p) => p.t != null && p.t >= start - 1000 && p.t <= end + 1000);
    const laps = (sessions.length === 1 || start == null || end == null
      ? msgs.laps
      : msgs.laps.filter((l) => { const t = fitTime(l[2] ?? null); return t != null && t >= start - 1000 && t <= end + 1000; })).map(lapOf);
    return {
      format: 'fit',
      sport: sportText(s[5] ?? sportMsg[0]),
      subSport: FIT_SUB_SPORTS[s[6] ?? sportMsg[1]] || '',
      name: sportMsg[3] || '',
      startTime: start ?? firstT(pts) ?? created,
      points: pts,
      totals: {
        elapsedSec,
        timerSec: s[8] != null ? s[8] / 1000 : null,
        movingSec: s[59] != null ? s[59] / 1000 : null,
        distanceM: s[9] != null ? s[9] / 100 : null,
        hrAvg: s[16] > 0 ? s[16] : null,
        hrMax: s[17] > 0 ? s[17] : null,
        cadence: s[18] > 0 ? s[18] : null,
        powerAvg: s[20] ?? null,
        powerNp: s[34] ?? null,
        ascentM: s[22] ?? null,
        descentM: s[23] ?? null,
        altMaxM: fitAlt(s[128] ?? s[50] ?? null),
        poolLengthM: s[44] != null ? s[44] / 100 : null,
      },
      laps,
    };
  });
}

// ---------------------------------------------------------------------------
// Métricas a partir de los puntos
// ---------------------------------------------------------------------------
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
/** Máximo / mínimo sin «...» (las listas de puntos pueden tener decenas de miles de valores). */
const maxOf = (arr) => (arr.length ? arr.reduce((m, v) => (v > m ? v : m), -Infinity) : null);
const minOf = (arr) => (arr.length ? arr.reduce((m, v) => (v < m ? v : m), Infinity) : null);

/**
 * Desnivel positivo y negativo con suavizado (media de ± ELEV_SMOOTH_POINTS puntos) e histéresis
 * (ELEV_THRESHOLD_M): un cambio de sentido (subir ↔ bajar) solo cuenta cuando la altitud se aleja al menos el
 * umbral del último extremo; mientras se sigue en el mismo sentido se suma todo. Así el ruido del GPS no acumula
 * desnivel y una subida real cuenta entera (del valle a la cima).
 * @returns {{ascentM, descentM, altMaxM}}
 */
export function elevationStats(elevations, { threshold = ELEV_THRESHOLD_M, smooth = ELEV_SMOOTH_POINTS } = {}) {
  const alts = elevations.filter((v) => fin(v) && v > -500 && v < 9000);
  if (!alts.length) return { ascentM: null, descentM: null, altMaxM: null };
  const sm = alts.map((_, i) => {
    let s = 0;
    let k = 0;
    for (let j = Math.max(0, i - smooth); j <= Math.min(alts.length - 1, i + smooth); j++) { s += alts[j]; k++; }
    return s / k;
  });
  let ref = sm[0]; // último extremo contado
  let dir = 0; // 1 subiendo, -1 bajando, 0 aún sin sentido
  let up = 0;
  let down = 0;
  for (const a of sm) {
    const d = a - ref;
    if (d > 0 && (dir === 1 || d >= threshold)) { up += d; ref = a; dir = 1; } else if (d < 0 && (dir === -1 || -d >= threshold)) { down -= d; ref = a; dir = -1; }
  }
  return { ascentM: up, descentM: down, altMaxM: maxOf(sm) };
}

/**
 * Métricas calculadas con los puntos.
 * - Tiempo en movimiento: suma de los tramos entre puntos con velocidad ≥ MOVING_MIN_SPEED (la del dispositivo
 *   o, si no la trae, la media en una ventana de ± SPEED_WINDOW_SEC, con desplazamiento en línea recta para no
 *   sumar el zigzag del GPS parado); un hueco de más de MAX_GAP_SEC solo cuenta si hubo avance (≥ 0,5 m/s de
 *   media en el hueco).
 * - Distancia: la acumulada del dispositivo si la trae; si no, haversine de los tramos en movimiento.
 * @returns {{points, gpsPoints, startT, endT, elapsedSec, movingSec, distanceM, distanceSource, ascentM, descentM,
 *   altMaxM, hrAvg, hrMax, cadence, powerAvg, series}}
 */
export function pointMetrics(points = []) {
  const pts = (points || []).filter((p) => p && typeof p === 'object');
  const n = pts.length;
  const t = pts.map((p) => (fin(p.t) ? p.t / 1000 : NaN));
  const distN = pts.reduce((k, p) => k + (fin(p.dist) ? 1 : 0), 0);
  const gpsN = pts.reduce((k, p) => k + (hasPos(p) ? 1 : 0), 0);
  const useDist = distN >= 2 && distN >= gpsN / 2;
  const useGps = !useDist && gpsN >= 2;

  // Distancia de cada tramo (i-1 → i): NaN si no se sabe.
  const seg = new Float64Array(n).fill(NaN);
  let lastDist = null;
  let lastPos = null;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (useDist && fin(p.dist)) {
      if (lastDist != null) seg[i] = Math.max(0, p.dist - lastDist);
      lastDist = p.dist;
    } else if (useGps && hasPos(p)) {
      if (lastPos) seg[i] = haversine(lastPos, p);
      lastPos = p;
    }
  }

  // Tramos continuos (sin huecos largos) para la ventana de velocidad.
  const run = new Int32Array(n);
  for (let i = 1, r = 0; i < n; i++) {
    const dt = t[i] - t[i - 1];
    if (!(dt >= 0 && dt <= MAX_GAP_SEC)) r++;
    run[i] = r;
  }
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + (fin(seg[i]) ? seg[i] : 0);
  const speed = new Float64Array(n).fill(NaN);
  for (let i = 0, j1 = 0, j2 = 0; i < n; i++) {
    if (fin(pts[i].speed) && pts[i].speed >= 0) { speed[i] = pts[i].speed; continue; }
    if (!fin(t[i]) || (!useDist && !useGps)) continue;
    if (j1 > i || run[j1] !== run[i]) j1 = i;
    while (j1 < i && t[j1] < t[i] - SPEED_WINDOW_SEC) j1++;
    if (j2 < i || run[j2] !== run[i]) j2 = i;
    while (j2 + 1 < n && run[j2 + 1] === run[i] && t[j2 + 1] <= t[i] + SPEED_WINDOW_SEC) j2++;
    const dt = t[j2] - t[j1];
    if (!(dt > 0)) continue;
    if (useDist) speed[i] = (cum[j2] - cum[j1]) / dt;
    else if (hasPos(pts[j1]) && hasPos(pts[j2])) speed[i] = haversine(pts[j1], pts[j2]) / dt;
  }

  let movingSec = 0;
  let movingDist = 0;
  let allDist = 0;
  let known = 0;
  const moved = new Uint8Array(n); // tramo que entra en movingDist
  for (let i = 1; i < n; i++) {
    const s = seg[i];
    if (fin(s)) allDist += s;
    const dt = t[i] - t[i - 1];
    if (!(dt > 0)) continue;
    let v;
    if (dt > MAX_GAP_SEC) v = fin(s) ? s / dt : NaN;
    else v = fin(speed[i]) ? speed[i] : fin(s) ? s / dt : NaN;
    if (!fin(v)) continue;
    known++;
    if (v >= MOVING_MIN_SPEED) {
      movingSec += dt;
      if (fin(s)) { movingDist += s; moved[i] = 1; }
    }
  }

  const times = t.filter(fin);
  const startT = minOf(times);
  const endT = maxOf(times);
  const elapsedSec = times.length >= 2 ? Math.max(0, endT - startT) : null;
  let distanceM = null;
  let distanceSource = null;
  if (useDist) { distanceM = allDist; distanceSource = 'device'; } else if (useGps) { distanceM = known ? movingDist : allDist; distanceSource = 'gps'; }

  // Serie distancia–tiempo para los parciales (best-efforts.js), con la MISMA definición de distancia: la del
  // dispositivo o, con GPS, solo los tramos en movimiento. Así acaba en distanceM por construcción.
  let series = null;
  if (useDist || useGps) {
    const st = new Float64Array(n);
    const sd = new Float64Array(n);
    let k = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const s = seg[i];
      if (fin(s) && (useDist || !known || moved[i])) acc += s;
      if (useDist ? !fin(pts[i].dist) : !hasPos(pts[i])) continue;
      st[k] = t[i];
      sd[k] = acc;
      k++;
    }
    series = buildSeries({ t: st.subarray(0, k), d: sd.subarray(0, k), src: distanceSource });
  }

  const elev = elevationStats(pts.map((p) => p.ele));
  const hrs = pts.map((p) => p.hr).filter((v) => fin(v) && v > 0 && v < 255);
  const cads = pts.map((p) => p.cad).filter((v) => fin(v) && v > 0 && v < 255);
  const pows = pts.map((p) => p.power).filter((v) => fin(v) && v >= 0 && v < 3000);
  return {
    points: n,
    gpsPoints: gpsN,
    startT: startT != null ? startT * 1000 : null,
    endT: endT != null ? endT * 1000 : null,
    elapsedSec,
    movingSec: known ? movingSec : null,
    distanceM,
    distanceSource,
    ...elev,
    hrAvg: mean(hrs),
    hrMax: maxOf(hrs),
    cadence: mean(cads),
    powerAvg: pows.some((v) => v > 0) ? mean(pows) : null,
    series,
  };
}

const pos = (v) => (fin(v) && v > 0 ? v : null);

/**
 * Resumen de una actividad leída: prefiere los totales del propio archivo (sesión FIT, vueltas TCX) para
 * distancia, tiempo total, desnivel (altímetro del reloj), FC, cadencia y potencia; el tiempo en movimiento
 * sale de los puntos (si no se puede, el tiempo del cronómetro o el total).
 * @returns {{format, sport, subSport, name, startedAt, elapsedSec, timerSec, movingSec, distanceM, ascentM,
 *   descentM, altMaxM, hrAvg, hrMax, cadence, powerAvg, powerNp, poolLengthM, points, gpsPoints, hasTime,
 *   series (best-efforts.buildSeries | null), laps}}  series y laps solo viven en memoria: se guardan compactados
 *   (import-logic.itemRecord) y únicamente en carreras.
 */
export function summarize(parsed) {
  const m = pointMetrics(parsed.points || []);
  const T = parsed.totals || {};
  const timerSec = pos(T.timerSec);
  let elapsedSec = pos(T.elapsedSec) ?? pos(m.elapsedSec);
  // Sin total en el archivo, el tiempo total no puede ser menor que el del cronómetro (puntos escasos).
  if (timerSec != null && !pos(T.elapsedSec) && !(elapsedSec >= timerSec)) elapsedSec = timerSec;
  let movingSec = pos(m.movingSec) ?? pos(T.movingSec) ?? timerSec ?? elapsedSec;
  if (movingSec != null && elapsedSec != null && movingSec > elapsedSec) movingSec = elapsedSec;
  const startedAt = fin(parsed.startTime) ? parsed.startTime : m.startT;
  return {
    format: parsed.format,
    sport: parsed.sport || '',
    subSport: parsed.subSport || '',
    name: parsed.name || '',
    startedAt: fin(startedAt) ? startedAt : null,
    elapsedSec,
    timerSec,
    movingSec,
    distanceM: pos(T.distanceM) ?? pos(m.distanceM),
    ascentM: fin(T.ascentM) ? T.ascentM : m.ascentM,
    descentM: fin(T.descentM) ? T.descentM : m.descentM,
    altMaxM: fin(T.altMaxM) ? T.altMaxM : m.altMaxM,
    hrAvg: pos(T.hrAvg) ?? m.hrAvg,
    hrMax: pos(T.hrMax) ?? m.hrMax,
    cadence: pos(T.cadence) ?? m.cadence,
    powerAvg: pos(T.powerAvg) ?? m.powerAvg,
    powerNp: pos(T.powerNp),
    poolLengthM: pos(T.poolLengthM),
    points: m.points,
    gpsPoints: m.gpsPoints,
    hasTime: fin(startedAt),
    series: m.series,
    laps: Array.isArray(parsed.laps) ? parsed.laps : [],
  };
}

// ---------------------------------------------------------------------------
// Proceso completo de un archivo (con .gz y .zip)
// ---------------------------------------------------------------------------
const FORMAT_HELP = 'Usa archivos GPX, TCX o FIT (también dentro de un .gz o un .zip).';

/** Lee un GPX/TCX/FIT ya descomprimido → lista de ParsedActivity. */
export function parseActivityBytes(format, input) {
  if (format === 'fit') return parseFIT(input);
  const text = decodeText(input);
  if (format === 'gpx') return parseGPX(text);
  if (format === 'tcx') return parseTCX(text);
  throw new ImportError(`Formato no reconocido. ${FORMAT_HELP}`);
}

async function expand(name, label, srcName, u8, depth, out, inZip) {
  const format = detectFormat(u8, name);
  if (format === 'gzip') {
    if (depth > 3) return;
    let inner;
    try { inner = await gunzip(u8); } catch (err) { out.push({ label, fileName: srcName, error: errText(err) }); return; }
    await expand(name.replace(/\.gz$/i, ''), label, srcName, inner, depth + 1, out, inZip);
    return;
  }
  if (format === 'zip') {
    if (depth > 3) return;
    let entries;
    try { entries = zipEntries(u8).filter((e) => !isJunkEntry(e)); } catch (err) { out.push({ label, fileName: srcName, error: errText(err) }); return; }
    const before = out.length;
    for (const e of entries) {
      const base = baseName(e.name);
      const sub = `${label} › ${base}`;
      let bytes;
      try { bytes = await zipRead(u8, e); } catch (err) {
        if (/\.(gpx|tcx|fit)(\.gz)?$/i.test(base)) out.push({ label: sub, fileName: base, error: errText(err) });
        continue;
      }
      await expand(base, sub, base, bytes, depth + 1, out, true);
    }
    if (out.length === before) out.push({ label, fileName: srcName, error: `El .zip no contiene actividades. ${FORMAT_HELP}` });
    return;
  }
  if (!format) {
    if (!inZip) out.push({ label, fileName: srcName, error: `Formato no reconocido. ${FORMAT_HELP}` });
    return;
  }
  try {
    const acts = parseActivityBytes(format, u8);
    acts.forEach((a, i) => out.push({
      label: acts.length > 1 ? `${label} · ${i + 1} de ${acts.length}` : label,
      fileName: srcName,
      format,
      summary: summarize(a),
    }));
  } catch (err) {
    out.push({ label, fileName: srcName, error: errText(err, format) });
  }
}

function errText(err, format = '') {
  if (err instanceof ImportError) return err.message;
  const f = format ? format.toUpperCase() : 'archivo';
  return `No se pudo leer el ${f}: está dañado o incompleto.`;
}

/**
 * Lee un archivo elegido por el usuario (GPX, TCX, FIT, o esos mismos en .gz / .zip).
 * Nunca lanza: los problemas vuelven como entradas con `error`.
 * @returns {Promise<Array<{label, fileName, format, summary} | {label, fileName, error}>>}
 */
export async function readActivityFile(name, input) {
  const out = [];
  const fileName = String(name || 'archivo');
  try {
    await expand(fileName, fileName, fileName, toU8(input), 0, out, false);
  } catch (err) {
    out.push({ label: fileName, fileName, error: errText(err) });
  }
  return out;
}
