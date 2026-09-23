// activity-logic.js — lógica PURA del módulo de actividades (carrera, bici, natación, otras)
// y del peso corporal. Sin DOM ni store: se prueba en Node (tests/unit/activity.test.mjs).
import { isDateStr as looseDateStr, toDateStr, parseDate, round, fmtPace, fmtSpeed, fmtNum, fmtDuration, addDays, diffDays, sortBy, normalize } from './util.js';
import { pace, speed, pace100, sessionLoad, movingAverage, linearRegression, dayIndex } from './calc.js';
import { RUN_TYPES, BIKE_TYPES, SWIM_STROKES, OTHER_TYPES, ACTIVITY_LABEL } from './seed.js';

/** Tipos de actividad que gestiona este módulo (la fuerza va en #/session). */
export const ACTIVITY_KINDS = ['run', 'bike', 'swim', 'other'];

/** Fecha 'YYYY-MM-DD' que existe de verdad (util.isDateStr acepta p. ej. '2026-02-31'). */
export const isDateStr = (str) => looseDateStr(str) && toDateStr(parseDate(str)) === str;
export const isActivityKind = (k) => ACTIVITY_KINDS.includes(k);

/** Textos de interfaz por tipo. */
export const KIND_UI = {
  run: { label: 'Carrera', newTitle: 'Nueva carrera', durLabel: 'Tiempo en movimiento', seg: 'Carrera' },
  bike: { label: 'Bici', newTitle: 'Nueva salida en bici', durLabel: 'Tiempo', seg: 'Bici' },
  swim: { label: 'Natación', newTitle: 'Nueva natación', durLabel: 'Tiempo', seg: 'Natación' },
  other: { label: 'Otra actividad', newTitle: 'Nueva actividad', durLabel: 'Duración', seg: 'Otra' },
};

/** Campos opcionales que aplican a cada tipo; el resto se guarda vacío. */
export const KIND_FIELDS = {
  run: ['distanceKm', 'elapsedSec', 'elevationM', 'hrAvg', 'hrMax', 'cadence', 'subtype', 'feel'],
  bike: ['distanceKm', 'elapsedSec', 'elevationM', 'hrAvg', 'hrMax', 'cadence', 'powerAvg', 'powerNp', 'subtype'],
  swim: ['distanceKm', 'poolType', 'poolLengthM', 'stroke'],
  other: ['subtype'],
};
const OPTIONAL_FIELDS = ['distanceKm', 'elapsedSec', 'elevationM', 'hrAvg', 'hrMax', 'cadence', 'powerAvg', 'powerNp', 'subtype', 'feel', 'poolType', 'poolLengthM', 'stroke'];
const INT_FIELDS = ['elapsedSec', 'hrAvg', 'hrMax', 'cadence', 'powerAvg', 'powerNp'];

export const SUBTYPE_OPTIONS = { run: RUN_TYPES, bike: BIKE_TYPES, other: OTHER_TYPES };
export const POOL_LENGTHS = [25, 50];

// ---------------------------------------------------------------------------
// Formulario ↔ registro
// ---------------------------------------------------------------------------

/**
 * Formulario vacío. El formulario usa las mismas claves y unidades que el registro
 * (distanceKm en km también en natación; la vista convierte a metros).
 * planDate: undefined o igual a date → «sigue a la fecha» (planFollows).
 */
export function emptyForm(kind, { date, planDate } = {}) {
  const follows = planDate === undefined || planDate === date;
  return {
    kind: isActivityKind(kind) ? kind : 'run',
    date,
    planFollows: follows,
    planDate: follows ? null : planDate ?? null,
    movingSec: null,
    rpe: null,
    notes: '',
    distanceKm: null,
    elapsedSec: null,
    elevationM: null,
    hrAvg: null,
    hrMax: null,
    cadence: null,
    powerAvg: null,
    powerNp: null,
    subtype: null,
    feel: '',
    poolType: null,
    poolLengthM: null,
    stroke: null,
    parentId: null,
    parentItemId: null,
    templateItemId: null,
  };
}

/** Formulario a partir de un registro guardado. */
export function formFromRecord(rec) {
  const f = emptyForm(rec.kind, { date: rec.date, planDate: rec.planDate });
  f.movingSec = rec.movingSec ?? (typeof rec.durationMin === 'number' ? Math.round(rec.durationMin * 60) : null);
  f.rpe = rec.rpe ?? null;
  f.notes = rec.notes || '';
  for (const k of OPTIONAL_FIELDS) if (rec[k] != null) f[k] = rec[k];
  f.feel = rec.feel || '';
  f.parentId = rec.parentId ?? null;
  f.parentItemId = rec.parentItemId ?? null;
  f.templateItemId = rec.templateItemId ?? null;
  return f;
}

/** Errores de los campos obligatorios: tipo, fecha y duración > 0. */
export function validate(form) {
  const errors = [];
  if (!form || !isActivityKind(form.kind)) errors.push('kind');
  if (!form || !isDateStr(form.date)) errors.push('date');
  if (!form || !(form.movingSec > 0)) errors.push('duration');
  return errors;
}
export const isValid = (form) => validate(form).length === 0;

/** Mensaje corto con lo que falta para poder guardar. */
export function missingText(errors) {
  const names = { kind: 'el tipo', date: 'la fecha', duration: 'la duración' };
  const list = errors.map((e) => names[e]).filter(Boolean);
  if (!list.length) return '';
  const txt = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} y ${list.at(-1)}`;
  return `Falta ${txt}`;
}

/** ¿Ha escrito algo el usuario? (para decidir si merece la pena un borrador). */
export function hasContent(form) {
  if (!form) return false;
  if (form.movingSec > 0 || form.rpe != null) return true;
  return OPTIONAL_FIELDS.some((k) => form[k] != null && form[k] !== '') || !!String(form.notes || '').trim();
}

const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const nonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const txt = (v) => { const s = String(v ?? '').trim(); return s || null; };

/** Normaliza un campo opcional según su tipo (números positivos, enteros, textos recortados). */
export function cleanField(key, value, form) {
  switch (key) {
    case 'distanceKm': { const v = posNum(value); return v == null ? null : round(v, 0.001); }
    case 'elevationM': { const v = nonNeg(value); return v == null ? null : Math.round(v); }
    case 'poolType': return value === 'pool' || value === 'open' ? value : null;
    case 'poolLengthM': return form?.poolType === 'pool' && POOL_LENGTHS.includes(Number(value)) ? Number(value) : null;
    case 'stroke': return SWIM_STROKES.some((s) => s.id === value) ? value : null;
    case 'subtype': {
      const s = txt(value);
      if (!s) return null;
      if (form?.kind === 'other') return s; // texto libre permitido
      return (SUBTYPE_OPTIONS[form?.kind] || []).some((o) => o.id === s) ? s : null;
    }
    case 'feel': return txt(value) || '';
    default:
      if (INT_FIELDS.includes(key)) { const v = posNum(value); return v == null ? null : Math.round(v); }
      return value ?? null;
  }
}

/**
 * Construye el registro de sesión (store 'sessions') a partir del formulario.
 * - base: registro existente (se conservan id, createdAt, enlaces…). Si el formulario tiene
 *   la fecha o la duración vacías/incorrectas se mantienen las de base.
 * - Los campos que no aplican al tipo se guardan vacíos.
 * Devuelve un objeto NUEVO (no muta base).
 */
export function buildRecord(form, base = null, { id = null, now = Date.now() } = {}) {
  const rec = base
    ? { ...base }
    : {
        id,
        templateId: null,
        startedAt: null,
        endedAt: null,
        parentId: null,
        parentItemId: null,
        templateItemId: null,
        createdAt: now,
        updatedAt: now,
      };
  rec.kind = form.kind;
  rec.status = 'done';
  rec.date = isDateStr(form.date) ? form.date : base?.date ?? null;
  rec.planDate = form.planFollows ? rec.date : (isDateStr(form.planDate) ? form.planDate : null);
  rec.movingSec = form.movingSec > 0 ? Math.round(form.movingSec) : base?.movingSec ?? null;
  rec.durationMin = rec.movingSec != null ? rec.movingSec / 60 : null;
  rec.rpe = Number.isInteger(form.rpe) && form.rpe >= 1 && form.rpe <= 10 ? form.rpe : null;
  rec.notes = String(form.notes || '').trim();
  const allowed = KIND_FIELDS[form.kind] || [];
  for (const k of OPTIONAL_FIELDS) {
    rec[k] = allowed.includes(k) ? cleanField(k, form[k], form) : (k === 'feel' ? '' : null);
  }
  if (form.parentId) {
    rec.parentId = form.parentId;
    rec.parentItemId = form.parentItemId ?? null;
    rec.templateItemId = form.templateItemId ?? null;
  }
  rec.templateName = activityTitle(rec);
  return rec;
}

/** Etiqueta del tipo de sesión / subtipo (texto libre en «otras»). */
export function subtypeLabel(kind, subtype) {
  if (!subtype) return '';
  const opt = (SUBTYPE_OPTIONS[kind] || []).find((o) => o.id === subtype);
  return opt ? opt.label : kind === 'other' ? String(subtype) : '';
}

/** Título legible: «Carrera · Rodaje / Z2», «Natación · Aguas abiertas», «Baloncesto». */
export function activityTitle(rec) {
  if (!rec) return '';
  const base = ACTIVITY_LABEL[rec.kind] || 'Actividad';
  if (rec.kind === 'other') return subtypeLabel('other', rec.subtype) || base;
  if (rec.kind === 'swim') return rec.poolType === 'open' ? `${base} · Aguas abiertas` : base;
  const sub = subtypeLabel(rec.kind, rec.subtype);
  return sub ? `${base} · ${sub}` : base;
}

// ---------------------------------------------------------------------------
// Métricas calculadas en vivo
// ---------------------------------------------------------------------------

/** Carga = duración (min) × esfuerzo percibido. null si falta alguno. */
export function activityLoad(movingSec, rpe) {
  if (!(movingSec > 0)) return null;
  return sessionLoad({ kind: 'run', durationMin: movingSec / 60, rpe });
}

/**
 * Métrica principal calculada según el tipo:
 *  run → ritmo medio (s/km), bike → velocidad media (km/h), swim → ritmo /100 m (s), other → null.
 * Devuelve { label, value, text, sub } o null.
 */
export function primaryMetric(form) {
  const sec = form.movingSec;
  const km = form.distanceKm;
  const need = 'Indica distancia y tiempo';
  if (form.kind === 'run') {
    const v = pace(sec, km);
    return { label: 'Ritmo medio', value: v, text: fmtPace(v), sub: v ? `${fmtNum(km, 2)} km a ${fmtSpeed(speed(sec, km))}` : need };
  }
  if (form.kind === 'bike') {
    const v = speed(sec, km);
    return { label: 'Velocidad media', value: v, text: fmtSpeed(v), sub: v ? `${fmtNum(km, 1)} km en ${fmtDuration(sec)}` : need };
  }
  if (form.kind === 'swim') {
    const v = pace100(sec, km);
    return { label: 'Ritmo /100 m', value: v, text: fmtPace(v, '/100 m'), sub: v ? `${fmtNum(km * 1000, 0)} m en ${fmtDuration(sec)}` : need };
  }
  return null;
}

/** Texto de la carga en vivo: { value, text, sub }. */
export function loadInfo(form) {
  if (!(form.movingSec > 0)) return { value: null, text: '—', sub: 'Falta la duración' };
  const load = activityLoad(form.movingSec, form.rpe);
  if (load == null) return { value: null, text: '—', sub: 'Sin esfuerzo percibido no hay carga' };
  return { value: load, text: fmtNum(load, 0), sub: `${fmtNum(form.movingSec / 60, 0)} min × esfuerzo ${form.rpe}` };
}

// ---------------------------------------------------------------------------
// Actividad enlazada a una sesión de fuerza
// ---------------------------------------------------------------------------

/** Deduce el tipo de sesión a partir de las notas de un ítem de plantilla («Zona 2» → z2). */
export function subtypeFromNotes(kind, notes) {
  const n = normalize(notes);
  if (!n) return null;
  const rules = {
    run: [
      [/\bz(ona)?\s*2\b|rodaje|suave|facil|regenerativ/, 'z2'],
      [/series|interval|fartlek|cuestas/, 'intervals'],
      [/tempo|umbral/, 'tempo'],
      [/tirada|larga|fondo/, 'long'],
      [/competicion|carrera popular|dorsal|maraton/, 'race'],
    ],
    bike: [
      [/\bz(ona)?\s*2\b|rodaje|suave|facil/, 'easy'],
      [/series|interval/, 'intervals'],
      [/rodillo|trainer|indoor/, 'trainer'],
      [/ruta|salida/, 'route'],
    ],
    other: [
      [/balonc|basket/, 'basketball'],
      [/agilidad|cambios de direccion/, 'agility'],
      [/movilidad|estiramiento|yoga/, 'mobility'],
      [/deporte/, 'sport'],
    ],
  };
  for (const [re, id] of rules[kind] || []) if (re.test(n)) return id;
  return null;
}

/** Texto del objetivo de un ítem de cardio: «30–45 min», «5 km», «30–45 min · 5 km». */
export function targetText(target) {
  if (!target) return '';
  const parts = [];
  const a = target.timeMin > 0 ? Math.round(target.timeMin / 60) : null;
  const b = target.timeMax > 0 ? Math.round(target.timeMax / 60) : null;
  if (a && b && a !== b) parts.push(`${a}–${b} min`);
  else if (a || b) parts.push(`${a || b} min`);
  if (target.distance > 0) parts.push(target.distance >= 1000 ? `${fmtNum(target.distance / 1000, 2)} km` : `${fmtNum(target.distance, 0)} m`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Peso corporal
// ---------------------------------------------------------------------------

/** Parámetros de la tendencia: ventana de 28 días y mínimo de datos. */
export const BW_TREND = { windowDays: 28, minPoints: 4, minSpanDays: 14 };

export const roundKg = (v) => (typeof v === 'number' && Number.isFinite(v) ? round(v, 0.1) : null);

/** Pesajes válidos como puntos [{date, value}] ordenados por fecha. */
export function bwPoints(list) {
  return sortBy((list || []).filter((b) => b && isDateStr(b.id) && b.kg > 0), 'id').map((b) => ({ date: b.id, value: b.kg }));
}

/**
 * Tendencia semanal (kg/semana) = pendiente de la regresión lineal de la media móvil de 7 días
 * en los últimos `windowDays` días hasta `today`. Necesita minPoints pesajes que abarquen minSpanDays.
 * maPoints: salida de calc.movingAverage (con `ma`).
 */
export function bwTrend(maPoints, today, opts = {}) {
  const { windowDays, minPoints, minSpanDays } = { ...BW_TREND, ...opts };
  const from = addDays(today, -(windowDays - 1));
  const win = maPoints.filter((p) => p.date >= from && p.date <= today);
  const n = win.length;
  const span = n ? diffDays(win[0].date, win[n - 1].date) : 0;
  const need = `Hacen falta al menos ${minPoints} pesajes repartidos en ${minSpanDays} días o más dentro de los últimos ${windowDays} días`;
  if (n < minPoints || span < minSpanDays) return { ok: false, n, span, reason: `${need} (hay ${n} en ${span} días).` };
  const reg = linearRegression(win.map((p) => dayIndex(p.date)), win.map((p) => p.ma));
  if (!reg) return { ok: false, n, span, reason: need + '.' };
  return { ok: true, n, span, from: win[0].date, to: win[n - 1].date, kgPerWeek: reg.slope * 7, r2: reg.r2 };
}

/**
 * Resumen del peso: último pesaje, media móvil de 7 días (en el último pesaje) y tendencia.
 * @returns {{count, last, ma7, ma7Date, ma7N, trend}}
 */
export function bwStats(list, today) {
  const pts = bwPoints(list);
  if (!pts.length) return { count: 0, last: null, ma7: null, ma7Date: null, ma7N: 0, trend: bwTrend([], today) };
  const ma = movingAverage(pts, 7);
  const lastMa = ma[ma.length - 1];
  const last = pts[pts.length - 1];
  const ma7N = pts.filter((p) => p.date <= last.date && diffDays(p.date, last.date) < 7).length;
  return {
    count: pts.length,
    last: { date: last.date, kg: last.value },
    ma7: lastMa.ma,
    ma7Date: lastMa.date,
    ma7N,
    trend: bwTrend(ma, today),
  };
}

/** Lista descendente de pesajes con la variación respecto al pesaje anterior. */
export function bwWithDeltas(list) {
  const asc = sortBy((list || []).filter((b) => b && b.kg > 0), 'id');
  const out = asc.map((b, i) => ({ ...b, delta: i > 0 ? round(b.kg - asc[i - 1].kg, 0.1) : null }));
  return out.reverse();
}

/** Palabra para la tendencia (umbral ±0,05 kg/semana = estable). */
export function trendWord(kgPerWeek) {
  if (kgPerWeek == null || !Number.isFinite(kgPerWeek)) return '';
  if (Math.abs(kgPerWeek) < 0.05) return 'estable';
  return kgPerWeek > 0 ? 'subiendo' : 'bajando';
}
