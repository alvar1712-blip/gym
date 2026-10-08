import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyForm, formFromRecord, validate, isValid, missingText, hasContent, buildRecord, cleanField,
  primaryMetric, paceWarning, loadInfo, activityLoad, activityTitle, subtypeLabel, subtypeFromNotes, targetText,
  bwStats, bwTrend, bwWithDeltas, bwPoints, roundKg, trendWord, KIND_FIELDS, fieldsLostOnKindChange, joinList,
} from '../../js/activity-logic.js';
import { movingAverage } from '../../js/calc.js';
import { addDays } from '../../js/util.js';

const D = '2026-09-20';

test('validación: solo tipo, fecha y duración son obligatorios', () => {
  const f = emptyForm('run', { date: D });
  assert.deepEqual(validate(f), ['duration']);
  assert.equal(isValid(f), false);
  f.movingSec = 1800;
  assert.equal(isValid(f), true);
  f.date = '2026-13-40';
  assert.deepEqual(validate(f), ['date']);
  assert.deepEqual(validate({ ...emptyForm('run', { date: D }), kind: 'strength', movingSec: 60 }), ['kind']);
  assert.equal(missingText(['duration']), 'Falta la duración');
  assert.equal(missingText(['date', 'duration']), 'Falta la fecha y la duración');
  assert.equal(missingText([]), '');
});

test('hasContent: detecta si el usuario ha escrito algo', () => {
  const f = emptyForm('bike', { date: D });
  assert.equal(hasContent(f), false);
  assert.equal(hasContent({ ...f, distanceKm: 20 }), true);
  assert.equal(hasContent({ ...f, notes: '  ' }), false);
  assert.equal(hasContent({ ...f, notes: 'hola' }), true);
  assert.equal(hasContent({ ...f, rpe: 5 }), true);
});

test('hasContent con base: lo prellenado (tipo de sesión de las notas) no cuenta como escrito', () => {
  const base = { ...emptyForm('run', { date: D }), parentId: 's_1', subtype: 'z2' };
  assert.equal(hasContent(base), true, 'sin base, el subtipo cuenta');
  assert.equal(hasContent(base, base), false);
  assert.equal(hasContent({ ...base }, base), false);
  assert.equal(hasContent({ ...base, subtype: 'intervals' }, base), true, 'cambiar el tipo sí es escribir');
  assert.equal(hasContent({ ...base, subtype: null }, base), false);
  assert.equal(hasContent({ ...base, distanceKm: 8.4 }, base), true);
  assert.equal(hasContent({ ...base, movingSec: 60 }, base), true);
  assert.equal(hasContent({ ...base, notes: 'x' }, base), true);
});

test('fieldsLostOnKindChange: lo que se quitaría al cambiar el tipo de una actividad guardada', () => {
  const bike = buildRecord({
    ...emptyForm('bike', { date: D }), movingSec: 5400, distanceKm: 45, rpe: 6, hrAvg: 140, hrMax: 172,
    powerAvg: 190, powerNp: 205, elevationM: 600, cadence: 85, subtype: 'route', elapsedSec: 5600,
  }, null, { id: 'b' });
  assert.deepEqual(fieldsLostOnKindChange(bike, 'bike'), []);
  assert.deepEqual(fieldsLostOnKindChange(bike, 'swim'),
    ['tiempo total', 'desnivel', 'FC media', 'FC máxima', 'cadencia', 'potencia media', 'potencia normalizada', 'tipo de sesión «Ruta»']);
  assert.deepEqual(fieldsLostOnKindChange(bike, 'run'), ['potencia media', 'potencia normalizada', 'tipo de sesión «Ruta»']);
  assert.deepEqual(fieldsLostOnKindChange(bike, 'other'),
    ['distancia', 'tiempo total', 'desnivel', 'FC media', 'FC máxima', 'cadencia', 'potencia media', 'potencia normalizada', 'tipo de sesión «Ruta»']);
  // Solo duración, esfuerzo, notas y distancia: correr → bici no pierde nada.
  const run = buildRecord({ ...emptyForm('run', { date: D }), movingSec: 1800, distanceKm: 5, rpe: 5, notes: 'ok' }, null, { id: 'r' });
  assert.deepEqual(fieldsLostOnKindChange(run, 'bike'), []);
  assert.deepEqual(fieldsLostOnKindChange({ ...run, feel: 'Z2' }, 'bike'), ['zona o sensaciones']);
  const other = buildRecord({ ...emptyForm('other', { date: D }), movingSec: 3600, subtype: 'Pádel' }, null, { id: 'o' });
  assert.deepEqual(fieldsLostOnKindChange(other, 'run'), ['tipo «Pádel»']);
  const swim = buildRecord({ ...emptyForm('swim', { date: D }), movingSec: 1800, distanceKm: 1.5, poolType: 'pool', poolLengthM: 25, stroke: 'free' }, null, { id: 's' });
  assert.deepEqual(fieldsLostOnKindChange(swim, 'run'), ['piscina o aguas abiertas', 'longitud de piscina', 'estilo']);
  assert.deepEqual(fieldsLostOnKindChange(null, 'run'), []);
  assert.equal(joinList(['a']), 'a');
  assert.equal(joinList(['a', 'b', 'c']), 'a, b y c');
});

test('primaryMetric: número y unidad por separado (la unidad no se corta en pantalla)', () => {
  const s = primaryMetric({ ...emptyForm('swim', { date: D }), distanceKm: 1.5, movingSec: 2320 });
  assert.equal(s.num, '2:35');
  assert.equal(s.unit, '/100 m');
  assert.equal(s.text, '2:35 /100 m');
  const b = primaryMetric({ ...emptyForm('bike', { date: D }), distanceKm: 31.5, movingSec: 4400 });
  assert.equal(`${b.num} ${b.unit}`, b.text);
  assert.equal(b.unit, 'km/h');
  const r = primaryMetric({ ...emptyForm('run', { date: D }), distanceKm: 10, movingSec: 3000 });
  assert.deepEqual([r.num, r.unit], ['5:00', '/km']);
  const none = primaryMetric({ ...emptyForm('swim', { date: D }), movingSec: 1800 });
  assert.deepEqual([none.num, none.unit, none.text], ['—', '', '—']);
});

test('carrera: 10 km en 50:00 → ritmo 5:00 /km, carga = min × esfuerzo', () => {
  const f = { ...emptyForm('run', { date: D }), distanceKm: 10, movingSec: 3000 };
  const m = primaryMetric(f);
  assert.equal(m.label, 'Ritmo medio');
  assert.equal(m.value, 300);
  assert.equal(m.text, '5:00 /km');
  assert.match(m.sub, /12 km\/h/);
  assert.deepEqual(loadInfo(f), { value: null, text: '—', sub: 'Sin esfuerzo percibido no hay carga' });
  f.rpe = 7;
  const l = loadInfo(f);
  assert.equal(l.value, 350);
  assert.equal(l.text, '350');
  assert.match(l.sub, /50 min × esfuerzo 7/);
  assert.equal(loadInfo({ ...f, movingSec: null }).sub, 'Falta la duración');
  // Los minutos no se redondean en la explicación: 7040 s = 117 min 20 s → 117,33 × 8 = 938,7 → 939
  // (con «117 min × 8» la cuenta daría 936).
  const r3 = loadInfo({ ...f, movingSec: 7040, rpe: 8 });
  assert.deepEqual([r3.value, r3.text, r3.sub], [939, '939', '117 min 20 s × esfuerzo 8']);
  const r2 = loadInfo({ ...f, movingSec: 3255, rpe: 7 });
  assert.deepEqual([r2.value, r2.sub], [380, '54 min 15 s × esfuerzo 7']);
  assert.equal(loadInfo({ ...f, movingSec: 45, rpe: 5 }).sub, '45 s × esfuerzo 5');
  assert.equal(activityLoad(3000, 7), 350);
  assert.equal(activityLoad(0, 7), null);
});

test('bici: velocidad media; natación: ritmo /100 m; otras: sin métrica', () => {
  const b = primaryMetric({ ...emptyForm('bike', { date: D }), distanceKm: 30, movingSec: 3600 });
  assert.equal(b.value, 30);
  assert.equal(b.text, '30 km/h');
  const s = primaryMetric({ ...emptyForm('swim', { date: D }), distanceKm: 1.5, movingSec: 1800 });
  assert.equal(s.value, 120);
  assert.equal(s.text, '2:00 /100 m');
  assert.equal(primaryMetric(emptyForm('other', { date: D })), null);
  const noDist = primaryMetric({ ...emptyForm('run', { date: D }), movingSec: 1800 });
  assert.equal(noDist.value, null);
  assert.equal(noDist.text, '—');
});

test('buildRecord: registro de carrera según el contrato', () => {
  const f = {
    ...emptyForm('run', { date: D }),
    movingSec: 3000.4, elapsedSec: 3120, distanceKm: 10, rpe: 7, subtype: 'z2', feel: ' Z2 cómoda ',
    hrAvg: 148.6, hrMax: 171, cadence: 172, elevationM: 85.2, notes: ' bien ',
    powerAvg: 250, poolType: 'pool', stroke: 'free', // no aplican a carrera
  };
  const r = buildRecord(f, null, { id: 'a_1', now: 1000 });
  assert.equal(r.id, 'a_1');
  assert.equal(r.kind, 'run');
  assert.equal(r.status, 'done');
  assert.equal(r.date, D);
  assert.equal(r.planDate, D);
  assert.equal(r.movingSec, 3000);
  assert.equal(r.durationMin, 50);
  assert.equal(r.elapsedSec, 3120);
  assert.equal(r.distanceKm, 10);
  assert.equal(r.rpe, 7);
  assert.equal(r.subtype, 'z2');
  assert.equal(r.feel, 'Z2 cómoda');
  assert.equal(r.hrAvg, 149);
  assert.equal(r.elevationM, 85);
  assert.equal(r.notes, 'bien');
  assert.equal(r.powerAvg, null);
  assert.equal(r.poolType, null);
  assert.equal(r.stroke, null);
  assert.equal(r.parentId, null);
  assert.equal(r.templateId, null);
  assert.equal(r.createdAt, 1000);
  assert.equal(r.templateName, 'Carrera · Rodaje / Z2');
});

test('buildRecord: natación en metros → km; piscina con longitud; aguas abiertas sin longitud', () => {
  const f = { ...emptyForm('swim', { date: D }), movingSec: 1800, distanceKm: 1500 / 1000, poolType: 'pool', poolLengthM: 25, stroke: 'free' };
  const r = buildRecord(f, null, { id: 'a_2' });
  assert.equal(r.distanceKm, 1.5);
  assert.equal(r.poolType, 'pool');
  assert.equal(r.poolLengthM, 25);
  assert.equal(r.stroke, 'free');
  assert.equal(r.elapsedSec, null);
  const o = buildRecord({ ...f, poolType: 'open' }, null, { id: 'a_3' });
  assert.equal(o.poolLengthM, null);
  assert.equal(o.templateName, 'Natación · Aguas abiertas');
  assert.equal(cleanField('stroke', 'nope', f), null);
  assert.equal(cleanField('poolLengthM', 33, f), null);
});

test('buildRecord: otras actividades admiten tipo libre; subtipos inválidos se descartan', () => {
  const f = { ...emptyForm('other', { date: D }), movingSec: 3600, rpe: 6, subtype: '  Pádel ', distanceKm: 5 };
  const r = buildRecord(f, null, { id: 'a_4' });
  assert.equal(r.subtype, 'Pádel');
  assert.equal(r.distanceKm, null);
  assert.equal(r.templateName, 'Pádel');
  assert.equal(buildRecord({ ...f, subtype: 'basketball' }, null, { id: 'x' }).templateName, 'Baloncesto');
  assert.equal(buildRecord({ ...f, subtype: null }, null, { id: 'x' }).templateName, 'Otra actividad');
  assert.equal(buildRecord({ ...emptyForm('run', { date: D }), movingSec: 60, subtype: 'basketball' }, null, { id: 'x' }).subtype, null);
  assert.equal(subtypeLabel('bike', 'trainer'), 'Rodillo');
  assert.equal(subtypeLabel('run', null), '');
});

test('buildRecord sobre un registro existente conserva id/createdAt y la duración si se vacía', () => {
  const base = buildRecord({ ...emptyForm('bike', { date: D }), movingSec: 3600, distanceKm: 30 }, null, { id: 'a_5', now: 5 });
  const f = formFromRecord(base);
  assert.equal(f.movingSec, 3600);
  assert.equal(f.distanceKm, 30);
  assert.equal(f.planFollows, true);
  f.movingSec = null;
  f.date = '';
  f.distanceKm = 32;
  const r = buildRecord(f, base);
  assert.equal(r.id, 'a_5');
  assert.equal(r.createdAt, 5);
  assert.equal(r.movingSec, 3600);
  assert.equal(r.date, D);
  assert.equal(r.distanceKm, 32);
  assert.notEqual(r, base);
  // Cambiar de tipo limpia los campos que ya no aplican
  const sw = buildRecord({ ...formFromRecord(base), kind: 'other', movingSec: 3600 }, base);
  assert.equal(sw.distanceKm, null);
  for (const k of KIND_FIELDS.bike.filter((k) => k !== 'subtype')) assert.equal(sw[k], null, k);
});

test('planDate: sigue a la fecha salvo que venga fijada (o nula) desde el plan/sesión padre', () => {
  const f = { ...emptyForm('run', { date: D }), movingSec: 600 };
  assert.equal(buildRecord({ ...f, date: '2026-09-21' }, null, { id: 'x' }).planDate, '2026-09-21');
  const fixed = { ...emptyForm('run', { date: D, planDate: '2026-09-19' }), movingSec: 600 };
  assert.equal(fixed.planFollows, false);
  assert.equal(buildRecord({ ...fixed, date: '2026-09-22' }, null, { id: 'x' }).planDate, '2026-09-19');
  const nul = { ...emptyForm('run', { date: D, planDate: null }), movingSec: 600 };
  assert.equal(buildRecord(nul, null, { id: 'x' }).planDate, null);
  const same = emptyForm('run', { date: D, planDate: D });
  assert.equal(same.planFollows, true);
  const back = formFromRecord(buildRecord(fixed, null, { id: 'x' }));
  assert.equal(back.planFollows, false);
  assert.equal(back.planDate, '2026-09-19');
});

test('actividad enlazada: guarda parentId, parentItemId y templateItemId', () => {
  const f = { ...emptyForm('run', { date: D }), movingSec: 2400, parentId: 's_1', parentItemId: 'se_1', templateItemId: 'ti_d3_1' };
  const r = buildRecord(f, null, { id: 'a_6' });
  assert.equal(r.parentId, 's_1');
  assert.equal(r.parentItemId, 'se_1');
  assert.equal(r.templateItemId, 'ti_d3_1');
  const f2 = formFromRecord(r);
  assert.equal(f2.parentItemId, 'se_1');
});

test('subtypeFromNotes y targetText (ítems de cardio de la plantilla)', () => {
  assert.equal(subtypeFromNotes('run', 'Zona 2'), 'z2');
  assert.equal(subtypeFromNotes('run', 'Z2 suave'), 'z2');
  assert.equal(subtypeFromNotes('run', '6×400 series'), 'intervals');
  assert.equal(subtypeFromNotes('run', 'Tirada larga'), 'long');
  assert.equal(subtypeFromNotes('run', 'Tempo 20 min'), 'tempo');
  assert.equal(subtypeFromNotes('bike', 'Zona 2'), 'easy');
  assert.equal(subtypeFromNotes('bike', 'Rodillo en casa'), 'trainer');
  assert.equal(subtypeFromNotes('other', 'Movilidad'), 'mobility');
  assert.equal(subtypeFromNotes('run', ''), null);
  assert.equal(subtypeFromNotes('swim', 'Zona 2'), null);
  assert.equal(targetText({ timeMin: 1800, timeMax: 2700 }), '30–45 min');
  assert.equal(targetText({ timeMin: 2700 }), '45 min');
  assert.equal(targetText({ timeMin: 1800, timeMax: 1800, distance: 5000 }), '30 min · 5 km');
  assert.equal(targetText({ distance: 400 }), '400 m');
  assert.equal(targetText({ distance: 10550 }), '10,6 km', 'mismo texto que en la plantilla y la sesión');
  assert.equal(targetText(null), '');
});

test('activityTitle', () => {
  assert.equal(activityTitle({ kind: 'bike', subtype: 'route' }), 'Bici · Ruta');
  assert.equal(activityTitle({ kind: 'run' }), 'Carrera');
  assert.equal(activityTitle({ kind: 'swim', poolType: 'pool' }), 'Natación');
});

// ---------------------------------------------------------------------------
// Peso corporal
// ---------------------------------------------------------------------------
const T = '2026-09-23';
const series = (days, start, slopePerDay, from = T) =>
  Array.from({ length: days }, (_, i) => ({ id: addDays(from, -(days - 1) + i), kg: start + slopePerDay * i }));

test('roundKg y puntos válidos', () => {
  assert.equal(roundKg(75.44), 75.4);
  assert.equal(roundKg(75.45), 75.5);
  assert.equal(roundKg(null), null);
  assert.deepEqual(bwPoints([{ id: '2026-09-02', kg: 75 }, { id: 'x', kg: 70 }, { id: '2026-09-01', kg: 0 }, { id: '2026-09-01', kg: 74 }]),
    [{ date: '2026-09-01', value: 74 }, { date: '2026-09-02', value: 75 }]);
});

test('bwStats: sin datos', () => {
  const s = bwStats([], T);
  assert.equal(s.count, 0);
  assert.equal(s.ma7, null);
  assert.equal(s.trend.ok, false);
});

test('bwStats: media móvil de 7 días en el último pesaje', () => {
  const list = [
    { id: '2026-09-10', kg: 80 }, // fuera de la ventana de 7 días
    { id: '2026-09-18', kg: 75 },
    { id: '2026-09-20', kg: 76 },
    { id: '2026-09-23', kg: 75.4 },
  ];
  const s = bwStats(list, T);
  assert.equal(s.count, 4);
  assert.deepEqual(s.last, { date: '2026-09-23', kg: 75.4 });
  assert.equal(s.ma7Date, '2026-09-23');
  assert.equal(s.ma7N, 3);
  assert.ok(Math.abs(s.ma7 - (75 + 76 + 75.4) / 3) < 1e-9);
  assert.equal(s.trend.ok, false); // 4 pesajes pero solo 13 días de la ventana
});

test('bwTrend: pendiente de la media móvil en 28 días (kg/semana)', () => {
  const list = series(28, 74, 0.05); // +0,35 kg/semana
  const s = bwStats(list, T);
  assert.equal(s.trend.ok, true);
  assert.equal(s.trend.n, 28);
  assert.equal(s.trend.span, 27);
  assert.ok(Math.abs(s.trend.kgPerWeek - 0.35) < 0.03, `pendiente ${s.trend.kgPerWeek}`);
  assert.equal(trendWord(s.trend.kgPerWeek), 'subiendo');
  // Solo cuenta la ventana de 28 días: datos antiguos no influyen.
  const old = series(20, 90, -0.5, '2026-07-01');
  const s2 = bwStats([...old, ...list], T);
  assert.equal(s2.trend.n, 28);
  // Bajada
  const down = bwStats(series(28, 80, -0.1), T);
  assert.ok(down.trend.kgPerWeek < -0.5);
  assert.equal(trendWord(down.trend.kgPerWeek), 'bajando');
  assert.equal(trendWord(0.01), 'estable');
});

test('bwTrend: datos insuficientes (pocos pesajes o poco rango de fechas)', () => {
  const few = bwStats([{ id: '2026-09-01', kg: 75 }, { id: '2026-09-23', kg: 76 }], T);
  assert.equal(few.trend.ok, false);
  assert.equal(few.trend.n, 2);
  assert.match(few.trend.reason, /al menos 4 pesajes/);
  const short = bwStats(series(10, 75, 0.1), T);
  assert.equal(short.trend.ok, false);
  // Pesajes semanales (4 en 21 días) sí bastan
  const weekly = [0, 7, 14, 21].map((d, i) => ({ id: addDays('2026-09-02', d), kg: 75 + i * 0.3 }));
  const w = bwStats(weekly, T);
  assert.equal(w.trend.ok, true);
  assert.ok(w.trend.kgPerWeek > 0);
  // Ventana relativa a hoy: si no hay pesajes recientes, no hay tendencia
  const ma = movingAverage(series(28, 75, 0.05, '2026-06-30').map((b) => ({ date: b.id, value: b.kg })), 7);
  assert.equal(bwTrend(ma, T).ok, false);
});

test('bwWithDeltas: lista descendente con variación respecto al anterior', () => {
  const out = bwWithDeltas([{ id: '2026-09-21', kg: 75.2 }, { id: '2026-09-20', kg: 75 }, { id: '2026-09-23', kg: 75.4 }]);
  assert.deepEqual(out.map((e) => e.id), ['2026-09-23', '2026-09-21', '2026-09-20']);
  assert.deepEqual(out.map((e) => e.delta), [0.2, 0.2, null]);
});

test('paceWarning: avisa (sin bloquear) de un ritmo de carrera imposible, como 31 min escritos en la casilla de las horas', () => {
  const f = (kind, km, sec) => ({ ...emptyForm(kind, { date: D }), distanceKm: km, movingSec: sec });
  // Nunca un ritmo con horas («6:12:00 /km»): por encima de una hora por km, se dice con palabras
  assert.match(paceWarning(f('run', 5, 31 * 3600)), /^Más de una hora por km: más lento que caminar\. ¿Escribiste los minutos en la casilla de las horas\?$/);
  assert.match(paceWarning(f('run', 5, 2 * 3600)), /^Ritmo de 24:00 \/km: más lento que caminar/);
  assert.match(paceWarning(f('run', 10, 600)), /demasiado rápido para ser real/);
  assert.equal(paceWarning(f('run', 5, 31 * 60)), null);
  assert.equal(paceWarning(f('run', 5, 5 * 1200)), null, '20:00 /km justo aún cuenta');
  assert.equal(paceWarning(f('run', null, 31 * 3600)), null, 'sin distancia no hay ritmo');
  assert.equal(paceWarning(f('hike', 5, 3 * 3600)), null, 'solo carrera: en montaña 30 min/km es normal');
  assert.ok(isValid(f('run', 5, 31 * 3600)), 'se puede guardar igualmente');
});
