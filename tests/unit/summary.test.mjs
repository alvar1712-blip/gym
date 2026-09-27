// Pruebas de js/summary-logic.js (resúmenes semanal, mensual y anual; MEJORAS §5) con datos construidos a mano.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  periodSummary, periodStart, periodEnd, shiftPeriod, periodTitle, periodName, summaryHref, kindIds, kindInfo,
  delta, deltaInfo, compareLabel, monthGrid, fmtKm, fmtValue, strengthPrDetail, UNITS,
} from '../../js/summary-logic.js';
import { weeklySeries, strengthRecords, enduranceRecords } from '../../js/stats.js';
import { e1rm, sessionLoad, sessionVolume } from '../../js/calc.js';
import { ACTIVITY_KINDS, defaultSettings } from '../../js/seed.js';
import { tsFromDate } from '../../js/util.js';

// ---------------------------------------------------------------------------
// Datos de prueba — hoy = sábado 26 sep 2026
// ---------------------------------------------------------------------------
const TODAY = '2026-09-26';

const EX = {
  bench: { id: 'bench', name: 'Press banca', logType: 'weight_reps', primary: ['chest'], secondary: ['triceps', 'frontdelt'] },
  squat: { id: 'squat', name: 'Sentadilla', logType: 'weight_reps', primary: ['quads', 'glutes'], secondary: [] },
  plank: { id: 'plank', name: 'Plancha', logType: 'time', primary: ['core'], secondary: [] },
};

let seq = 0;
const set = (weight, reps, rir = null, extra = {}) => ({ id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: 1, ...extra });
const warm = (weight, reps) => set(weight, reps, null, { type: 'warmup' });

function ses(id, date, items, extra = {}) {
  return {
    id, kind: 'strength', date, planDate: date, status: 'done', parentId: null, templateId: null, templateName: 'Sesión libre',
    startedAt: tsFromDate(date, 18), createdAt: tsFromDate(date, 18), durationMin: 60, rpe: 7, notes: '',
    exercises: items.map(([exerciseId, sets], i) => ({ id: `${id}_se${i}`, exerciseId, exName: exerciseId, templateItemId: null, sets })),
    ...extra,
  };
}
function act(id, kind, date, extra = {}) {
  const movingSec = 'movingSec' in extra ? extra.movingSec : 3600;
  return {
    id, kind, date, planDate: date, status: 'done', parentId: null, templateId: null, startedAt: null,
    createdAt: tsFromDate(date, extra.hour ?? 8), movingSec, durationMin: movingSec != null ? movingSec / 60 : null, rpe: 5, distanceKm: null, ...extra,
  };
}

function sessions() {
  seq = 0;
  return [
    // Agosto
    ses('s_a1', '2026-08-05', [['bench', [set(80, 5, 2)]], ['squat', [set(100, 5)]]]),
    act('r_a1', 'run', '2026-08-10', { distanceKm: 10, movingSec: 3000 }),
    act('h_a1', 'hike', '2026-08-15', { distanceKm: 12, movingSec: 14400, elevationM: 600, rpe: 4 }),
    ses('s_a2', '2026-08-20', [['bench', [set(82.5, 5, 2)]]]),
    act('r_a2', 'run', '2026-08-28', { distanceKm: 12, movingSec: 3720 }),
    // Septiembre (en curso)
    ses('s_s1', '2026-09-02', [['bench', [warm(40, 8), set(85, 5, 2), set(85, 5, 1)]], ['squat', [set(100, 6, 2)]]]),
    act('r_s1', 'run', '2026-09-06', { distanceKm: 5, movingSec: 1400 }),
    act('b_s1', 'bike', '2026-09-12', { distanceKm: 40, movingSec: 5400 }),
    ses('s_s2', '2026-09-16', [['bench', [set(87.5, 4, 1)]], ['plank', [set(null, null, null, { timeSec: 60 })]]]),
    act('r_link', 'run', '2026-09-16', { distanceKm: 3, movingSec: 900, rpe: 6, parentId: 's_s2', parentItemId: 's_s2_se9', hour: 19 }),
    act('h_s1', 'hike', '2026-09-19', { distanceKm: 15, movingSec: 18000, elevationM: 900, rpe: 4 }),
    act('r_s2', 'run', '2026-09-20', { distanceKm: 14, movingSec: 4200 }),
    act('y_s1', 'yoga', '2026-09-22', { movingSec: null, durationMin: 45, rpe: 3 }),
    act('o_s1', 'other', '2026-09-23', { movingSec: null, durationMin: 60, rpe: 7, subtype: 'basketball' }),
    ses('s_active', '2026-09-25', [['bench', [set(90, 5, 0)]]], { status: 'active' }),
    act('r_nodone', 'run', '2026-09-24', { distanceKm: 50, status: 'active' }),
  ];
}
const exMap = () => new Map(Object.values(EX).map((e) => [e.id, e]));
function mk(over = {}) {
  return { sessions: sessions(), exercises: exMap(), templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], today: TODAY, ...over };
}
const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) < eps, msg || `${a} ≠ ${b}`);
const byId = (data, id) => data.sessions.find((s) => s.id === id);

// ---------------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------------

test('periodos: semana de lunes a domingo, meses y años naturales con fechas locales', () => {
  assert.deepEqual(UNITS, ['week', 'month', 'year']);
  assert.equal(periodStart('week', '2026-09-26'), '2026-09-21');
  assert.equal(periodEnd('week', '2026-09-26'), '2026-09-27');
  assert.equal(periodStart('week', '2026-09-21'), '2026-09-21');
  assert.equal(periodEnd('week', '2026-09-27'), '2026-09-27');
  assert.equal(periodStart('month', '2026-09-26'), '2026-09-01');
  assert.equal(periodEnd('month', '2026-09-26'), '2026-09-30');
  assert.equal(periodEnd('month', '2024-02-10'), '2024-02-29', 'bisiesto');
  assert.equal(periodEnd('month', '2026-02-10'), '2026-02-28');
  assert.equal(periodEnd('month', '2026-12-05'), '2026-12-31');
  assert.equal(periodStart('year', '2026-09-26'), '2026-01-01');
  assert.equal(periodEnd('year', '2026-09-26'), '2026-12-31');
  assert.equal(shiftPeriod('month', '2026-01-15', -1), '2025-12-01');
  assert.equal(shiftPeriod('month', '2026-12-15', 1), '2027-01-01');
  assert.equal(shiftPeriod('month', '2026-09-30', -7), '2026-02-01');
  assert.equal(shiftPeriod('week', '2026-09-26', -1), '2026-09-14');
  assert.equal(shiftPeriod('week', '2026-01-01', -1), '2025-12-22', 'semana a caballo entre años');
  assert.equal(shiftPeriod('year', '2026-09-26', -1), '2025-01-01');
  assert.equal(periodTitle('month', '2026-09-26'), 'Septiembre 2026');
  assert.equal(periodTitle('year', '2026-09-26'), '2026');
  assert.equal(periodTitle('week', '2026-09-26'), 'Semana 21–27 sep');
  assert.equal(periodName('month', '2026-09-26'), 'septiembre de 2026');
  assert.equal(summaryHref('year', '2026-09-26'), '#/summary?p=year&d=2026-09-26');
  assert.equal(summaryHref('month', '2026-09-01'), '#/summary?p=month&d=2026-09-01');
});

test('monthGrid: cuadrícula lunes–domingo con los días entrenados', () => {
  const g = monthGrid('2026-09-10', [{ date: '2026-09-02', kinds: ['strength'] }, { date: '2026-09-16', kinds: ['strength', 'run'] }], TODAY);
  assert.equal(g.length, 5);
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g[0][0].date, null, 'el 1 de sep de 2026 es martes: un hueco');
  assert.equal(g[0][1].date, '2026-09-01');
  assert.deepEqual(g[0][2].kinds, ['strength']);
  const cells = g.flat().filter((c) => c.date);
  assert.equal(cells.length, 30);
  assert.deepEqual(cells.find((c) => c.date === '2026-09-16').kinds, ['strength', 'run']);
  assert.ok(cells.find((c) => c.date === TODAY).today);
  assert.ok(cells.find((c) => c.date === '2026-09-27').future);
  assert.ok(!cells.find((c) => c.date === '2026-09-25').future);
});

// ---------------------------------------------------------------------------
// Tipos de sesión
// ---------------------------------------------------------------------------

test('tipos: los de seed.ACTIVITY_KINDS (senderismo incluido), los que aparezcan en los datos y «otras» al final', () => {
  const seedIds = ACTIVITY_KINDS.map((a) => a.id).filter((k) => k !== 'other');
  assert.deepEqual(kindIds([]), [...seedIds, 'other']);
  const ids = kindIds(sessions());
  assert.equal(ids[ids.length - 1], 'other');
  assert.ok(ids.includes('hike'), 'senderismo');
  assert.ok(ids.includes('yoga'), 'un tipo que solo está en los datos');
  assert.ok(ids.indexOf('yoga') > ids.indexOf('swim'));
  assert.deepEqual(kindInfo('run'), { id: 'run', label: 'Carrera', emoji: '🏃' });
  assert.equal(kindInfo('other').label, 'Otras actividades');
  assert.equal(kindInfo('yoga').label, 'Yoga');
  assert.ok(kindInfo('yoga').emoji);
});

// ---------------------------------------------------------------------------
// Totales del periodo
// ---------------------------------------------------------------------------

test('mes en curso: totales por deporte, días, carga, fuerza y series por músculo', () => {
  const data = mk();
  const s = periodSummary(data, { unit: 'month', start: '2026-09-10' });
  assert.equal(s.unit, 'month');
  assert.equal(s.start, '2026-09-01');
  assert.equal(s.end, '2026-09-30');
  assert.equal(s.prevStart, '2026-08-01');
  assert.equal(s.prevEnd, '2026-08-31');
  assert.equal(s.title, 'Septiembre 2026');
  assert.equal(s.inProgress, true);
  assert.equal(s.future, false);
  assert.equal(s.daysTotal, 30);
  assert.equal(s.daysElapsed, 26);
  assert.equal(s.daysLeft, 5);
  assert.equal(s.hasHistory, true);
  assert.equal(s.empty, false);

  const sepDone = ['s_s1', 'r_s1', 'b_s1', 's_s2', 'r_link', 'h_s1', 'r_s2', 'y_s1', 'o_s1'].map((id) => byId(data, id));
  assert.equal(s.sessions, 9, 'solo terminadas; la actividad enlazada cuenta en su deporte');
  assert.equal(s.days, 8, 'fechas distintas (fuerza + carrera enlazada el mismo día = 1)');
  const loadOf = (ids) => ids.reduce((t, id) => t + sessionLoad(byId(data, id)), 0);
  assert.equal(s.load, sepDone.reduce((t, x) => t + sessionLoad(x), 0));
  assert.equal(s.noLoad, 0);

  // Todas las clases, con ceros incluidos
  for (const k of kindIds(data.sessions)) assert.ok(s.byKind[k], `byKind.${k}`);
  assert.deepEqual(s.kinds, ['strength', 'run', 'bike', 'hike', 'yoga', 'other']);
  assert.equal(s.byKind.swim.count, 0);
  const run = s.byKind.run;
  assert.equal(run.count, 3);
  close(run.km, 22);
  close(run.minutes, (1400 + 900 + 4200) / 60, 0.01);
  assert.equal(run.load, loadOf(['r_s1', 'r_link', 'r_s2']));
  assert.equal(s.byKind.bike.count, 1);
  close(s.byKind.bike.km, 40);
  const hike = s.byKind.hike;
  assert.equal(hike.count, 1);
  close(hike.km, 15);
  close(hike.minutes, 300);
  assert.equal(hike.load, 1200);
  assert.equal(hike.elevationM, 900);
  assert.equal(s.byKind.yoga.count, 1);
  assert.equal(s.byKind.yoga.load, 135);
  assert.equal(s.byKind.other.count, 1);
  assert.equal(s.byKind.other.load, 420);
  assert.equal(s.byKind.strength.count, 2);
  assert.equal(s.byKind.strength.minutes, 120);
  assert.equal(s.byKind.strength.km, 0);

  // Fuerza: sin calentamientos ni sesiones activas
  assert.equal(s.strength.sessions, 2);
  assert.equal(s.strength.workSets, 5, '2 banca + 1 sentadilla + 1 banca + 1 plancha');
  const vol = sessionVolume(byId(data, 's_s1'), data.exercises) + sessionVolume(byId(data, 's_s2'), data.exercises);
  close(s.strength.volume, vol, 0.01);
  close(s.strength.volume, 85 * 5 * 2 + 100 * 6 + 87.5 * 4, 0.01);
  assert.equal(s.strength.muscleSets.chest, 3);
  assert.equal(s.strength.muscleSets.triceps, 1.5);
  assert.equal(s.strength.muscleSets.quads, 1);
  assert.equal(s.strength.muscleSets.core, 1);
  assert.equal(s.strength.muscles[0].muscleId, 'chest', 'de más a menos series');
  const chest = s.strength.muscles[0];
  assert.equal(chest.name, 'Pecho');
  close(chest.perWeek, 3 / (26 / 7), 0.06);
  assert.ok(Array.isArray(chest.target) && chest.target.length === 2, 'rango de Ajustes');
  assert.equal(s.trainedDates.length, 8);
  assert.deepEqual(s.trainedDates.find((t) => t.date === '2026-09-16').kinds, ['strength', 'run']);
});

test('coincide con stats.weeklySeries (misma carga, minutos, volumen, series y km por semana)', () => {
  const data = mk();
  for (const ws of ['2026-08-03', '2026-08-10', '2026-09-14', '2026-09-21']) {
    const s = periodSummary(data, { unit: 'week', start: ws });
    const [row] = weeklySeries(data, ws, ws);
    assert.equal(s.load, row.loadTotal, `carga ${ws}`);
    close(s.minutes, row.minutesTotal, 0.02);
    close(s.strength.volume, row.strengthVolume, 0.01);
    assert.equal(s.strength.workSets, row.workSets);
    for (const k of ['run', 'bike', 'swim', 'hike']) close(s.byKind[k].km, row.km[k], 1e-6, `km.${k} ${ws}`);
    for (const k of ['strength', 'run', 'bike', 'swim', 'hike']) assert.equal(s.byKind[k].count, row.count[k], `sesiones ${k} ${ws}`);
    assert.equal(s.byKind.other.count + (s.byKind.yoga?.count || 0), row.count.other, 'lo desconocido es «otra» en stats');
  }
});

// ---------------------------------------------------------------------------
// Comparación
// ---------------------------------------------------------------------------

test('comparación: en curso con el mismo tramo del anterior; terminado con el periodo entero', () => {
  const data = mk();
  const s = periodSummary(data, { unit: 'month' });
  const c = s.compare;
  assert.equal(c.available, true);
  assert.equal(c.partial, true);
  assert.equal(c.start, '2026-08-01');
  assert.equal(c.end, '2026-08-26', 'hasta el mismo día del mes');
  assert.equal(c.label, 'Frente al mismo tramo de agosto (1–26 ago)');
  assert.deepEqual(c.sessions, { cur: 9, prev: 4, delta: 5, pct: 125 });
  assert.equal(c.days.prev, 4);
  assert.equal(c.prevTotals.sessions, 5, 'agosto completo, con la carrera del 28');
  assert.equal(c.strengthSessions.prev, 2);
  // Por deporte: solo los que tienen sesiones en alguno de los dos
  assert.deepEqual(Object.keys(c.kinds), ['strength', 'run', 'bike', 'hike', 'yoga', 'other']);
  assert.deepEqual(c.kinds.run.km, { cur: 22, prev: 10, delta: 12, pct: 120 });
  assert.equal(c.kinds.bike.count.pct, null, 'sin % frente a 0');
  assert.equal(c.kinds.yoga.km, null, 'sin distancia en ninguno');
  assert.deepEqual(c.kinds.hike.km, { cur: 15, prev: 12, delta: 3, pct: 25 });

  const aug = periodSummary(data, { unit: 'month', start: '2026-08-31' });
  assert.equal(aug.inProgress, false);
  assert.equal(aug.compare.partial, false);
  assert.equal(aug.compare.end, '2026-07-31');
  assert.equal(aug.compare.available, false, 'antes de agosto no hay registros');
  assert.equal(aug.compare.label, 'Frente a julio');
  assert.equal(aug.sessions, 5);

  // Año en curso: hasta el mismo día del año anterior
  const y = periodSummary(data, { unit: 'year' });
  assert.equal(y.compare.end, '2025-09-26');
  assert.equal(y.compare.label, 'Frente a 2025 hasta el 26 sep');
  assert.equal(y.compare.available, false);
  assert.equal(y.months.length, 12);
  assert.equal(y.months[7].sessions, 5);
  assert.equal(y.months[8].sessions, 9);
  assert.equal(y.months[8].inProgress, true);
  assert.equal(y.months[9].future, true);
  assert.equal(y.sessions, 14);

  // Semana en curso (sábado): lunes → sábado de la anterior
  const w = periodSummary(data, { unit: 'week' });
  assert.equal(w.start, '2026-09-21');
  assert.equal(w.compare.end, '2026-09-19');
  assert.equal(w.compare.label, 'Frente a la semana anterior hasta el sábado');
  assert.equal(w.compare.sessions.prev, 3, 'lun 14 – sáb 19: fuerza, carrera enlazada y senderismo (sin la carrera del domingo)');
  assert.equal(w.compare.prevTotals.sessions, 4);
  // El último día del periodo ya compara con el anterior entero
  const lastDay = periodSummary(data, { unit: 'month', today: '2026-09-30' });
  assert.equal(lastDay.inProgress, true);
  assert.equal(lastDay.compare.partial, false);
  assert.equal(lastDay.compare.end, '2026-08-31');
  assert.equal(compareLabel(lastDay), 'Frente a agosto');
  // Mes de otro año en la etiqueta
  const jan = periodSummary(data, { unit: 'month', start: '2027-01-10', today: '2027-01-10' });
  assert.equal(jan.compare.label, 'Frente al mismo tramo de diciembre de 2026 (1–10 dic)');
});

test('delta y deltaInfo: flecha, signo y % con texto; sin % frente a 0', () => {
  assert.deepEqual(delta(12, 10), { cur: 12, prev: 10, delta: 2, pct: 20 });
  assert.deepEqual(delta(0, 4), { cur: 0, prev: 4, delta: -4, pct: -100 });
  assert.equal(delta(3, 0).pct, null);
  let i = deltaInfo(delta(12, 10));
  assert.equal(i.dir, 'up');
  assert.equal(i.arrow, '▲');
  assert.equal(i.text, '+2 (+20 %)');
  assert.match(i.words, /sube 2, un 20 %/);
  i = deltaInfo(delta(9, 10));
  assert.equal(i.dir, 'down');
  assert.equal(i.arrow, '▼');
  assert.equal(i.text, '−1 (−10 %)');
  assert.equal(deltaInfo(delta(3, 0)).text, '+3 (antes 0)');
  assert.equal(deltaInfo(delta(5, 5)).dir, 'same');
  assert.equal(deltaInfo(delta(5, 5)).text, 'igual');
  assert.equal(deltaInfo(delta(0, 0)).dir, 'none');
  assert.equal(deltaInfo(null).dir, 'none');
  assert.equal(deltaInfo(delta(100.2, 100), (v) => String(Math.round(v))).dir, 'same', 'diferencia que redondea a 0');
  assert.equal(deltaInfo(delta(201, 200)).text, '+1 (+0,5 %)', 'menos de 1 %: con un decimal');
  assert.equal(deltaInfo(delta(130, 65), (v) => fmtValue('minutes', v)).text, '+1 h 05 min (+100 %)');
  assert.equal(deltaInfo(delta(2.5, 1.5), (v) => fmtKm('swim', v)).text, '+1.000 m (+67 %)');
});

test('formato: km (natación en metros) y valores del resumen', () => {
  assert.equal(fmtKm('run', 42.195), '42,2 km');
  assert.equal(fmtKm('hike', 15), '15 km');
  assert.equal(fmtKm('swim', 3.2), '3.200 m');
  assert.equal(fmtValue('minutes', 245), '4 h 05 min');
  assert.equal(fmtValue('volume', 12500.4), '12.500 kg');
  assert.equal(fmtValue('load', 1250), '1.250');
  assert.equal(fmtValue('km', 3.2, 'swim'), '3.200 m');
});

// ---------------------------------------------------------------------------
// Récords y progreso
// ---------------------------------------------------------------------------

test('récords del periodo: fuerza (uno por ejercicio) y resistencia (distancia, 5 km, senderismo: distancia y desnivel)', () => {
  const data = mk();
  const s = periodSummary(data, { unit: 'month' });
  const labels = s.records.map((r) => r.label);
  assert.deepEqual(labels, [
    'Carrera · mayor distancia', // 20 sep
    'Senderismo · mayor distancia', // 19 sep
    'Senderismo · mayor desnivel', // 19 sep
    'Carrera · 5 km', // 6 sep
    'Press banca', // 2 sep
    'Sentadilla', // 2 sep
  ]);
  const bench = s.records.find((r) => r.exerciseId === 'bench');
  assert.equal(bench.type, 'strength');
  assert.equal(bench.date, '2026-09-02', 'la sesión con récord de 1RM (el mejor del periodo)');
  assert.equal(bench.sessionId, 's_s1');
  assert.equal(bench.count, 2, 'dos sesiones con récord (1RM y peso; después peso)');
  assert.equal(bench.detail, '1RM est. 104,8 kg (85 kg × 5 @2)');
  assert.equal(s.records.find((r) => r.exerciseId === 'squat').detail, '1RM est. 126,7 kg (100 kg × 6 @2)');
  const longest = s.records[0];
  assert.equal(longest.type, 'endurance');
  assert.equal(longest.sessionId, 'r_s2');
  assert.equal(longest.detail, '14 km en 1:10:00');
  assert.equal(longest.prev, 12);
  assert.equal(s.records[2].detail, '+900 m · 15 km');
  assert.equal(s.records[3].detail, '23:20 · 4:40 /km');
  // La primera vez (bici) no es récord; los récords de agosto no salen en septiembre
  assert.ok(!s.records.some((r) => r.kind === 'bike'));
  const aug = periodSummary(data, { unit: 'month', start: '2026-08-01' });
  assert.deepEqual(aug.records.map((r) => r.label), ['Carrera · mayor distancia', 'Press banca']);
  // Coherente con las mejores marcas de Progreso
  const er = enduranceRecords(data);
  assert.equal(er.run.longest.sessionId, longest.sessionId);
  assert.equal(er.hike.maxGain.sessionId, 'h_s1');
  const sr = strengthRecords(data).find((r) => r.exerciseId === 'bench');
  assert.ok(sr, 'press banca en los récords de fuerza de Progreso');
});

test('strengthPrDetail: peso, repeticiones, tiempo y saltos', () => {
  const s1 = set(90, 3, 2);
  assert.equal(strengthPrDetail({ logType: 'weight_reps', prs: [{ kind: 'weight', value: 90, set: s1 }] }), 'peso 90 kg × 3 @2');
  assert.equal(strengthPrDetail({ logType: 'weight_reps', prs: [{ kind: 'reps', value: 9, weight: 60, set: set(60, 9) }] }), '9 reps con 60 kg');
  assert.equal(strengthPrDetail({ logType: 'time', prs: [{ kind: 'time', value: 90, set: set(null, null, null, { timeSec: 90 }) }] }), '1:30 min');
  assert.equal(strengthPrDetail({ logType: 'jumps', prs: [{ kind: 'height', value: 45, set: set(null, 3) }] }), 'salto de 45 cm');
  assert.equal(strengthPrDetail({ logType: 'distance_time', prs: [{ kind: 'time', value: 3.2, distanceM: 20, set: set(null, null) }] }), '20 m en 3,2 s');
});

test('ejercicios que más progresan: 1RM estimado del inicio al mejor del periodo; solo subidas, por %', () => {
  const data = mk();
  const s = periodSummary(data, { unit: 'month' });
  assert.deepEqual(s.topProgress.map((p) => p.exerciseId), ['squat', 'bench']);
  const sq = s.topProgress[0];
  assert.equal(sq.basis, 'prev', 'última sesión del mes anterior');
  assert.equal(sq.fromDate, '2026-08-05');
  close(sq.from, e1rm(100, 5), 0.01);
  close(sq.to, e1rm(100, 6, 2), 0.01);
  close(sq.delta, e1rm(100, 6, 2) - e1rm(100, 5), 0.01);
  close(sq.pct, ((e1rm(100, 6, 2) - e1rm(100, 5)) / e1rm(100, 5)) * 100, 0.1);
  const b = s.topProgress[1];
  assert.equal(b.fromDate, '2026-08-20', 'la última del mes anterior, no la mejor');
  close(b.from, e1rm(82.5, 5, 2), 0.01);
  close(b.to, e1rm(85, 5, 2), 0.01);
  assert.equal(b.toDate, '2026-09-02');
  assert.equal(b.sessions, 2);
  assert.equal(s.progressTotal, 2);
  // Sin sesión en el periodo anterior: desde la primera del periodo
  const aug = periodSummary(data, { unit: 'month', start: '2026-08-01' });
  assert.equal(aug.topProgress.length, 1);
  assert.equal(aug.topProgress[0].exerciseId, 'bench');
  assert.equal(aug.topProgress[0].basis, 'first');
  assert.equal(aug.topProgress[0].fromDate, '2026-08-05');
  // maxProgress
  assert.equal(periodSummary(data, { unit: 'month', maxProgress: 1 }).topProgress.length, 1);
  // Bajadas: no salen
  const worse = mk();
  worse.sessions.push(ses('s_o1', '2026-10-05', [['bench', [set(60, 5, 3)]]]));
  const oct = periodSummary(worse, { unit: 'month', start: '2026-10-01', today: '2026-10-10' });
  assert.equal(oct.topProgress.length, 0);
});

// ---------------------------------------------------------------------------
// Estados: vacío, futuro, antes del primer registro, navegación
// ---------------------------------------------------------------------------

test('estados: sin datos, periodo vacío, futuro y anterior al primer registro; navegación sin pasar del actual', () => {
  const empty = periodSummary({ sessions: [], exercises: new Map(), settings: defaultSettings(), bodyweight: [], today: TODAY }, { unit: 'month' });
  assert.equal(empty.hasHistory, false);
  assert.equal(empty.empty, true);
  assert.equal(empty.sessions, 0);
  assert.equal(empty.compare.available, false);
  assert.deepEqual(empty.records, []);
  assert.deepEqual(empty.nav, { prev: null, next: null, current: '2026-09-01' });
  assert.ok(Object.values(empty.byKind).every((b) => b.count === 0 && b.km === 0 && b.load === 0));

  const data = mk();
  const cur = periodSummary(data, { unit: 'month' });
  assert.deepEqual(cur.nav, { prev: '2026-08-01', next: null, current: '2026-09-01' });
  const aug = periodSummary(data, { unit: 'month', start: '2026-08-12' });
  assert.equal(aug.nav.prev, null, 'agosto es el primer mes con datos');
  assert.equal(aug.nav.next, '2026-09-01');
  const july = periodSummary(data, { unit: 'month', start: '2026-07-01' });
  assert.equal(july.beforeHistory, true);
  assert.equal(july.firstDate, '2026-08-05');
  const fut = periodSummary(data, { unit: 'month', start: '2026-11-03' });
  assert.equal(fut.future, true);
  assert.equal(fut.daysElapsed, 0);
  assert.equal(fut.compare.available, false);
  const y = periodSummary(data, { unit: 'year', start: '2026-03-01' });
  assert.equal(y.start, '2026-01-01');
  assert.deepEqual(y.nav, { prev: null, next: null, current: '2026-01-01' });

  // Periodo vacío entre registros: último antes y siguiente después
  const gap = mk();
  gap.sessions.push(act('r_nov', 'run', '2026-11-04', { distanceKm: 8 }));
  const oct = periodSummary(gap, { unit: 'month', start: '2026-10-01', today: '2026-11-10' });
  assert.equal(oct.empty, true);
  assert.equal(oct.beforeHistory, false);
  assert.equal(oct.lastBefore, '2026-09-23');
  assert.equal(oct.nextAfter, '2026-11-04');
});

test('la caché por objeto `data` no mezcla datos: un objeto nuevo con más sesiones da otros totales', () => {
  const data = mk();
  assert.equal(periodSummary(data, { unit: 'month' }).sessions, 9);
  const more = { ...data, sessions: [...data.sessions, act('sw1', 'swim', '2026-09-24', { distanceKm: 1.5, movingSec: 2400 })] };
  const s = periodSummary(more, { unit: 'month' });
  assert.equal(s.sessions, 10);
  close(s.byKind.swim.km, 1.5);
  assert.equal(periodSummary(data, { unit: 'month' }).sessions, 9);
});
