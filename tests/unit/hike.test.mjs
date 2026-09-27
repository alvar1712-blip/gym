// Pruebas del senderismo (kind 'hike', docs/MEJORAS.md §1): registro, carga y km propios (separados de la carrera),
// récords, historial, CSV de cardio, panel semanal y objetivos. Hoy = jueves 24 sep 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACTIVITY_KINDS as SEED_KINDS, ACTIVITY_LABEL, ACTIVITY_EMOJI, defaultSettings, SEED_EXERCISES } from '../../js/seed.js';
import * as L from '../../js/activity-logic.js';
import {
  KINDS, DISTANCE_KINDS, weeklySeries, weeklyPoints, enduranceRecords, runPaceSeries, hikePaceSeries, fmtMetric,
  distanceLabel, elevationLabel,
} from '../../js/stats.js';
import { HISTORY_FILTERS, isHistoryFilter, filterSessions, keyStat, sessionSummary, sessionTitle } from '../../js/history-logic.js';
import { cardioCsv, cardioRows, CARDIO_COLUMNS, csvCounts } from '../../js/backup.js';
import { weeklyInsights } from '../../js/insights.js';
import { goalProgress, autoTitle, validateGoal, goalEmoji, GOAL_SPORTS, MIN_KM, DISTANCE_PRESETS, fmtDistance } from '../../js/goals-logic.js';
import { COLORS } from '../../js/charts.js';
import { normalizePlan, planEmoji } from '../../js/plan.js';
import { tsFromDate } from '../../js/util.js';

const TODAY = '2026-09-24';
const W = { w3: '2026-09-07', w4: '2026-09-14', cur: '2026-09-21' };

let seq = 0;
/** Ruta de senderismo tal como la guarda el formulario (buildRecord). */
function hike(date, o = {}) {
  const f = {
    ...L.emptyForm('hike', { date }),
    movingSec: 4 * 3600, elapsedSec: 5 * 3600, distanceKm: 14.2, elevationM: 850, elevationLossM: 830, altMaxM: 2150,
    hrAvg: 118, hrMax: 162, rpe: 6, packKg: 7.5, notes: 'Peñalara',
    ...o,
  };
  return L.buildRecord(f, null, { id: `h${++seq}`, now: tsFromDate(date, 9) });
}
function act(kind, date, { km = null, min = 60, rpe = 5, ...extra } = {}) {
  return {
    id: `a${++seq}`, kind, date, planDate: date, status: 'done', parentId: null, templateId: null, startedAt: null,
    createdAt: tsFromDate(date, 8), movingSec: min * 60, durationMin: min, rpe, distanceKm: km, ...extra,
  };
}
const EXMAP = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const mk = (sessions, over = {}) => ({
  sessions, exercises: EXMAP, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], checkins: [], today: TODAY, ...over,
});

// ---------------------------------------------------------------------------
// Tipo y registro
// ---------------------------------------------------------------------------
test('seed: senderismo tras la natación, con etiqueta y emoji; el formulario lo ofrece como tipo', () => {
  const ids = SEED_KINDS.map((k) => k.id);
  assert.equal(ids.indexOf('hike'), ids.indexOf('swim') + 1);
  assert.deepEqual(SEED_KINDS.find((k) => k.id === 'hike'), { id: 'hike', label: 'Senderismo', emoji: '🥾' });
  assert.equal(ACTIVITY_LABEL.hike, 'Senderismo');
  assert.equal(ACTIVITY_EMOJI.hike, '🥾');
  assert.ok(L.isActivityKind('hike'));
  assert.deepEqual(L.ACTIVITY_KINDS, ['run', 'bike', 'swim', 'hike', 'other']);
  assert.equal(L.KIND_UI.hike.seg, 'Senderismo');
  assert.equal(L.KIND_UI.hike.durLabel, 'Tiempo en movimiento');
  // Sesión libre del calendario con senderismo
  assert.deepEqual(normalizePlan({ kind: 'free', activityKind: 'hike' }), { kind: 'free', label: 'Senderismo', activityKind: 'hike' });
  assert.equal(planEmoji({ kind: 'free', activityKind: 'hike', label: 'Senderismo' }), '🥾');
});

test('buildRecord: registro de senderismo con todos sus campos (contrato §1)', () => {
  const r = hike('2026-09-20');
  assert.equal(r.kind, 'hike');
  assert.equal(r.status, 'done');
  assert.equal(r.date, '2026-09-20');
  assert.equal(r.planDate, '2026-09-20');
  assert.equal(r.movingSec, 14400);
  assert.equal(r.elapsedSec, 18000);
  assert.equal(r.durationMin, 240, 'durationMin = movingSec / 60');
  assert.equal(r.distanceKm, 14.2);
  assert.equal(r.elevationM, 850);
  assert.equal(r.elevationLossM, 830);
  assert.equal(r.altMaxM, 2150);
  assert.equal(r.hrAvg, 118);
  assert.equal(r.hrMax, 162);
  assert.equal(r.rpe, 6);
  assert.equal(r.packKg, 7.5);
  assert.equal(r.notes, 'Peñalara');
  assert.equal(r.templateName, 'Senderismo');
  assert.equal(L.activityTitle(r), 'Senderismo');
  // Lo que no aplica al senderismo se guarda vacío
  for (const k of ['cadence', 'powerAvg', 'powerNp', 'subtype', 'poolType', 'poolLengthM', 'stroke']) assert.equal(r[k], null, k);
  assert.equal(r.feel, '');
  // Ida y vuelta por el formulario
  const f = L.formFromRecord(r);
  for (const k of ['movingSec', 'elapsedSec', 'distanceKm', 'elevationM', 'elevationLossM', 'altMaxM', 'hrAvg', 'hrMax', 'rpe', 'packKg', 'notes']) assert.equal(f[k], r[k], k);
  assert.deepEqual(L.buildRecord(f, r, { now: r.updatedAt }), r);
  // Obligatorios: tipo, fecha y duración
  assert.deepEqual(L.validate({ ...L.emptyForm('hike', { date: '2026-09-20' }) }), ['duration']);
  assert.ok(L.hasContent({ ...L.emptyForm('hike', { date: '2026-09-20' }), packKg: 8 }), 'la mochila cuenta como algo escrito (borrador)');
});

test('cleanField: desnivel redondeado y ≥ 0, altitud (también negativa) y mochila con límites', () => {
  const f = { kind: 'hike' };
  assert.equal(L.cleanField('elevationLossM', 830.6, f), 831);
  assert.equal(L.cleanField('elevationLossM', -5, f), null);
  assert.equal(L.cleanField('elevationLossM', 0, f), 0);
  assert.equal(L.cleanField('altMaxM', 2150.4, f), 2150);
  assert.equal(L.cleanField('altMaxM', -400, f), -400, 'junto al mar Muerto');
  assert.equal(L.cleanField('altMaxM', 12000, f), null);
  assert.equal(L.cleanField('altMaxM', null, f), null);
  assert.equal(L.cleanField('packKg', 7.46, f), 7.5);
  assert.equal(L.cleanField('packKg', 0, f), null);
  assert.equal(L.cleanField('packKg', 150, f), null);
  const r = hike('2026-09-20', { packKg: 0, elevationLossM: null, altMaxM: null });
  assert.equal(r.packKg, null);
  assert.equal(r.elevationLossM, null);
});

test('métrica en vivo: ritmo medio con velocidad y desnivel; carga = minutos × esfuerzo', () => {
  const f = { ...L.emptyForm('hike', { date: '2026-09-20' }), movingSec: 4 * 3600, distanceKm: 12, elevationM: 850 };
  const m = L.primaryMetric(f);
  assert.equal(m.label, 'Ritmo medio');
  assert.equal(m.text, '20:00 /km');
  assert.equal(m.sub, '12 km a 3 km/h · +850 m');
  assert.equal(L.primaryMetric({ ...f, distanceKm: null }).sub, 'Indica distancia y tiempo');
  assert.equal(L.loadInfo({ ...f, rpe: 5 }).text, '1.200');
  assert.equal(L.loadInfo({ ...f, rpe: 5 }).sub, '240 min × esfuerzo 5');
});

test('cambio de tipo: carrera ↔ senderismo conserva desnivel y pulso; natación los pierde', () => {
  const r = hike('2026-09-20');
  const lostSwim = L.fieldsLostOnKindChange(r, 'swim');
  for (const name of ['tiempo total', 'desnivel', 'desnivel negativo', 'altitud máxima', 'FC media', 'FC máxima', 'peso de la mochila']) assert.ok(lostSwim.includes(name), name);
  assert.ok(!lostSwim.includes('distancia'));
  assert.deepEqual(L.fieldsLostOnKindChange(r, 'run'), ['peso de la mochila']);
  const run = L.buildRecord({ ...L.emptyForm('run', { date: '2026-09-20' }), movingSec: 1800, distanceKm: 5, cadence: 170, subtype: 'z2', feel: 'bien', elevationM: 60 }, null, { id: 'r1' });
  assert.deepEqual(L.fieldsLostOnKindChange(run, 'hike'), ['cadencia', 'tipo de sesión «Rodaje / Z2»', 'zona o sensaciones']);
  // Pasar la carrera a senderismo: el desnivel sigue, lo que no aplica se vacía
  const asHike = L.buildRecord({ ...L.formFromRecord(run), kind: 'hike' }, run);
  assert.equal(asHike.kind, 'hike');
  assert.equal(asHike.elevationM, 60);
  assert.equal(asHike.cadence, null);
  assert.equal(asHike.subtype, null);
  assert.equal(asHike.templateName, 'Senderismo');
  // Mismo tipo: se conservan datos que el formulario no pide (p. ej. cadencia de un archivo importado)
  const imported = { ...r, cadence: 95, powerAvg: 120 };
  const edited = L.buildRecord({ ...L.formFromRecord(imported), notes: 'editado' }, imported);
  assert.equal(edited.cadence, 95);
  assert.equal(edited.powerAvg, 120);
  assert.equal(edited.notes, 'editado');
});

// ---------------------------------------------------------------------------
// Estadísticas: carga y km propios
// ---------------------------------------------------------------------------
test('stats: el senderismo es un tipo propio en la carga y tiene su columna de km (separada de la carrera)', () => {
  assert.ok(KINDS.includes('hike'));
  assert.ok(DISTANCE_KINDS.includes('hike'));
  const data = mk([
    act('run', W.cur, { km: 10, min: 50, rpe: 6 }),
    hike(W.cur, { movingSec: 3 * 3600, distanceKm: 12, rpe: 5 }),
    hike('2026-09-22', { movingSec: 2 * 3600, distanceKm: 8, rpe: 4, elevationM: 400 }),
  ]);
  const [row] = weeklySeries(data, W.cur, TODAY);
  assert.equal(row.km.run, 10, 'el senderismo no suma a los km de carrera');
  assert.equal(row.km.hike, 20);
  assert.equal(row.load.run, 300);
  assert.equal(row.load.hike, 180 * 5 + 120 * 4);
  assert.equal(row.load.other, 0, 'ya no cae en «otras»');
  assert.equal(row.loadTotal, 300 + 900 + 480);
  assert.equal(row.minutes.hike, 300);
  assert.equal(row.count.hike, 2);
  assert.equal(row.runPace, 300, 'el ritmo de carrera solo usa carreras');
  assert.deepEqual(row.paced.hike, { km: 20, sec: 5 * 3600 });
  assert.equal(row.labels.km.hike, '20 km');
  assert.equal(row.labels.load.hike, '1.380');
  assert.equal(fmtMetric('km.hike', 12.345), '12,3 km');
  assert.deepEqual(weeklyPoints([row], 'km.hike').map((p) => p.y), [20]);
  assert.deepEqual(weeklyPoints([row], 'load.hike').map((p) => p.label), ['1.380']);
  // Ritmos por actividad: la carrera no ve el senderismo
  assert.deepEqual(runPaceSeries(data).map((p) => p.km), [10]);
  const hp = hikePaceSeries(data);
  assert.deepEqual(hp.map((p) => p.km), [12, 8]);
  assert.equal(hp[0].label, '15:00 /km · 12 km');
  assert.equal(distanceLabel('hike', 14.25), '14,3 km');
  assert.equal(elevationLabel(1250), '+1.250 m');
});

test('récords: mayor distancia y mayor desnivel en senderismo; no cuentan para la carrera', () => {
  const a = hike('2026-08-02', { distanceKm: 18.5, elevationM: 600 });
  const b = hike('2026-08-16', { distanceKm: 11, elevationM: 1250 });
  const c = hike('2026-08-30', { distanceKm: 18.5, elevationM: 1250 }); // empates: cuenta la primera vez
  const d = hike('2026-09-06', { distanceKm: null, elevationM: 300 });
  const e = enduranceRecords(mk([a, b, c, d, act('run', '2026-09-01', { km: 5, min: 25 })]));
  assert.equal(e.hike.count, 4);
  assert.equal(e.hike.longest.sessionId, a.id);
  assert.equal(e.hike.longest.distanceKm, 18.5);
  assert.equal(e.hike.longest.label, '18,5 km');
  assert.equal(e.hike.longest.elevationM, 600);
  assert.equal(e.hike.maxGain.sessionId, b.id);
  assert.equal(e.hike.maxGain.elevationM, 1250);
  assert.equal(e.hike.maxGain.label, '+1.250 m');
  assert.equal(e.hike.maxGain.distanceKm, 11);
  assert.equal(e.run.count, 1);
  assert.equal(e.run.longest.distanceKm, 5, 'una ruta de 18,5 km no es la carrera más larga');
  assert.equal(e.run.best['10k'], null);
  // Sin desnivel no hay récord de desnivel
  assert.equal(enduranceRecords(mk([hike('2026-09-01', { elevationM: null })])).hike.maxGain, null);
  assert.deepEqual(enduranceRecords(mk([])).hike, { count: 0, longest: null, maxGain: null });
});

// ---------------------------------------------------------------------------
// Historial y CSV
// ---------------------------------------------------------------------------
test('historial: filtro «Senderismo», título y dato clave (distancia y desnivel)', () => {
  assert.ok(isHistoryFilter('hike'));
  const f = HISTORY_FILTERS.map((x) => x.value);
  assert.equal(f.indexOf('hike'), f.indexOf('swim') + 1);
  assert.equal(HISTORY_FILTERS.find((x) => x.value === 'hike').label, 'Senderismo');
  const h1 = hike('2026-09-20');
  const list = [h1, act('run', '2026-09-21', { km: 5 }), hike('2026-09-10', { distanceKm: null, elevationM: 500 })];
  assert.deepEqual(filterSessions(list, 'hike').map((s) => s.date), ['2026-09-20', '2026-09-10']);
  assert.deepEqual(filterSessions(list, 'run').map((s) => s.kind), ['run']);
  assert.equal(sessionTitle(h1), 'Senderismo');
  assert.equal(keyStat(h1), '14,2 km · +850 m');
  assert.equal(keyStat(list[2]), '+500 m', 'sin distancia, el desnivel');
  assert.equal(keyStat(hike('2026-09-01', { elevationM: null })), '14,2 km');
  const sum = sessionSummary(h1);
  assert.equal(sum.emoji, '🥾');
  assert.equal(sum.duration, '4 h 00 min');
  assert.equal(sum.load, 'carga 1.440');
  assert.equal(sum.href, `#/activity/${h1.id}`);
});

test('CSV de cardio: columnas de desnivel −, altitud máxima y mochila', () => {
  const headers = CARDIO_COLUMNS.map((c) => c.h);
  for (const hd of ['Desnivel (m)', 'Desnivel − (m)', 'Altitud máx. (m)', 'Mochila (kg)']) assert.ok(headers.includes(hd), hd);
  assert.equal(headers.indexOf('Desnivel − (m)'), headers.indexOf('Desnivel (m)') + 1);
  const run = act('run', '2026-09-21', { km: 10, min: 50, elevationM: 120, elevationLossM: 118, altMaxM: 700, packKg: 3 });
  const csv = cardioCsv([hike('2026-09-20'), run], { excel: true });
  const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean).map((l) => l.split(';'));
  const col = (row, name) => row[headers.indexOf(name)];
  const [, h, r] = lines;
  assert.equal(col(h, 'Tipo'), 'Senderismo');
  assert.equal(col(h, 'Distancia (km)'), '14,2');
  assert.equal(col(h, 'Duración (h:mm:ss)'), '4:00:00');
  assert.equal(col(h, 'Tiempo total (h:mm:ss)'), '5:00:00');
  assert.equal(col(h, 'Desnivel (m)'), '850');
  assert.equal(col(h, 'Desnivel − (m)'), '830');
  assert.equal(col(h, 'Altitud máx. (m)'), '2150');
  assert.equal(col(h, 'Mochila (kg)'), '7,5');
  assert.equal(col(h, 'FC media'), '118');
  assert.equal(col(h, 'Carga'), '1440');
  assert.equal(col(h, 'Notas'), 'Peñalara');
  // Carrera importada con desnivel negativo y altitud: salen; la mochila, solo en senderismo
  assert.equal(col(r, 'Desnivel − (m)'), '118');
  assert.equal(col(r, 'Altitud máx. (m)'), '700');
  assert.equal(col(r, 'Mochila (kg)'), '');
  assert.equal(cardioRows([hike('2026-09-20')])[0].length, CARDIO_COLUMNS.length);
  assert.equal(csvCounts([hike('2026-09-20')]).activities, 1);
});

// ---------------------------------------------------------------------------
// Panel semanal: km de senderismo propios; el aviso de km sigue siendo solo de carrera
// ---------------------------------------------------------------------------
test('panel semanal: «Senderismo» en km y carga; una subida de km de senderismo no avisa como carrera', () => {
  const sessions = [
    act('run', W.w3, { km: 10, min: 50 }),
    act('run', W.w4, { km: 10, min: 50 }),
    hike(W.w3, { distanceKm: 5, movingSec: 3600, rpe: 3 }),
    hike(W.w4, { distanceKm: 20, movingSec: 3600, rpe: 3 }),
  ];
  const r = weeklyInsights(mk(sessions), W.w4);
  const km = r.info.find((m) => m.id === 'km');
  const it = km.items.find((x) => x.kind === 'hike');
  assert.equal(it.label, 'Senderismo');
  assert.equal(it.km, 20);
  assert.equal(it.prevKm, 5);
  assert.equal(km.items.find((x) => x.kind === 'run').km, 10, 'km de carrera sin el senderismo');
  assert.match(km.text, /Senderismo 20 km/);
  const load = r.info.find((m) => m.id === 'load');
  assert.ok(load.items.some((x) => x.kind === 'hike' && x.label === 'Senderismo'));
  assert.equal(r.suggestions.find((m) => m.id === 'runkm-warn'), undefined, '+300 % de senderismo no es un aviso de km de carrera');
});

// ---------------------------------------------------------------------------
// Objetivos de resistencia en senderismo
// ---------------------------------------------------------------------------
test('objetivos: senderismo como deporte de resistencia (distancia; tiempo con aviso)', () => {
  assert.ok(GOAL_SPORTS.some((s) => s.value === 'hike' && s.label === 'Senderismo'));
  assert.ok(MIN_KM.hike > 0);
  assert.deepEqual(DISTANCE_PRESETS.hike, [10, 15, 20, 30]);
  assert.equal(fmtDistance('hike', 20), '20 km');
  const goal = { id: 'g', kind: 'endurance', sport: 'hike', distanceKm: 20, timeSec: null, createdAt: tsFromDate('2026-08-01', 10) };
  assert.equal(autoTitle(goal), 'Ruta de 20 km');
  assert.equal(autoTitle({ ...goal, timeSec: 6 * 3600 }), 'Ruta de 20 km en menos de 6 h');
  assert.equal(goalEmoji(goal), '🥾');
  assert.deepEqual(validateGoal(goal), {});
  assert.ok(validateGoal({ ...goal, distanceKm: 400 }).distanceKm);
  // Las carreras no cuentan para un objetivo de senderismo (ni al revés)
  const sessions = [
    hike('2026-08-10', { distanceKm: 12 }), hike('2026-08-24', { distanceKm: 14 }), hike('2026-09-07', { distanceKm: 16 }),
    hike('2026-09-20', { distanceKm: 18 }), act('run', '2026-09-21', { km: 25, min: 150 }),
  ];
  const p = goalProgress(mk(sessions), goal);
  assert.equal(p.metric, 'distance');
  assert.equal(p.current, 18);
  assert.equal(p.status === 'achieved', false);
  assert.equal(p.progressPct, 90);
  assert.match(p.explanation + p.method, /ruta de senderismo/);
  const done = goalProgress(mk([...sessions, hike('2026-09-23', { distanceKm: 21 })]), goal);
  assert.equal(done.status, 'achieved');
  assert.equal(done.achievedOn, '2026-09-23');
  const runGoal = { ...goal, sport: 'run' };
  assert.equal(goalProgress(mk(sessions), runGoal).current, 25, 'solo la carrera');
  const timed = goalProgress(mk(sessions), { ...goal, timeSec: 6 * 3600 });
  assert.match(timed.warning, /senderismo/);
});

// ---------------------------------------------------------------------------
// Gráficas: color propio
// ---------------------------------------------------------------------------
test('COLORS.hike coincide con el token --act-hike de css/app.css', () => {
  const css = fs.readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8');
  const tok = (css.match(/--act-hike:\s*(#[0-9a-fA-F]{6})/) || [])[1]?.toLowerCase();
  assert.equal(tok, '#2dd4bf');
  assert.equal(COLORS.hike, tok);
});
