// Ronda 11 (bloque 4): configuración del ejercicio («setup»: máquina, polea, agarre, sistema de lastre…).
// Récords, estancamiento y «última vez» solo comparan configuraciones equivalentes; el historial sin configuración no se
// toca ni se inventa; copias JSON y CSV conservan el campo. Hoy = 2026-09-30. Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setupKey, cleanSetup, sessionPRs, lastPerformance, bestsForExercise, detectPRs, setMetrics,
} from '../../js/calc.js';
import { exerciseHistory, exerciseStream, strengthRecords, exerciseRecord, exerciseSummary, exercisesWithHistory } from '../../js/stats.js';
import { progressStatus } from '../../js/progression.js';
import { strengthRows, STRENGTH_COLUMNS, strengthCsv, buildBackupObject } from '../../js/backup.js';
import { defaultSettings, SEED_EXERCISES } from '../../js/seed.js';
import { tsFromDate } from '../../js/util.js';

const TODAY = '2026-09-30';
let seq = 0;
const EX = new Map([
  ['press', { id: 'press', name: 'Press de pecho', logType: 'weight_reps', pattern: 'push_h', category: 'compound', region: 'upper', primary: ['chest'], secondary: [] }],
  ['dom', { id: 'dom', name: 'Dominadas', logType: 'bodyweight', pattern: 'pull_v', category: 'compound', region: 'upper', primary: ['back'], secondary: [] }],
]);
const set = (weight, reps = 5, rir = 1) => ({ id: `st${++seq}`, type: 'effective', weight, reps, rir, done: true, doneAt: 1 });
/** Sesión de fuerza con un ejercicio: `setup` undefined = sin el campo (historial anterior a la ronda 11). */
function ses(date, exerciseId, sets, setup) {
  const id = `s${++seq}`;
  const se = { id: `${id}_e`, exerciseId, exName: exerciseId, sets };
  if (setup !== undefined) se.setup = setup;
  return { id, kind: 'strength', date, status: 'done', startedAt: tsFromDate(date, 18), createdAt: tsFromDate(date, 18), durationMin: 60, rpe: 7, templateName: 'Sesión libre', exercises: [se] };
}
const data = (sessions) => ({ sessions, exercises: EX, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [{ id: '2026-01-01', kg: 80 }], today: TODAY });
const prsOf = (sessions, s, exId = 'press') => {
  const m = sessionPRs(s, sessions, EX, () => 80);
  return s.exercises[0].sets.flatMap((st) => (m.get(st.id) || []).map((p) => `${p.kind}`));
};

test('la configuración se normaliza: sin espacios de más, mayúsculas ni tildes se agrupa igual', () => {
  assert.equal(cleanSetup('  Polea   alta  '), 'Polea alta');
  assert.equal(setupKey('  Polea   ALTA '), setupKey('polea alta'));
  assert.equal(setupKey('Máquina Hammer'), setupKey('maquina hammer'));
  assert.equal(setupKey(null), '');
  assert.equal(setupKey('   '), '');
  assert.equal(cleanSetup('x'.repeat(60)).length, 40);
  assert.notEqual(setupKey('Hammer'), setupKey('Polea'));
});

test('récords: cambiar de máquina no genera un récord falso; con la misma máquina sí, aunque se escriba distinto', () => {
  const legacy = ses('2026-08-01', 'press', [set(100)]); // sin el campo: historial anterior, intacto
  const first = ses('2026-08-08', 'press', [set(110)], 'Hammer'); // otra configuración: referencia nueva
  const better = ses('2026-08-15', 'press', [set(115)], ' hammer '); // misma máquina (otra escritura): récord
  const other = ses('2026-08-22', 'press', [set(130)], 'Polea'); // otra distinta: referencia nueva
  const all = [legacy, first, better, other];
  assert.deepEqual(prsOf(all, legacy), [], 'la primera vez nunca es récord');
  assert.deepEqual(prsOf(all, first), [], 'más peso, pero en otra máquina: no es récord');
  assert.ok(prsOf(all, better).includes('e1rm') && prsOf(all, better).includes('weight'), 'misma máquina: récord');
  assert.deepEqual(prsOf(all, other), [], 'otra máquina más: referencia nueva');
  // Sin configuración en todas: exactamente como antes
  const old = [ses('2026-08-01', 'press', [set(100)]), ses('2026-08-08', 'press', [set(105)])];
  assert.ok(prsOf(old, old[1]).includes('weight'));
});

test('dominadas con peso corporal: el lastre y la asistencia se comparan solo dentro de su configuración', () => {
  const belt = ses('2026-08-01', 'dom', [set(10, 5)], 'Cinturón');
  const assisted = ses('2026-08-08', 'dom', [set(-20, 8)], 'Máquina asistida');
  const beltBetter = ses('2026-08-15', 'dom', [set(12.5, 5)], 'cinturón');
  const all = [belt, assisted, beltBetter];
  assert.deepEqual(prsOf(all, assisted, 'dom'), [], 'asistida con más reps no es récord frente al cinturón');
  assert.ok(prsOf(all, beltBetter, 'dom').includes('weight'));
  // El 1RM no cambia: setMetrics ignora la configuración
  assert.equal(setMetrics(set(10, 5), EX.get('dom'), 80).e1rm, setMetrics(set(10, 5), EX.get('dom'), 80).e1rm);
});

test('historial: cada fila lleva su configuración y los récords van por configuración; el stream es el de la última', () => {
  const a1 = ses('2026-08-01', 'press', [set(100)], 'Hammer');
  const a2 = ses('2026-08-08', 'press', [set(105)], 'Hammer');
  const b1 = ses('2026-08-15', 'press', [set(80)], 'Polea');
  const d = data([a1, a2, b1]);
  const hist = exerciseHistory(d, 'press', { labels: false });
  assert.deepEqual(hist.map((e) => [e.setup, e.prs.length > 0]), [['Hammer', false], ['Hammer', true], ['Polea', false]]);
  assert.deepEqual(exerciseHistory(d, 'press', { labels: false, setup: 'hammer' }).map((e) => e.sessionId), [a1.id, a2.id]);
  assert.deepEqual(exerciseStream(d, 'press').map((e) => e.sessionId), [b1.id], 'la configuración de la última sesión');
  // Sin configuración en ninguna: el stream es todo el historial (no cambia nada)
  const plain = data([ses('2026-08-01', 'press', [set(100)]), ses('2026-08-08', 'press', [set(105)])]);
  assert.equal(exerciseStream(plain, 'press').length, 2);
  assert.equal(exerciseHistory(plain, 'press', { labels: false })[0].setup, null);
});

test('estancamiento: bajar de peso al cambiar de máquina no es un estancamiento; en la misma máquina sí', () => {
  const sessions = [
    ses('2026-08-03', 'press', [set(100)], 'Hammer'), ses('2026-08-10', 'press', [set(102.5)], 'Hammer'), ses('2026-08-17', 'press', [set(105)], 'Hammer'),
    ses('2026-09-07', 'press', [set(80)], 'Polea'), ses('2026-09-14', 'press', [set(82.5)], 'Polea'), ses('2026-09-21', 'press', [set(85)], 'Polea'),
  ];
  const d = data(sessions);
  const ref = '2026-09-28';
  const ex = EX.get('press');
  const mixed = progressStatus({ exercise: ex, history: exerciseHistory(d, 'press', { labels: false }), ref });
  assert.equal(mixed.status, 'stalled', 'mezclando máquinas parece un estancamiento (el problema)');
  const stream = progressStatus({ exercise: ex, history: exerciseStream(d, 'press'), ref });
  assert.equal(stream.status, 'progress', 'en la máquina nueva sí progresa: 80 → 82,5 → 85');
  // Mismo caso en una sola máquina: sigue siendo estancamiento
  const same = data(sessions.map((s) => ({ ...s, exercises: s.exercises.map((e) => ({ ...e, setup: 'Hammer' })) })));
  assert.equal(progressStatus({ exercise: ex, history: exerciseStream(same, 'press'), ref }).status, 'stalled');
});

test('última vez: prefiere la misma configuración y, si no hay, la más reciente de cualquiera', () => {
  const a = ses('2026-08-01', 'press', [set(100)], 'Hammer');
  const b = ses('2026-08-08', 'press', [set(70)], 'Polea');
  const all = [a, b];
  assert.equal(lastPerformance(all, 'press').session, b, 'sin filtro: la más reciente');
  assert.equal(lastPerformance(all, 'press', { setup: 'hammer' }).session, a);
  assert.equal(lastPerformance(all, 'press', { setup: 'Cuerda' }), null, 'filtrada: nadie con esa configuración');
  const legacy = ses('2026-07-01', 'press', [set(90)]);
  assert.equal(lastPerformance([legacy, a], 'press', { setup: '' }).session, legacy, '«sin especificar» es otra configuración');
});

test('Récords: con varias configuraciones sale un récord por configuración; con una sola, como siempre', () => {
  const one = data([ses('2026-08-01', 'press', [set(100)]), ses('2026-08-08', 'press', [set(105)])]);
  const r1 = strengthRecords(one).filter((r) => r.exerciseId === 'press');
  assert.equal(r1.length, 1);
  assert.equal(r1[0].setup, null);
  assert.equal(r1[0].multiSetup, false);
  const multi = data([ses('2026-08-01', 'press', [set(100)], 'Hammer'), ses('2026-08-08', 'press', [set(130)], 'Polea'), ses('2026-08-15', 'press', [set(90)])]);
  const rs = strengthRecords(multi).filter((r) => r.exerciseId === 'press');
  assert.equal(rs.length, 3);
  assert.deepEqual(rs.map((r) => [r.setup, r.bestWeight.value, r.multiSetup]).sort((x, y) => x[1] - y[1]), [[null, 90, true], ['Hammer', 100, true], ['Polea', 130, true]]);
  assert.equal(exerciseRecord(multi, 'press').bestWeight.value, 130, 'exerciseRecord sin opciones: todo el historial, como antes');
  assert.equal(exerciseRecord(multi, 'press', { setup: 'hammer' }).bestWeight.value, 100);
  assert.equal(exerciseSummary(multi, 'press').sessions, 3, 'el resumen cuenta todas las sesiones');
  assert.equal(exercisesWithHistory(multi).find((x) => x.exerciseId === 'press').sessions, 3);
});

test('copias y CSV: la configuración viaja en la copia JSON, el historial sin ella queda igual y el CSV añade una columna al final', () => {
  const withSetup = ses('2026-08-01', 'press', [set(100)], 'Polea alta');
  const legacy = ses('2026-08-08', 'press', [set(100)]);
  const back = JSON.parse(JSON.stringify(buildBackupObject({ app: 'entreno', format: 2, data: { meta: [{ id: 'settings' }], sessions: [withSetup, legacy] } }, 1)));
  assert.equal(back.data.sessions[0].exercises[0].setup, 'Polea alta');
  assert.ok(!('setup' in back.data.sessions[1].exercises[0]), 'no se inventa una configuración en el historial antiguo');
  const rows = strengthRows([withSetup, legacy], EX, defaultSettings(), { bodyweight: [] });
  const col = STRENGTH_COLUMNS.findIndex((c) => c.h === 'Configuración');
  assert.equal(col, STRENGTH_COLUMNS.length - 1, 'la columna nueva va al final: las hojas de cálculo existentes no se desplazan');
  assert.equal(rows[0][col], 'Polea alta');
  assert.equal(rows[1][col], null);
  assert.match(strengthCsv([withSetup], EX, defaultSettings(), { excel: false, bodyweight: [] }), /Configuración\r\n/);
});

test('resumen del periodo: cambiar de máquina no cuenta como récord del periodo (y el progreso no cruza máquinas)', async () => {
  const { periodSummary } = await import('../../js/summary-logic.js');
  const a1 = ses('2026-08-03', 'press', [set(100)], 'Hammer');
  const a2 = ses('2026-08-10', 'press', [set(105)], 'Hammer'); // récord real
  const b1 = ses('2026-08-24', 'press', [set(130)], 'Polea'); // otra máquina: referencia nueva
  const s = periodSummary(data([a1, a2, b1]), { unit: 'month', start: '2026-08-01', today: TODAY });
  const recs = s.records.filter((r) => r.exerciseId === 'press');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].sessionId, a2.id, 'el récord es el de la misma máquina');
});

test('sugerencias: las configuraciones de ese ejercicio, la más reciente primero y sin duplicados por mayúsculas o espacios', async () => {
  const { setupOptions } = await import('../../js/calc.js');
  const sessions = [
    ses('2026-08-01', 'press', [set(100)], 'Hammer'),
    ses('2026-08-08', 'press', [set(70)], 'Polea alta'),
    ses('2026-08-15', 'press', [set(100)], '  hammer '),
    ses('2026-08-20', 'dom', [set(0)], 'Banda'), // otro ejercicio
    ses('2026-08-22', 'press', [set(90)]), // sin configuración: no sugiere nada
  ];
  assert.deepEqual(setupOptions(sessions, 'press'), [
    { key: 'hammer', label: 'hammer', count: 2, lastDate: '2026-08-15' },
    { key: 'polea alta', label: 'Polea alta', count: 1, lastDate: '2026-08-08' },
  ]);
  assert.deepEqual(setupOptions(sessions, 'press', { excludeSessionId: sessions[2].id }).map((o) => o.label), ['Polea alta', 'Hammer']);
  assert.deepEqual(setupOptions([], 'press'), []);
});

test('resumen frente a la anterior: solo compara el mismo ejercicio con la misma configuración', async () => {
  const { compareSessions } = await import('../../js/session-compare.js');
  const mk = (date, w, setup) => ({ ...ses(date, 'press', [set(w)], setup), templateId: 'tpl' });
  const prev = mk('2026-08-01', 100, 'Hammer');
  assert.equal(compareSessions(mk('2026-08-08', 110, 'Hammer'), prev, EX).rows[0].text, '+10 kg');
  assert.equal(compareSessions(mk('2026-08-08', 110, 'hammer '), prev, EX).rows[0].text, '+10 kg', 'misma configuración aunque se escriba distinto');
  assert.equal(compareSessions(mk('2026-08-08', 60, 'Polea'), prev, EX), null, 'otra configuración: no hay comparación que valga');
  assert.equal(compareSessions(mk('2026-08-08', 110), prev, EX), null, 'sin configuración frente a una con ella: tampoco');
  const legacy = mk('2026-08-01', 100);
  assert.equal(compareSessions(mk('2026-08-08', 105), legacy, EX).rows[0].text, '+5 kg', 'sin configuración en ambas: como siempre');
});
