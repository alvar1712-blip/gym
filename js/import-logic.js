// import-logic.js — lógica PURA de la importación de actividades (sin DOM ni store; se prueba en Node).
//   sportToKind: deporte del archivo → tipo de la app.
//   itemFromEntry: resumen leído (import-parse.summarize) → borrador editable de la vista previa («item»).
//   itemRecord: item → registro de la store 'sessions' con la MISMA forma que crea el formulario de actividad
//     (activity-logic.buildRecord), más startedAt (ms) y source:{type, fileName}. No se guardan los puntos GPS.
//   updateDuplicates: marca «ya registrada» (o repetida en la misma importación) y la desmarca por defecto.
import { emptyForm, buildRecord, cleanField, isActivityKind, primaryMetric, activityTitle } from './activity-logic.js';
import { dateFromTs, isDateStr, normalize, fmtNum, fmtDuration } from './util.js';

/** Subtipo (texto libre de «otra actividad») de las caminatas importadas. */
export const WALK_SUBTYPE = 'Caminata';
/** Tolerancias de duplicado: misma hora de inicio ± 2 min o, sin hora, misma fecha y ± 3 % de distancia y duración. */
export const DUP_START_MS = 2 * 60 * 1000;
export const DUP_TOLERANCE = 0.03;

// ---------------------------------------------------------------------------
// Deporte del archivo → tipo
// ---------------------------------------------------------------------------
const SPORT_WORDS = [
  ['swim', ['swim', 'swimming', 'natacion', 'nadar', 'piscina']],
  ['hike', ['hike', 'hiking', 'senderismo', 'mountaineering', 'montanismo', 'alpinismo', 'trekking', 'excursion']],
  ['bike', ['bike', 'biking', 'cycling', 'cycle', 'ride', 'riding', 'bici', 'bicicleta', 'ciclismo', 'mtb', 'gravel', 'ebike', 'ebiking']],
  ['run', ['run', 'running', 'trail', 'carrera', 'correr', 'trote', 'jog', 'jogging', 'treadmill', 'cinta']],
  ['walk', ['walk', 'walking', 'caminata', 'caminar', 'paseo', 'andar']],
  ['basketball', ['basketball', 'baloncesto']],
];
const TRAINER_WORDS = ['indoor', 'trainer', 'virtual', 'rodillo', 'spin', 'zwift'];

/** Palabras de un texto: separa camelCase («TrailRun»), quita acentos y signos («trail_running»). */
export function sportTokens(text) {
  return normalize(String(text ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')).split(/[^a-z0-9]+/).filter(Boolean);
}

function matchSport(tokens) {
  for (const [id, words] of SPORT_WORDS) if (tokens.some((t) => words.includes(t))) return id;
  return null;
}

/**
 * Tipo de la app a partir del deporte del archivo (GPX <type>, TCX Sport, FIT sport/sub_sport) y, si no dice
 * nada, del nombre de la actividad.
 * running/trail → run; cycling/biking → bike; hiking → hike; swimming → swim; walking → other «Caminata».
 * @returns {{ kind: 'run'|'bike'|'swim'|'hike'|'other'|null, subtype: string|null, poolType: 'pool'|'open'|null }}
 */
export function sportToKind(sport = '', subSport = '', name = '') {
  const raw = String(sport ?? '').trim();
  const typeTokens = sportTokens(`${raw} ${subSport ?? ''}`);
  const all = [...typeTokens, ...sportTokens(name)];
  let id = null;
  if (raw === '9') id = 'run'; // Strava (GPX antiguos): 9 = carrera, 1 = bici
  else if (raw === '1') id = 'bike';
  else id = matchSport(typeTokens) ?? matchSport(sportTokens(name));
  const out = { kind: null, subtype: null, poolType: null };
  if (!id) return out;
  if (id === 'walk') return { ...out, kind: 'other', subtype: WALK_SUBTYPE };
  if (id === 'basketball') return { ...out, kind: 'other', subtype: 'basketball' };
  out.kind = id;
  if (id === 'bike' && all.some((t) => TRAINER_WORDS.includes(t))) out.subtype = 'trainer';
  if (id === 'swim') {
    const joined = all.join(' ');
    if (/open ?water|aguas abiertas|openwater/.test(joined)) out.poolType = 'open';
    else if (all.some((t) => t === 'lap' || t === 'pool' || t === 'piscina')) out.poolType = 'pool';
  }
  return out;
}

/**
 * Cadencia en pasos por minuto (carrera, senderismo, caminata): los relojes guardan zancadas por minuto (la mitad).
 * Valores que ya parecen pasos (≥ 130 en carrera, ≥ 90 andando) se dejan igual; en bici son rpm.
 */
export function stepsCadence(kind, raw) {
  if (!(raw > 0)) return null;
  if (kind === 'run') return Math.round(raw < 130 ? raw * 2 : raw);
  if (kind === 'hike' || kind === 'other') return Math.round(raw < 90 ? raw * 2 : raw);
  return Math.round(raw);
}

// ---------------------------------------------------------------------------
// Borrador editable («item»)
// ---------------------------------------------------------------------------
const posOrNull = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const intOrNull = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : null);
const mOrNull = (v) => (Number.isFinite(v) ? Math.round(v) : null);

/** Duración que se propone según el tipo: en movimiento (carrera, bici, senderismo) o cronómetro (natación, otras). */
function durationFor(kind, src) {
  const v = kind === 'swim'
    ? src.timerSec ?? src.movingSec ?? src.elapsedSec
    : kind === 'other'
      ? src.timerSec ?? src.elapsedSec ?? src.movingSec
      : src.movingSec ?? src.timerSec ?? src.elapsedSec;
  return intOrNull(v);
}

/**
 * Borrador de la vista previa a partir de una entrada de import-parse.readActivityFile (con summary).
 * Todos los campos se pueden editar; `edited` recuerda lo que ha tocado el usuario (no se recalcula al cambiar de tipo).
 */
export function itemFromEntry(entry, { key = '', today = null } = {}) {
  const s = entry.summary || {};
  const hint = sportToKind(s.sport, s.subSport, s.name);
  const item = {
    key,
    label: entry.label || entry.fileName || '',
    fileName: entry.fileName || entry.label || '',
    format: entry.format || s.format || null,
    sport: s.sport || '',
    sportName: s.name || '',
    hint,
    detectedKind: hint.kind,
    kind: null,
    subtype: null,
    poolType: hint.poolType,
    poolLengthM: [25, 50].includes(Math.round(s.poolLengthM)) ? Math.round(s.poolLengthM) : null,
    startedAt: Number.isFinite(s.startedAt) ? s.startedAt : null,
    date: Number.isFinite(s.startedAt) ? dateFromTs(s.startedAt) : today,
    hasTime: Number.isFinite(s.startedAt),
    movingSec: null,
    elapsedSec: intOrNull(s.elapsedSec),
    distanceKm: posOrNull(s.distanceM) != null ? s.distanceM / 1000 : null,
    elevationM: mOrNull(s.ascentM),
    elevationLossM: mOrNull(s.descentM),
    altMaxM: mOrNull(s.altMaxM),
    hrAvg: intOrNull(s.hrAvg),
    hrMax: intOrNull(s.hrMax),
    cadenceRaw: posOrNull(s.cadence),
    cadence: null,
    powerAvg: intOrNull(s.powerAvg),
    powerNp: intOrNull(s.powerNp),
    rpe: null,
    points: s.points || 0,
    gpsPoints: s.gpsPoints || 0,
    src: { movingSec: posOrNull(s.movingSec), timerSec: posOrNull(s.timerSec), elapsedSec: posOrNull(s.elapsedSec) },
    edited: {},
    selected: false,
    valid: false,
    dup: undefined,
  };
  setItemKind(item, hint.kind);
  return item;
}

/** Cambia el tipo: recalcula la duración propuesta, la cadencia y el subtipo (salvo lo que haya editado el usuario). */
export function setItemKind(item, kind) {
  item.kind = isActivityKind(kind) ? kind : null;
  if (!item.kind) return item;
  if (!item.edited.movingSec) item.movingSec = durationFor(item.kind, item.src);
  if (!item.edited.cadence) item.cadence = stepsCadence(item.kind, item.cadenceRaw);
  if (!item.edited.subtype) item.subtype = item.hint && item.hint.kind === item.kind ? item.hint.subtype : null;
  if (item.kind === 'swim' && !item.poolType && item.poolLengthM) item.poolType = 'pool';
  return item;
}

/** Cambia un dato editado por el usuario (queda marcado como editado). */
export function setItemField(item, key, value) {
  item[key] = value;
  item.edited[key] = true;
  return item;
}

/** Hora local «HH:MM» del inicio, o ''. */
export function itemTime(item) {
  if (!Number.isFinite(item.startedAt)) return '';
  const d = new Date(item.startedAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Cambia la fecha conservando la hora de inicio. */
export function setItemDate(item, date) {
  if (!isDateStr(date)) return item;
  item.date = date;
  if (Number.isFinite(item.startedAt)) {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(item.startedAt);
    dt.setFullYear(y, m - 1, d);
    item.startedAt = dt.getTime();
  }
  return item;
}

/** Cambia la hora de inicio («HH:MM»); '' la quita. */
export function setItemTime(item, hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!m) {
    if (!String(hm || '').trim()) item.startedAt = null;
    return item;
  }
  const [y, mo, d] = (isDateStr(item.date) ? item.date : dateFromTs(Date.now())).split('-').map(Number);
  const base = Number.isFinite(item.startedAt) ? new Date(item.startedAt) : new Date(y, mo - 1, d, 0, 0, 0, 0);
  base.setFullYear(y, mo - 1, d);
  base.setHours(Number(m[1]), Number(m[2]));
  item.startedAt = base.getTime();
  return item;
}

/**
 * Lo que impide guardar: 'kind' (deporte sin identificar), 'date', 'future' (fecha futura), 'duration'.
 */
export function itemProblems(item, today = null) {
  const out = [];
  if (!isActivityKind(item.kind)) out.push('kind');
  if (!isDateStr(item.date)) out.push('date');
  else if (today && item.date > today) out.push('future');
  if (!(item.movingSec > 0)) out.push('duration');
  return out;
}

/** Texto corto de lo que falta. */
export function problemText(problems) {
  const names = { kind: 'Elige el deporte', date: 'Falta la fecha', future: 'La fecha es futura', duration: 'Falta la duración' };
  return problems.map((p) => names[p]).filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Item → registro
// ---------------------------------------------------------------------------
const FORM_KEYS = [
  'movingSec', 'rpe', 'distanceKm', 'elapsedSec', 'elevationM', 'elevationLossM', 'altMaxM', 'hrAvg', 'hrMax',
  'cadence', 'powerAvg', 'powerNp', 'subtype', 'poolType', 'poolLengthM',
];
/** Datos del archivo que se conservan aunque el formulario no los pida para ese tipo (p. ej. cadencia en senderismo). */
const EXTRA_KEYS = ['cadence', 'powerAvg', 'powerNp'];
const EXTRA_KINDS = ['run', 'bike', 'hike'];

/** Formulario de activity-logic equivalente al item (mismas claves y unidades). */
export function itemForm(item) {
  const f = emptyForm(item.kind, { date: item.date });
  for (const k of FORM_KEYS) f[k] = item[k] ?? null;
  return f;
}

/**
 * Registro de la store 'sessions' (status 'done'), construido con activity-logic.buildRecord como el formulario,
 * más startedAt (ms), source {type, fileName}. En «otra actividad» (caminata) la distancia va a las notas,
 * porque ese tipo no tiene distancia.
 */
export function itemRecord(item, { id = null, now = Date.now() } = {}) {
  const form = itemForm(item);
  const rec = buildRecord(form, null, { id, now });
  if (EXTRA_KINDS.includes(item.kind)) {
    for (const k of EXTRA_KEYS) if (rec[k] == null && item[k] != null) rec[k] = cleanField(k, item[k], form);
  }
  if (item.kind === 'other' && item.distanceKm > 0) rec.notes = `Distancia: ${fmtNum(item.distanceKm, 2)} km`;
  rec.startedAt = Number.isFinite(item.startedAt) ? item.startedAt : null;
  rec.source = { type: item.format, fileName: item.fileName };
  return rec;
}

// ---------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------
const recSec = (r) => (r.movingSec > 0 ? r.movingSec : r.durationMin > 0 ? r.durationMin * 60 : null);
const near = (a, b, tol = DUP_TOLERANCE) => Math.abs(a - b) <= tol * Math.max(a, b);

/**
 * ¿Es la misma actividad? Mismo tipo y: inicio a ± 2 min si ambas tienen hora; si no, misma fecha con duración
 * y distancia a ± 3 % (sin distancia en ninguna de las dos, basta la duración).
 */
export function isSameActivity(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (Number.isFinite(a.startedAt) && a.startedAt > 0 && Number.isFinite(b.startedAt) && b.startedAt > 0) {
    return Math.abs(a.startedAt - b.startedAt) <= DUP_START_MS;
  }
  if (a.date !== b.date) return false;
  const sa = recSec(a);
  const sb = recSec(b);
  if (!sa || !sb || !near(sa, sb)) return false;
  const ka = a.distanceKm > 0 ? a.distanceKm : null;
  const kb = b.distanceKm > 0 ? b.distanceKm : null;
  if (ka == null && kb == null) return true;
  if (ka == null || kb == null) return false;
  return near(ka, kb);
}

/** Actividad guardada que coincide con el registro candidato, o null. */
export function findDuplicate(rec, sessions) {
  return (sessions || []).find((s) => s && s.kind !== 'strength' && s.status === 'done' && s.id !== rec.id && isSameActivity(rec, s)) || null;
}

/**
 * Recalcula los duplicados de toda la lista (contra lo guardado y contra los items anteriores de la misma
 * importación) y ajusta la selección: un item nuevo se marca si se puede guardar y no es duplicado; si pasa a ser
 * duplicado se desmarca, y si deja de serlo (o se completa lo que faltaba, p. ej. el deporte) se marca. Un item que
 * no se puede guardar nunca queda marcado. En los demás casos se respeta lo que haya elegido el usuario.
 * item.dup = null | { type:'saved', id, title, date, startedAt } | { type:'batch', key, label }
 */
export function updateDuplicates(items, sessions, today = null) {
  const recs = items.map((it) => (isActivityKind(it.kind) ? itemRecord(it, { id: `tmp_${it.key}`, now: 0 }) : null));
  items.forEach((it, i) => {
    let dup = null;
    if (recs[i]) {
      const s = findDuplicate(recs[i], sessions);
      if (s) {
        dup = { type: 'saved', id: s.id, title: s.templateName || activityTitle(s), date: s.date, startedAt: s.startedAt ?? null };
      } else {
        for (let j = 0; j < i; j++) {
          if (recs[j] && isSameActivity(recs[i], recs[j])) { dup = { type: 'batch', key: items[j].key, label: items[j].label }; break; }
        }
      }
    }
    const valid = itemProblems(it, today).length === 0;
    const prevDup = it.dup;
    const prevValid = it.valid;
    it.dup = dup;
    it.valid = valid;
    if (prevDup === undefined || !valid) it.selected = valid && !dup;
    else if (!!dup !== !!prevDup || !prevValid) it.selected = !dup;
  });
  return items;
}

/** Items marcados que se pueden guardar. */
export function selectedItems(items, today = null) {
  return items.filter((it) => it.selected && itemProblems(it, today).length === 0);
}

// ---------------------------------------------------------------------------
// Textos de la tarjeta
// ---------------------------------------------------------------------------
/**
 * Datos principales y secundarios para la tarjeta de la vista previa.
 * @returns {{ main: string[], extra: string[] }}
 */
export function itemFacts(item) {
  const main = [];
  const extra = [];
  const k = item.kind;
  if (item.distanceKm > 0) {
    main.push(k === 'swim' ? `${fmtNum(Math.round(item.distanceKm * 1000), 0)} m` : `${fmtNum(item.distanceKm, 2)} km`);
  }
  if (item.movingSec > 0) main.push(fmtDuration(item.movingSec));
  const metric = k ? primaryMetric(itemForm(item)) : null;
  if (metric && metric.value) main.push(`${metric.num} ${metric.unit}`);
  if (k !== 'swim' && item.elevationM > 0) main.push(`+${fmtNum(item.elevationM, 0)} m`);
  if (item.hrAvg) extra.push(`FC ${item.hrAvg}${item.hrMax ? ` / ${item.hrMax}` : ''}`);
  if (item.cadence && k && k !== 'swim') extra.push(`${item.cadence} ${k === 'bike' ? 'rpm' : 'ppm'}`);
  if (item.powerAvg && k !== 'swim') extra.push(`${item.powerAvg} W`);
  if (item.elapsedSec > 0 && item.movingSec > 0 && item.elapsedSec - item.movingSec >= 60 && k !== 'other' && k !== 'swim') {
    extra.push(`total ${fmtDuration(item.elapsedSec)}`);
  }
  if (item.rpe) extra.push(`esfuerzo ${item.rpe}`);
  return { main, extra };
}
