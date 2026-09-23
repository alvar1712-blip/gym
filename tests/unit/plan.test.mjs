// Pruebas de la lógica pura del calendario (js/plan.js) y del historial (js/history-logic.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patternFor, patternDay, effectiveDay, daySessions, completeness, dayStatus, weekPlan, adherence, adherenceText,
  STATUS_LABEL, planLabel, planEmoji, makeCtx, samePlan, normalizePlan, monthWeeks, trackingSince,
  recordWithPlan, recordWithStatus, recordWithoutPlan, swapRecords, MISSING_TEMPLATE_LABEL,
} from '../../js/plan.js';
import {
  filterSessions, groupByMonth, keyStat, sessionTitle, sessionSummary, workSets, monthLabel,
} from '../../js/history-logic.js';
import { defaultSettings, SEED_TEMPLATES, TEMPLATE_IDS } from '../../js/seed.js';
import { deepClone } from '../../js/util.js';

// Semana del lunes 21 al domingo 27 de septiembre de 2026; «hoy» = miércoles 23.
const WS = '2026-09-21';
const MON = '2026-09-21';
const TUE = '2026-09-22';
const WED = '2026-09-23';
const THU = '2026-09-24';
const FRI = '2026-09-25';
const SAT = '2026-09-26';
const SUN = '2026-09-27';
const NEXT_SAT = '2026-10-03';
const TODAY = WED;

const T0 = 1_000; // las plantillas se crearon en T0; las sesiones, después
const templates = () => SEED_TEMPLATES.map((t) => ({ ...deepClone(t), archived: false, createdAt: T0, updatedAt: T0 }));
const tplMap = () => new Map(templates().map((t) => [t.id, t]));
const WORK = { type: 'effective', done: true, weight: 50, reps: 5 };

/** Sesión de fuerza de una plantilla; `skip` = índices de ítems sin series de trabajo. */
function strength(id, templateId, date, { planDate = date, skip = [], status = 'done', createdAt = 5_000, drop = [] } = {}) {
  const tpl = SEED_TEMPLATES.find((t) => t.id === templateId);
  return {
    id, kind: 'strength', date, planDate, templateId, templateName: tpl ? tpl.name : 'Sesión libre', status,
    parentId: null, createdAt, startedAt: createdAt, durationMin: 60, rpe: 7,
    exercises: (tpl ? tpl.items : []).map((it, i) => ({
      id: `${id}_se${i}`, exerciseId: it.exerciseId, exName: `Ej ${i}`, templateItemId: it.id,
      sets: skip.includes(i) ? [{ ...WORK, type: 'warmup' }] : [{ ...WORK }],
    })).filter((_, i) => !drop.includes(i)),
  };
}
const activity = (id, kind, date, extra = {}) => ({
  id, kind, date, planDate: date, status: 'done', parentId: null, createdAt: 6_000, movingSec: 3600, durationMin: 60, rpe: 5, ...extra,
});

function ctx({ sessions = [], plan = [], settings = defaultSettings(), tpls = tplMap(), today = TODAY, since = null } = {}) {
  return makeCtx({ settings, plan, sessions, templates: tpls, today, since });
}

// ---------------------------------------------------------------------------
// Semana tipo y plan efectivo
// ---------------------------------------------------------------------------

test('semana tipo por defecto: L D1 · M D2 · X D3 · J D4 · V descanso · S D6 · D descanso', () => {
  const c = ctx();
  const labels = weekPlan(WS, c).map((d) => (d.plan.kind === 'template' ? d.plan.templateId : d.plan.kind));
  assert.deepEqual(labels, ['tpl_d1', 'tpl_d2', 'tpl_d3', 'tpl_d4', 'rest', 'tpl_d6', 'rest']);
  assert.equal(effectiveDay(MON, c).label, 'Día 1 — Upper pesado');
  assert.equal(effectiveDay(FRI, c).label, 'Descanso');
  assert.equal(effectiveDay(SAT, c).source, 'pattern');
  assert.equal(effectiveDay(SAT, c).substituted, false);
});

test('vigencias de la semana tipo: manda la de mayor «from» ≤ fecha', () => {
  const s = defaultSettings();
  const days = deepClone(s.weekPatterns[0].days);
  days[5] = { kind: 'template', templateId: TEMPLATE_IDS.d1 }; // desde el 28 sep, sábado = D1
  s.weekPatterns.push({ from: '2026-09-28', days });
  assert.equal(patternDay(s, SAT).templateId, 'tpl_d6');
  assert.equal(patternDay(s, NEXT_SAT).templateId, 'tpl_d1');
  // Fecha anterior a todas las vigencias → la primera.
  const s2 = { weekPatterns: [{ from: '2026-09-28', days }] };
  assert.equal(patternFor(s2, '2020-01-01'), days);
  // Sin vigencias → todo descanso.
  assert.equal(patternDay({ weekPatterns: [] }, MON).kind, 'rest');
});

test('excepción: cambia el plan de ese día; igual a la semana tipo → no cuenta como cambio', () => {
  const bike = { id: SAT, kind: 'free', label: 'Ruta en bici', activityKind: 'bike' };
  const e = effectiveDay(SAT, ctx({ plan: [bike] }));
  assert.equal(e.kind, 'free');
  assert.equal(e.label, 'Ruta en bici');
  assert.equal(e.activityKind, 'bike');
  assert.equal(e.source, 'override');
  assert.equal(e.substituted, true);
  assert.deepEqual(e.patternDay, { kind: 'template', templateId: 'tpl_d6' });
  assert.equal(planEmoji(e), '🚴');
  const same = effectiveDay(SAT, ctx({ plan: [{ id: SAT, kind: 'template', templateId: 'tpl_d6' }] }));
  assert.equal(same.substituted, false);
  // Solo estado manual: el plan sigue siendo el de la semana tipo.
  const onlyStatus = effectiveDay(SAT, ctx({ plan: [{ id: SAT, status: 'skipped' }] }));
  assert.equal(onlyStatus.source, 'pattern');
  assert.equal(onlyStatus.templateId, 'tpl_d6');
});

test('plantilla borrada o archivada en la semana tipo → «Plantilla eliminada» sin romper', () => {
  const tpls = tplMap();
  tpls.delete('tpl_d1');
  tpls.get('tpl_d2').archived = true;
  const c = ctx({ tpls, today: '2026-09-30' });
  const mon = effectiveDay(MON, c);
  assert.equal(mon.label, MISSING_TEMPLATE_LABEL);
  assert.equal(mon.missing, true);
  assert.equal(mon.template, null);
  assert.equal(effectiveDay(TUE, c).label, MISSING_TEMPLATE_LABEL);
  assert.equal(dayStatus(MON, c).status, 'skipped');
  assert.equal(planLabel({ kind: 'template', templateId: 'nope' }, tpls), MISSING_TEMPLATE_LABEL);
  // Con una sesión de esa plantilla (ya borrada) se usa la instantánea de la sesión.
  const s = strength('s1', 'tpl_d1', MON);
  assert.equal(dayStatus(MON, ctx({ tpls, sessions: [s], today: '2026-09-30' })).status, 'done');
  const partial = strength('s2', 'tpl_d1', MON, { skip: [0] });
  assert.equal(dayStatus(MON, ctx({ tpls, sessions: [partial], today: '2026-09-30' })).status, 'partial');
  assert.doesNotThrow(() => weekPlan(WS, ctx({ tpls: new Map() })));
});

test('normalizePlan / samePlan / planLabel', () => {
  assert.deepEqual(normalizePlan(null), { kind: 'rest' });
  assert.deepEqual(normalizePlan({ kind: 'free', activityKind: 'run' }), { kind: 'free', label: 'Carrera', activityKind: 'run' });
  assert.ok(samePlan({ kind: 'rest' }, { kind: 'rest', status: 'done' }));
  assert.ok(!samePlan({ kind: 'template', templateId: 'a' }, { kind: 'template', templateId: 'b' }));
  assert.ok(!samePlan({ kind: 'free', activityKind: 'bike', label: 'Ruta en bici' }, { kind: 'free', activityKind: 'run', label: 'Carrera' }));
  assert.equal(planLabel({ kind: 'rest' }), 'Descanso');
  assert.equal(planLabel({ kind: 'free', label: 'Ruta en bici', activityKind: 'bike' }), 'Ruta en bici');
});

// ---------------------------------------------------------------------------
// Sesiones que cuentan y compleción
// ---------------------------------------------------------------------------

test('daySessions: terminadas, por planDate ?? date, sin parentId ni sesiones activas', () => {
  const moved = strength('s1', 'tpl_d1', TUE, { planDate: MON }); // D1 del lunes hecha el martes
  const noPlan = { ...activity('a1', 'run', TUE), planDate: null }; // sin planDate → su fecha
  const linked = activity('a2', 'run', MON, { parentId: 's1', parentItemId: 'x' });
  const active = strength('s3', 'tpl_d2', TUE, { status: 'active' });
  const c = ctx({ sessions: [moved, noPlan, linked, active] });
  assert.deepEqual(daySessions(MON, c).map((s) => s.id), ['s1']);
  assert.deepEqual(daySessions(TUE, c).map((s) => s.id), ['a1']);
  assert.equal(dayStatus(MON, c).status, 'done');
  // El martes tiene una carrera (no la D2) → sustituido; la D2 activa aún no cuenta.
  assert.equal(dayStatus(TUE, c).status, 'substituted');
});

test('completeness: ítems con ≥1 serie de trabajo o actividad enlazada', () => {
  const tpl = tplMap().get('tpl_d1');
  assert.deepEqual(completeness(strength('s', 'tpl_d1', MON), tpl), { total: 7, covered: 7, complete: true, missing: [] });
  const p = completeness(strength('s', 'tpl_d1', MON, { skip: [5, 6] }), tpl);
  assert.equal(p.complete, false);
  assert.equal(p.covered, 5);
  assert.deepEqual(p.missing, ['Ej 5', 'Ej 6']);
  // Ítem quitado durante la sesión (plantilla sin editar después) → falta.
  const removed = completeness(strength('s', 'tpl_d1', MON, { drop: [6] }), tpl, { exercises: new Map([['crunch_polea', { name: 'Crunch en polea' }]]) });
  assert.equal(removed.complete, false);
  assert.deepEqual(removed.missing, ['Crunch en polea']);
  // Plantilla editada DESPUÉS de la sesión (ítem nuevo): no convierte la sesión en parcial.
  const edited = deepClone(tpl);
  edited.items.push({ id: 'ti_new', exerciseId: 'curl_martillo', sets: 3 });
  edited.updatedAt = 9_000;
  assert.equal(completeness(strength('s', 'tpl_d1', MON), edited).complete, true);
  // Cardio: cubierto por la actividad enlazada a ese ejercicio de sesión.
  const d3 = tplMap().get('tpl_d3');
  const s = strength('s3', 'tpl_d3', WED, { skip: [0, 1] }); // correr y bici sin series (son actividades)
  const run = activity('r', 'run', WED, { parentId: 's3', parentItemId: 's3_se0' });
  const bike = activity('b', 'bike', WED, { parentId: 's3', parentItemId: 's3_se1' });
  assert.equal(completeness(s, d3, { sessions: [run] }).complete, false);
  assert.equal(completeness(s, d3, { sessions: [run, bike] }).complete, true);
  assert.equal(dayStatus(WED, ctx({ sessions: [s, run, bike] })).status, 'done');
  assert.equal(dayStatus(WED, ctx({ sessions: [s, run] })).status, 'partial');
});

// ---------------------------------------------------------------------------
// Estados del día
// ---------------------------------------------------------------------------

test('estados: pendiente (hoy y futuro), saltado (pasado), descanso', () => {
  const c = ctx();
  assert.equal(dayStatus(WED, c).status, 'pending');
  assert.equal(dayStatus(SAT, c).status, 'pending');
  assert.equal(dayStatus(MON, c).status, 'skipped');
  assert.equal(dayStatus(FRI, c).status, 'rest');
  assert.equal(dayStatus(SUN, c).status, 'rest');
  assert.equal(dayStatus(MON, c).manual, false);
  assert.equal(STATUS_LABEL.skipped, 'saltado');
});

test('estados: hecho y hecho parcialmente con la plantilla del día', () => {
  assert.equal(dayStatus(MON, ctx({ sessions: [strength('s1', 'tpl_d1', MON)] })).status, 'done');
  const st = dayStatus(MON, ctx({ sessions: [strength('s1', 'tpl_d1', MON, { skip: [0, 1] })] }));
  assert.equal(st.status, 'partial');
  assert.match(st.reason, /5 de 7/);
  assert.equal(STATUS_LABEL[st.status], 'hecho parcialmente');
  // Dos sesiones de la misma plantilla, una completa → hecho.
  const two = [strength('a', 'tpl_d1', MON, { skip: [0] }), strength('b', 'tpl_d1', MON, { createdAt: 7_000 })];
  assert.equal(dayStatus(MON, ctx({ sessions: two })).status, 'done');
});

test('estados: sustituido (otra plantilla, actividad libre o excepción de la semana)', () => {
  assert.equal(dayStatus(MON, ctx({ sessions: [strength('s1', 'tpl_d2', MON)] })).status, 'substituted');
  assert.equal(dayStatus(MON, ctx({ sessions: [activity('a1', 'run', MON)] })).status, 'substituted');
  // Fuerza libre (sin plantilla) en un día de plantilla → sustituido.
  const free = { ...strength('s2', null, MON), templateId: null };
  assert.equal(dayStatus(MON, ctx({ sessions: [free] })).status, 'substituted');
  // Excepción: sábado → ruta en bici, y se hace la ruta.
  const plan = [{ id: SAT, kind: 'free', label: 'Ruta en bici', activityKind: 'bike' }];
  const c = ctx({ plan, sessions: [activity('b1', 'bike', SAT)], today: '2026-09-28' });
  const st = dayStatus(SAT, c);
  assert.equal(st.status, 'substituted');
  assert.match(st.reason, /Día 6/);
  // Excepción sin sesión: pasada → saltado; futura → pendiente.
  assert.equal(dayStatus(SAT, ctx({ plan, today: '2026-09-28' })).status, 'skipped');
  assert.equal(dayStatus(SAT, ctx({ plan })).status, 'pending');
});

test('estados: entreno extra en descanso → hecho (y excepción a descanso)', () => {
  const st = dayStatus(FRI, ctx({ sessions: [activity('a1', 'run', FRI)], today: SUN }));
  assert.equal(st.status, 'done');
  assert.equal(st.extra, true);
  // Día cambiado a descanso: sin sesiones → descanso; con sesión → hecho (extra).
  const plan = [{ id: MON, kind: 'rest' }];
  assert.equal(dayStatus(MON, ctx({ plan })).status, 'rest');
  assert.equal(dayStatus(MON, ctx({ plan, sessions: [strength('s', 'tpl_d1', MON)] })).status, 'done');
});

test('estados: sesión libre planificada en la semana tipo → hecho si coincide el tipo', () => {
  const s = defaultSettings();
  s.weekPatterns[0].days[6] = { kind: 'free', label: 'Carrera larga', activityKind: 'run' };
  assert.equal(dayStatus(SUN, ctx({ settings: s, sessions: [activity('r', 'run', SUN)], today: SUN })).status, 'done');
  assert.equal(dayStatus(SUN, ctx({ settings: s, sessions: [activity('b', 'bike', SUN)], today: SUN })).status, 'substituted');
  assert.equal(dayStatus(SUN, ctx({ settings: s, today: '2026-09-28' })).status, 'skipped');
});

test('estado manual: manda sobre el automático y se puede volver a automático', () => {
  const sessions = [strength('s1', 'tpl_d1', MON)];
  const st = dayStatus(MON, ctx({ sessions, plan: [{ id: MON, status: 'partial' }] }));
  assert.equal(st.status, 'partial');
  assert.equal(st.manual, true);
  assert.equal(st.auto, 'done');
  for (const m of ['done', 'partial', 'substituted', 'skipped', 'rest']) {
    assert.equal(dayStatus(SAT, ctx({ plan: [{ id: SAT, status: m }] })).status, m);
  }
  const back = recordWithStatus({ id: MON, status: 'partial' }, MON, null);
  assert.equal(back, null, 'sin estado ni plan el registro sobra');
  assert.equal(dayStatus(MON, ctx({ sessions, plan: back ? [back] : [] })).status, 'done');
  assert.throws(() => recordWithStatus(null, MON, 'raro'));
});

test('inicio del registro (since): los días anteriores sin sesiones son «sin registro», no saltados', () => {
  const c = ctx({ since: WED });
  assert.equal(dayStatus(MON, c).status, 'none');
  assert.equal(dayStatus(FRI, c).status, 'rest');
  const a = adherence(WS, c);
  assert.equal(a.planned, 3); // X, J, S
  assert.equal(a.skipped, 0);
  // Una sesión antes de since cuenta con normalidad.
  assert.equal(dayStatus(MON, ctx({ since: WED, sessions: [strength('s', 'tpl_d1', MON)] })).status, 'done');
  assert.equal(trackingSince({ createdAt: new Date(2026, 8, 23, 10).getTime(), sessions: [{ date: '2026-09-10', planDate: '2026-09-09' }], plan: [{ id: '2026-09-15' }] }), '2026-09-09');
  assert.equal(trackingSince({}), null);
});

// ---------------------------------------------------------------------------
// Semana y adherencia
// ---------------------------------------------------------------------------

test('weekPlan: 7 días con plan, estado y sesiones', () => {
  const wk = weekPlan(WS, ctx({ sessions: [strength('s1', 'tpl_d1', MON)] }));
  assert.equal(wk.length, 7);
  assert.deepEqual(wk.map((d) => d.date), [MON, TUE, WED, THU, FRI, SAT, SUN]);
  assert.deepEqual(wk.map((d) => d.status), ['done', 'skipped', 'pending', 'pending', 'rest', 'pending', 'rest']);
  assert.equal(wk[0].sessions[0].id, 's1');
});

test('adherencia: planificados frente a hechos, parciales y sustituidos («3 de 5 hechas · 1 parcial»)', () => {
  const sessions = [
    strength('s1', 'tpl_d1', MON),
    strength('s2', 'tpl_d2', TUE, { skip: [0] }),
    strength('s3', 'tpl_d3', WED),
    activity('x', 'run', FRI), // extra en descanso
  ];
  const c = ctx({ sessions, today: SUN });
  const a = adherence(WS, c);
  assert.deepEqual(
    { planned: a.planned, done: a.done, partial: a.partial, substituted: a.substituted, skipped: a.skipped, completed: a.completed, extra: a.extra, pct: a.pct },
    { planned: 5, done: 2, partial: 1, substituted: 0, skipped: 2, completed: 3, extra: 1, pct: 60 },
  );
  assert.equal(adherenceText(a), '3 de 5 hechas · 1 parcial · 2 saltadas · 1 extra');
  assert.equal(adherenceText({ planned: 5, completed: 3, partial: 1 }), '3 de 5 hechas · 1 parcial');
  // Marcar un día planificado como descanso lo quita de los planificados.
  const b = adherence(WS, ctx({ sessions, today: SUN, plan: [{ id: THU, status: 'rest' }] }));
  assert.equal(b.planned, 4);
  assert.equal(adherenceText({ planned: 0, extra: 0 }), 'Sin días planificados');
});

// ---------------------------------------------------------------------------
// Mutaciones (lógica pura de los registros de excepción)
// ---------------------------------------------------------------------------

test('CRITERIO: sustituir el Día 6 de esta semana por una ruta en bici NO modifica la semana tipo', () => {
  const settings = defaultSettings();
  const before = deepClone(settings.weekPatterns);
  const rec = recordWithPlan(null, SAT, { kind: 'free', label: 'Ruta en bici', activityKind: 'bike' }, settings);
  assert.deepEqual(rec, { id: SAT, kind: 'free', label: 'Ruta en bici', activityKind: 'bike' });
  assert.deepEqual(settings.weekPatterns, before, 'weekPatterns intacto');
  const c = ctx({ settings, plan: [rec] });
  assert.equal(effectiveDay(SAT, c).label, 'Ruta en bici');
  // La semana siguiente sigue con el Día 6.
  assert.equal(effectiveDay(NEXT_SAT, c).templateId, 'tpl_d6');
  assert.equal(effectiveDay(NEXT_SAT, c).source, 'pattern');
});

test('recordWithPlan: igual a la semana tipo → sin excepción; conserva estado y nota', () => {
  const s = defaultSettings();
  assert.equal(recordWithPlan(null, SAT, { kind: 'template', templateId: 'tpl_d6' }, s), null);
  const kept = recordWithPlan({ id: SAT, kind: 'rest', status: 'skipped', note: 'lluvia' }, SAT, { kind: 'template', templateId: 'tpl_d6' }, s);
  assert.deepEqual(kept, { id: SAT, status: 'skipped', note: 'lluvia' });
  const toD1 = recordWithPlan({ id: SAT, kind: 'free', label: 'Ruta en bici', activityKind: 'bike' }, SAT, { kind: 'template', templateId: 'tpl_d1' }, s);
  assert.deepEqual(toD1, { id: SAT, kind: 'template', templateId: 'tpl_d1' }, 'no quedan campos del plan anterior');
  assert.deepEqual(recordWithoutPlan({ id: SAT, kind: 'rest', status: 'done' }, SAT), { id: SAT, status: 'done' });
  assert.equal(recordWithoutPlan({ id: SAT, kind: 'rest' }, SAT), null);
  assert.equal(recordWithoutPlan(null, SAT), null);
});

test('swapRecords: mover días intercambia los planes efectivos (y deshacer el cambio lo limpia)', () => {
  const settings = defaultSettings();
  const before = deepClone(settings.weekPatterns);
  const [a, b] = swapRecords(MON, TUE, ctx({ settings }));
  assert.deepEqual(a, { id: MON, kind: 'template', templateId: 'tpl_d2' });
  assert.deepEqual(b, { id: TUE, kind: 'template', templateId: 'tpl_d1' });
  const c = ctx({ settings, plan: [a, b] });
  assert.equal(effectiveDay(MON, c).templateId, 'tpl_d2');
  assert.equal(effectiveDay(TUE, c).templateId, 'tpl_d1');
  assert.equal(effectiveDay(MON, c).substituted, true);
  // Volver a intercambiarlos deja ambos días como la semana tipo (sin registros).
  assert.deepEqual(swapRecords(MON, TUE, c), [null, null]);
  // Con una excepción previa (sábado bici) y descanso el viernes.
  const bike = { id: SAT, kind: 'free', label: 'Ruta en bici', activityKind: 'bike', status: 'done' };
  const [f, s] = swapRecords(FRI, SAT, ctx({ settings, plan: [bike] }));
  assert.deepEqual(f, { id: FRI, kind: 'free', label: 'Ruta en bici', activityKind: 'bike' });
  assert.deepEqual(s, { id: SAT, kind: 'rest', status: 'done' }, 'el estado manual se queda en su fecha');
  assert.deepEqual(settings.weekPatterns, before);
});

test('monthWeeks: lunes de las semanas que cubren el mes', () => {
  assert.deepEqual(monthWeeks('2026-09-23'), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  // 1 feb 2026 es domingo → la primera semana empieza el lunes 26 ene.
  assert.deepEqual(monthWeeks('2026-02-10'), ['2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23']);
  assert.deepEqual(monthWeeks('2026-06-30'), ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
  assert.equal(monthWeeks('2026-12-01').at(-1), '2026-12-28');
});

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

test('historial: filtro por tipo, orden descendente y grupos por mes', () => {
  const list = [
    activity('r1', 'run', '2026-08-30'),
    strength('s1', 'tpl_d1', '2026-09-21'),
    activity('b1', 'bike', '2026-09-26'),
    activity('w1', 'swim', '2026-09-02'),
    activity('o1', 'other', '2026-09-10', { subtype: 'basketball' }),
  ];
  assert.deepEqual(filterSessions(list).map((s) => s.id), ['b1', 's1', 'o1', 'w1', 'r1']);
  assert.deepEqual(filterSessions(list, 'strength').map((s) => s.id), ['s1']);
  assert.deepEqual(filterSessions(list, 'other').map((s) => s.id), ['o1']);
  assert.deepEqual(filterSessions(list, 'raro').length, 5, 'filtro desconocido = todas');
  const g = groupByMonth(filterSessions(list));
  assert.deepEqual(g.map((x) => [x.key, x.count]), [['2026-09', 4], ['2026-08', 1]]);
  assert.equal(g[0].label, 'Septiembre 2026');
  assert.equal(g[0].minutes, 240);
  assert.equal(monthLabel('2026-01'), 'Enero 2026');
});

test('historial: título, dato clave (km/ritmo, volumen/series), duración y carga', () => {
  const run = activity('r', 'run', MON, { distanceKm: 10, movingSec: 3000, rpe: 7, durationMin: 50, subtype: 'z2' });
  assert.equal(sessionTitle(run), 'Carrera · Rodaje / Z2');
  assert.equal(keyStat(run), '10 km · 5:00 /km');
  const sum = sessionSummary(run);
  assert.equal(sum.emoji, '🏃');
  assert.equal(sum.duration, '50 min');
  assert.equal(sum.load, 'carga 350');
  assert.equal(sum.href, '#/activity/r');
  assert.equal(keyStat(activity('b', 'bike', MON, { distanceKm: 42.5, movingSec: 5400 })), '42,5 km · 28,3 km/h');
  assert.equal(keyStat(activity('w', 'swim', MON, { distanceKm: 1.5, movingSec: 1800 })), '1.500 m · 2:00 /100 m');
  assert.equal(keyStat(activity('o', 'other', MON)), '');
  assert.equal(sessionTitle(activity('o', 'other', MON, { subtype: 'basketball' })), 'Baloncesto');
  assert.equal(sessionTitle({ kind: 'bike', templateName: 'Bici · Ruta' }), 'Bici · Ruta');

  const s = strength('s', 'tpl_d1', MON, { skip: [0] });
  assert.equal(workSets(s), 6);
  const exMap = new Map(['press_banca', 'dominadas', 'press_inclinado_mancuerna', 'remo_pecho_apoyado', 'elevaciones_laterales', 'face_pull', 'crunch_polea']
    .map((id) => [id, { id, logType: 'weight_reps' }]));
  assert.equal(keyStat(s, { exMap }), '6 series · 1.500 kg');
  assert.equal(keyStat(s), '6 series');
  const ss = sessionSummary(s, { exMap });
  assert.equal(ss.title, 'Día 1 — Upper pesado');
  assert.equal(ss.href, '#/session/s');
  assert.equal(ss.load, 'carga 420');
  const live = sessionSummary({ ...s, status: 'active' });
  assert.equal(live.duration, 'en curso');
  assert.equal(live.active, true);
  assert.equal(sessionTitle({ kind: 'strength', templateName: '' }), 'Sesión libre');
});
