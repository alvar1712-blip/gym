// Pruebas de la lógica del ciclo menstrual (js/cycle-logic.js, docs/MEJORAS5.md §4). Puro: «hoy» inyectable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  periodsFromDays, cyclesFromPeriods, cycleInfo, phaseForDate, phaseOfDay, phaseStats, calendarMarks, cycleAlerts,
  endPeriodPlan, suggestedFlow, dayHasContent, todayTip, fmtRange, normalizeDays,
  SOURCES, PHASE_TIPS, HORMONAL_TIP, EVIDENCE_NOTE, FLOWS, SYMPTOMS, PHASES, LIMITS,
} from '../../js/cycle-logic.js';
import { addDays, diffDays } from '../../js/util.js';

const FEMALE = { sex: 'female', cycleTracking: true, contraception: 'none', cycleLengthGuess: 28, periodLengthGuess: 5 };
const MALE = { sex: 'male', cycleTracking: true };

/** Días de una regla: `n` días desde `start`; flows por índice (por defecto 'medium'); symptoms por índice. */
function period(start, n, { flows = [], symptoms = {} } = {}) {
  return Array.from({ length: n }, (_, i) => ({ id: addDays(start, i), flow: flows[i] || 'medium', symptoms: symptoms[i] || [], notes: '' }));
}
/** Reglas cada `lens[i]` días desde `start`: devuelve los días y los inicios. */
function cyclesFrom(start, lens, periodLen = 5, opts = {}) {
  const days = [];
  const starts = [start];
  let s = start;
  for (const len of lens) { days.push(...period(s, periodLen, opts)); s = addDays(s, len); starts.push(s); }
  days.push(...period(s, periodLen, opts));
  return { days, starts };
}

// Fuentes permitidas (docs/MEJORAS5.md §5) + una revisión Cochrane equivalente en solidez (Armour 2019).
const ALLOWED = [
  'Munro et al. (FIGO), 2018', 'McNulty et al., 2020', 'Colenso-Semple et al., 2023', 'Elliott-Sale et al., 2020',
  'White et al., 2011', 'Pedlar et al., 2018', 'Bruinvels et al., 2016', 'Mountjoy et al., 2023', 'Knowles et al., 2018',
  'Armour et al., 2019',
];
function checkInsight(ins) {
  assert.equal(ins.area, 'cycle', ins.id);
  assert.ok(['good', 'neutral', 'warn', 'info'].includes(ins.level), ins.id);
  assert.ok(ins.priority >= 0 && ins.priority <= 100, ins.id);
  assert.ok(ins.title && ins.text, ins.id);
  assert.ok(ins.why?.rule, `${ins.id}: why.rule`);
  assert.ok(Array.isArray(ins.why.data) && ins.why.data.length, `${ins.id}: why.data`);
  for (const d of ins.why.data) assert.ok(d.label && d.value != null, `${ins.id}: dato`);
  assert.ok(ins.sources?.length, `${ins.id}: fuentes`);
  for (const s of ins.sources) {
    assert.ok(ALLOWED.includes(s.short), `${ins.id}: fuente fuera de la lista (${s.short})`);
    assert.ok(s.detail && s.detail.length > 10, `${ins.id}: detalle de ${s.short}`);
  }
}

// ---------------------------------------------------------------------------

test('constantes: sangrado, síntomas y fases del contrato', () => {
  assert.deepEqual(FLOWS.map((f) => f.id), ['none', 'spotting', 'light', 'medium', 'heavy']);
  assert.deepEqual(FLOWS.map((f) => f.label), ['Nada', 'Manchado', 'Leve', 'Moderado', 'Abundante']);
  assert.deepEqual(SYMPTOMS.map((s) => s.id), ['cramps', 'bloating', 'headache', 'fatigue', 'low_mood', 'breast', 'acne', 'cravings', 'bad_sleep', 'back_pain']);
  assert.deepEqual(PHASES.map((p) => p.id), ['menstrual', 'follicular', 'ovulation', 'luteal', 'premenstrual']);
  assert.equal(fmtRange('2026-10-03', '2026-10-05'), '3–5 oct');
  assert.equal(fmtRange('2026-09-30', '2026-10-02'), '30 sep – 2 oct');
  assert.equal(fmtRange('2026-10-03', '2026-10-03'), '3 oct');
});

test('periodsFromDays: días con sangrado ≥ leve, se admite 1 día de hueco; el manchado no cuenta', () => {
  const days = [
    { id: '2026-09-01', flow: 'heavy' },
    { id: '2026-09-02', flow: 'heavy' },
    // 3 sin anotar: hueco de 1 día
    { id: '2026-09-04', flow: 'light' },
    { id: '2026-09-05', flow: 'spotting' }, // manchado: no alarga la regla
    { id: '2026-09-10', flow: 'spotting' }, // manchado suelto: no es regla
    { id: '2026-09-20', flow: 'medium' },
    // 21 y 22 sin sangrado: hueco de 2 días → otra regla
    { id: '2026-09-21', flow: 'none', symptoms: ['cramps'] },
    { id: '2026-09-23', flow: 'medium', ended: true },
  ];
  const p = periodsFromDays([...days].reverse()); // el orden de entrada no importa
  assert.deepEqual(p, [
    { start: '2026-09-01', end: '2026-09-04', lengthDays: 4, heavyDays: 2, ended: false },
    { start: '2026-09-20', end: '2026-09-20', lengthDays: 1, heavyDays: 0, ended: false },
    { start: '2026-09-23', end: '2026-09-23', lengthDays: 1, heavyDays: 0, ended: true },
  ]);
  // Map, ids inválidos y duplicados
  const m = new Map([['a', { id: 'x', flow: 'heavy' }], ['b', { id: '2026-02-30', flow: 'heavy' }], ['c', { id: '2026-01-05', flow: 'light' }]]);
  assert.deepEqual(periodsFromDays(m).map((x) => x.start), ['2026-01-05']);
  assert.deepEqual(periodsFromDays(null), []);
  assert.equal(normalizeDays([{ id: '2026-01-01', flow: 'none' }, { id: '2026-01-01', flow: 'heavy' }]).length, 1);
});

test('ciclos y medias: duración media, desviación, variación, regla media y regularidad', () => {
  const { days, starts } = cyclesFrom('2026-05-01', [28, 30, 29, 31], 5);
  const info = cycleInfo(days, FEMALE, addDays(starts.at(-1), 10));
  assert.deepEqual(info.cycles.map((c) => c.lengthDays), [28, 30, 29, 31]);
  assert.deepEqual(cyclesFromPeriods(info.periods).map((c) => c.periodDays), [5, 5, 5, 5]);
  assert.equal(info.cycles[0].end, addDays(starts[1], -1));
  assert.equal(info.avgCycle, 29.5);
  assert.equal(info.sdCycle, 1.3);
  assert.equal(info.variation, 3);
  assert.equal(info.avgPeriod, 5);
  assert.equal(info.regular, true);
  assert.equal(info.basis, 'own');
  assert.equal(info.cycleLength, 29.5);
  assert.deepEqual(info.alerts, []);
  assert.equal(info.enabled, true);
  assert.equal(info.hormonal, false);
});

test('antes de 2 ciclos se usan las duraciones del perfil (cycleLengthGuess / periodLengthGuess)', () => {
  const prof = { ...FEMALE, cycleLengthGuess: 32, periodLengthGuess: 4 };
  const one = cycleInfo(period('2026-09-01', 4), prof, '2026-09-10');
  assert.equal(one.basis, 'guess');
  assert.equal(one.cycleLength, 32);
  assert.equal(one.periodLength, 4);
  assert.deepEqual(one.next, { start: '2026-10-03', from: '2026-10-01', to: '2026-10-05', inDays: 23, spread: 2 });
  // Con 1 ciclo sigue la estimación; con 2 ya son sus medias
  const two = cyclesFrom('2026-07-01', [26], 5);
  assert.equal(cycleInfo(two.days, prof, '2026-08-01').basis, 'guess');
  const three = cyclesFrom('2026-07-01', [26, 27], 5);
  const i3 = cycleInfo(three.days, prof, addDays(three.starts.at(-1), 3));
  assert.equal(i3.basis, 'own');
  assert.equal(i3.cycleLength, 26.5);
  // Sin datos
  const none = cycleInfo([], prof, '2026-09-10');
  assert.equal(none.current, null);
  assert.equal(none.next, null);
  assert.deepEqual(none.periods, []);
});

test('fases estimadas: menstrual, folicular, ovulación (ciclo − 14 ± 2), lútea y premenstrual', () => {
  const ph = (d) => phaseOfDay(d, 28, 5);
  assert.deepEqual([1, 5, 6, 11, 12, 14, 16, 17, 23, 24, 28].map(ph),
    ['menstrual', 'menstrual', 'follicular', 'follicular', 'ovulation', 'ovulation', 'ovulation', 'luteal', 'luteal', 'premenstrual', 'premenstrual']);
  // Ciclo corto (21): la ovulación empieza tras la regla; sin folicular
  assert.deepEqual([5, 6, 9, 10, 16, 17].map((d) => phaseOfDay(d, 21, 5)), ['menstrual', 'ovulation', 'ovulation', 'luteal', 'luteal', 'premenstrual']);

  // Ciclos pasados: con su duración REAL (ciclo de 32 días → ovulación ≈ día 18)
  const { days, starts } = cyclesFrom('2026-06-01', [32, 28], 5);
  const info = cycleInfo(days, FEMALE, addDays(starts[2], 3));
  const d18 = phaseForDate(info, addDays(starts[0], 17));
  assert.equal(d18.phase, 'ovulation');
  assert.equal(d18.ovulationDay, true);
  assert.equal(d18.cycleLength, 32);
  assert.equal(phaseForDate(info, addDays(starts[0], 13)).phase, 'follicular');
  assert.equal(phaseForDate(info, addDays(starts[0], 30)).phase, 'premenstrual');
  const logged = phaseForDate(info, starts[1]);
  assert.deepEqual([logged.phase, logged.logged, logged.estimated, logged.day], ['menstrual', true, false, 1]);
  assert.equal(phaseForDate(info, '2026-05-01'), null, 'antes de la primera regla');
  assert.equal(phaseForDate(info, 'nope'), null);
  // Estado actual
  assert.deepEqual(info.current, { day: 4, phase: 'menstrual', phaseLabel: 'regla', estimated: false, logged: true, cycleStart: starts[2] });
});

test('«hoy» inyectable: los mismos días dan otro día de ciclo y otra fase', () => {
  const { days, starts } = cyclesFrom('2026-06-01', [28, 28], 5);
  const s = starts[2];
  const at = (n) => cycleInfo(days, FEMALE, addDays(s, n - 1)).current;
  assert.deepEqual([at(3).day, at(3).phase], [3, 'menstrual']);
  assert.deepEqual([at(8).day, at(8).phase, at(8).estimated], [8, 'follicular', true]);
  assert.deepEqual([at(14).day, at(14).phase, at(14).phaseLabel], [14, 'ovulation', 'ovulación aprox.']);
  assert.deepEqual([at(20).phase, at(26).phase], ['luteal', 'premenstrual']);
  // El futuro no cuenta: un día anotado después de «hoy» se ignora
  const withFuture = [...days, ...period(addDays(s, 20), 3)];
  assert.equal(cycleInfo(withFuture, FEMALE, addDays(s, 9)).periods.length, 3);
});

test('próxima regla con rango según su variabilidad; proyección de reglas previstas', () => {
  const { days, starts } = cyclesFrom('2026-04-01', [26, 30, 34, 28], 5); // sd ≈ 3,4
  const today = addDays(starts.at(-1), 9);
  const info = cycleInfo(days, FEMALE, today);
  assert.equal(info.cycleLength, 29.5);
  assert.equal(info.next.start, addDays(starts.at(-1), 30));
  assert.equal(info.next.spread, 3);
  assert.equal(info.next.from, addDays(info.next.start, -3));
  assert.equal(info.next.to, addDays(info.next.start, 3));
  assert.equal(info.lateDays, 0);
  // Regular (sd 0) → ±1 día como mínimo
  const reg = cyclesFrom('2026-04-01', [28, 28, 28], 5);
  const ri = cycleInfo(reg.days, FEMALE, addDays(reg.starts.at(-1), 5));
  assert.equal(ri.next.spread, 1);
  // Días previstos: la próxima regla (5 días) y la siguiente
  const nx = phaseForDate(ri, ri.next.start);
  assert.deepEqual([nx.phase, nx.predicted, nx.estimated], ['menstrual', true, true]);
  assert.equal(phaseForDate(ri, addDays(ri.next.start, 4)).predicted, true);
  assert.equal(phaseForDate(ri, addDays(ri.next.start, 5)).predicted, false);
  assert.equal(phaseForDate(ri, addDays(ri.next.start, 28)).predicted, true);
  assert.equal(phaseForDate(ri, addDays(ri.next.start, 13)).ovulationDay, true);
});

test('retraso: lateDays desde la fecha prevista, sin proyección y aviso a partir de 7 días', () => {
  const { days, starts } = cyclesFrom('2026-05-01', [28, 28, 28], 5);
  const expected = addDays(starts.at(-1), 28);
  const on = cycleInfo(days, FEMALE, expected);
  assert.equal(on.lateDays, 0);
  assert.equal(on.current.phase, 'menstrual', 'el día previsto, regla prevista');
  const late3 = cycleInfo(days, FEMALE, addDays(expected, 3));
  assert.equal(late3.lateDays, 3);
  assert.equal(late3.current.day, 32);
  assert.equal(late3.current.phase, 'premenstrual');
  assert.equal(phaseForDate(late3, addDays(expected, 10)).phase, null, 'sin proyección mientras se retrasa');
  assert.equal(late3.alerts.find((a) => a.id === 'cycle-late'), undefined);
  const late9 = cycleInfo(days, FEMALE, addDays(expected, 9));
  assert.equal(late9.lateDays, 9);
  assert.equal(late9.current.phase, null);
  const a = late9.alerts.find((x) => x.id === 'cycle-late');
  assert.ok(a, 'aviso de retraso');
  assert.equal(a.level, 'warn');
  assert.match(a.text, /test/);
  assert.match(a.title, /9 días de retraso/);
  checkInsight(a);
});

test('alerta FIGO: ciclos fuera de 24–38 días (mediana) y variación > 9 días', () => {
  const short = cyclesFrom('2026-05-01', [21, 22, 21], 4);
  const si = cycleInfo(short.days, FEMALE, addDays(short.starts.at(-1), 5));
  const a = si.alerts.find((x) => x.id === 'cycle-length');
  assert.ok(a);
  assert.match(a.title, /cortos/);
  assert.match(a.text, /24 y 38/);
  checkInsight(a);
  const long = cyclesFrom('2026-01-01', [45, 44], 5);
  assert.match(cycleInfo(long.days, FEMALE, addDays(long.starts.at(-1), 3)).alerts.find((x) => x.id === 'cycle-length').title, /largos/);
  // Una regla sin apuntar (un ciclo de 56 entre ciclos normales) no dispara el aviso de duración
  const gap = cyclesFrom('2026-01-01', [28, 56, 28, 29], 5);
  assert.equal(cycleInfo(gap.days, FEMALE, addDays(gap.starts.at(-1), 3)).alerts.find((x) => x.id === 'cycle-length'), undefined);

  const irr = cyclesFrom('2026-03-01', [25, 36, 27], 5);
  const ii = cycleInfo(irr.days, FEMALE, addDays(irr.starts.at(-1), 3));
  assert.equal(ii.variation, 11);
  assert.equal(ii.regular, false);
  const b = ii.alerts.find((x) => x.id === 'cycle-irregular');
  assert.ok(b);
  assert.match(b.text, /7–9 días/);
  checkInsight(b);
  // 2 ciclos no bastan para juzgar la regularidad
  const two = cyclesFrom('2026-03-01', [25, 36], 5);
  assert.equal(cycleInfo(two.days, FEMALE, addDays(two.starts.at(-1), 3)).regular, null);
});

test('amenorrea: ≥ 90 días sin regla → consultar (REDs); sustituye al aviso de retraso', () => {
  const { days, starts } = cyclesFrom('2026-01-01', [29, 28], 5);
  const info = cycleInfo(days, FEMALE, addDays(starts.at(-1), 95));
  const a = info.alerts.find((x) => x.id === 'cycle-amenorrhea');
  assert.ok(a);
  assert.equal(a.level, 'warn');
  assert.equal(a.priority, 95);
  assert.match(a.text, /REDs/);
  assert.match(a.text, /consulta médica/);
  assert.ok(a.sources.some((s) => s.short === SOURCES.mountjoy.short));
  assert.equal(info.alerts.find((x) => x.id === 'cycle-late'), undefined);
  assert.equal(info.alerts[0].id, 'cycle-amenorrhea', 'la más prioritaria primero');
  checkInsight(a);
  assert.equal(cycleInfo(days, FEMALE, addDays(starts.at(-1), 80)).alerts.find((x) => x.id === 'cycle-amenorrhea'), undefined);
});

test('reglas abundantes frecuentes → hierro/ferritina con su médico (más prioridad si hay cansancio)', () => {
  const heavy = { flows: ['heavy', 'heavy', 'heavy'] };
  const { days, starts } = cyclesFrom('2026-05-01', [28, 28, 28], 5, heavy);
  const today = addDays(starts.at(-1), 10);
  const info = cycleInfo(days, FEMALE, today);
  const a = info.alerts.find((x) => x.id === 'cycle-heavy');
  assert.ok(a);
  assert.equal(a.level, 'info');
  assert.match(a.text, /ferritina/);
  assert.ok(a.sources.some((s) => s.short === SOURCES.bruinvels.short) && a.sources.some((s) => s.short === SOURCES.pedlar.short));
  checkInsight(a);
  const tired = days.map((d, i) => (i === 1 ? { ...d, symptoms: ['fatigue'] } : d));
  const b = cycleInfo(tired, FEMALE, today).alerts.find((x) => x.id === 'cycle-heavy');
  assert.equal(b.level, 'warn');
  assert.match(b.text, /cansancio/);
  // Una sola regla abundante: sin aviso
  const one = cyclesFrom('2026-05-01', [28, 28, 28], 5);
  one.days[0].flow = 'heavy'; one.days[1].flow = 'heavy';
  assert.equal(cycleInfo(one.days, FEMALE, today).alerts.find((x) => x.id === 'cycle-heavy'), undefined);
  // Reglas largas (> 8 días) también cuentan
  const long = cyclesFrom('2026-05-01', [30, 30], 9);
  assert.match(cycleInfo(long.days, FEMALE, addDays(long.starts.at(-1), 12)).alerts.find((x) => x.id === 'cycle-heavy').text, /más de 8 días/);
});

test('anticonceptivo hormonal: sin fases ni previsiones; registra sangrados y lo explica', () => {
  const { days, starts } = cyclesFrom('2026-05-01', [28, 28, 28], 4);
  const pill = cycleInfo(days, { ...FEMALE, contraception: 'combined_pill' }, addDays(starts.at(-1), 10));
  assert.equal(pill.hormonal, true);
  assert.equal(pill.next, null);
  assert.equal(pill.lateDays, 0);
  assert.equal(pill.current.phase, null);
  assert.equal(pill.current.phaseLabel, null);
  assert.equal(pill.current.day, 11);
  assert.match(pill.note, /deprivación/);
  assert.match(pill.note, /no una regla natural/);
  assert.equal(phaseForDate(pill, addDays(starts.at(-1), 14)).phase, null);
  assert.equal(pill.periods.length, 4, 'los sangrados se siguen registrando');
  // Sin avisos de retraso ni amenorrea (con DIU hormonal es normal no sangrar)
  const iud = cycleInfo(days, { ...FEMALE, contraception: 'hormonal_iud' }, addDays(starts.at(-1), 120));
  assert.deepEqual(iud.alerts.map((a) => a.id), []);
  assert.match(iud.note, /irregular o desaparecer/);
  // Pero sí el de sangrado abundante
  const hv = cyclesFrom('2026-05-01', [28, 28], 4, { flows: ['heavy', 'heavy'] });
  assert.ok(cycleInfo(hv.days, { ...FEMALE, contraception: 'combined_pill' }, addDays(hv.starts.at(-1), 8)).alerts.some((a) => a.id === 'cycle-heavy'));
  // Calendario: sangrados sí, previstas y ovulación no
  const marks = calendarMarks(pill, starts.at(-1), addDays(starts.at(-1), 40));
  assert.equal(marks.get(starts.at(-1)).period, true);
  assert.ok(![...marks.values()].some((m) => m.predicted || m.ovulation));
  assert.equal(phaseStats(pill, {}).ok, false);
  assert.equal(todayTip(pill), null);
});

test('modo hombre o seguimiento desactivado: enabled false y sin avisos', () => {
  const { days, starts } = cyclesFrom('2026-01-01', [29], 5);
  const m = cycleInfo(days, MALE, addDays(starts.at(-1), 120));
  assert.equal(m.enabled, false);
  assert.deepEqual(m.alerts, []);
  assert.equal(cycleInfo(days, { ...FEMALE, cycleTracking: false }, '2026-06-01').enabled, false);
  assert.deepEqual(cycleAlerts(null), []);
});

test('regla en curso: ongoing, «Ha terminado» rellena los días sin anotar y marca el final', () => {
  const { days, starts } = cyclesFrom('2026-06-01', [28, 28], 5);
  const s = addDays(starts.at(-1), 28); // regla nueva: solo el primer día anotado
  const all = [...days, { id: s, flow: 'medium', symptoms: [], notes: '' }];
  const d3 = addDays(s, 2);
  const info = cycleInfo(all, FEMALE, d3);
  assert.deepEqual(info.ongoing, { start: s, day: 3, lastLogged: s });
  assert.equal(info.current.phase, 'menstrual');
  assert.equal(info.lateDays, 0);
  assert.equal(suggestedFlow(info, d3), 'medium');
  assert.equal(suggestedFlow(info, addDays(s, -10)), 'none');
  // Días que faltan de la regla en curso: previstos desde hoy
  const marks = calendarMarks(info, s, addDays(s, 6));
  assert.equal(marks.get(s).period, true);
  assert.equal(marks.get(addDays(s, 1))?.predicted ?? false, false, 'un día pasado sin anotar no se inventa');
  assert.equal(marks.get(d3).predicted, true);
  assert.equal(marks.get(addDays(s, 4)).predicted, true);
  // Plan de «Ha terminado» con último día = hoy
  const plan = endPeriodPlan(info, d3, 1);
  assert.deepEqual(plan.save.map((r) => [r.id, r.flow, !!r.auto, !!r.ended]), [
    [addDays(s, 1), 'medium', true, false],
    [d3, 'medium', true, true],
  ]);
  assert.deepEqual(plan.before, [{ id: addDays(s, 1), missing: true }, { id: d3, missing: true }]);
  const after = cycleInfo([...all, ...plan.save], FEMALE, d3);
  assert.equal(after.ongoing, null, 'terminada');
  assert.equal(after.periods.at(-1).lengthDays, 3);
  assert.equal(after.periods.at(-1).ended, true);
  assert.equal(after.current.phase, 'menstrual', 'hoy fue el último día de regla');
  assert.equal(cycleInfo([...all, ...plan.save], FEMALE, addDays(d3, 1)).current.phase, 'follicular');
  // No se puede terminar antes del último día anotado ni en el futuro; sin regla en curso → null
  assert.equal(endPeriodPlan(info, addDays(s, -1)), null);
  assert.equal(endPeriodPlan(info, addDays(d3, 1)), null);
  assert.equal(endPeriodPlan(cycleInfo(days, FEMALE, d3), d3), null);
  // Sin anotar más días, pasada la duración de la regla deja de estar en curso
  assert.equal(cycleInfo(all, FEMALE, addDays(s, 8)).ongoing, null);
  assert.equal(dayHasContent({ flow: 'none', symptoms: [], notes: ' ' }), false);
  assert.equal(dayHasContent({ flow: 'none', symptoms: ['acne'] }), true);
  assert.equal(dayHasContent({ flow: 'spotting' }), true);
});

test('calendarMarks: regla anotada, prevista, ovulación aproximada y síntomas', () => {
  const { days, starts } = cyclesFrom('2026-06-01', [28, 28], 5, { symptoms: { 0: ['cramps'] } });
  const today = addDays(starts.at(-1), 8);
  const info = cycleInfo([...days, { id: addDays(today, -1), flow: 'none', symptoms: ['acne'], notes: '' }], FEMALE, today);
  const from = starts.at(-1);
  const marks = calendarMarks(info, from, addDays(from, 34));
  assert.equal(marks.get(from).period, true);
  assert.equal(marks.get(from).symptoms, true);
  assert.equal(marks.get(addDays(today, -1)).symptoms, true);
  const ov = [...marks].filter(([, m]) => m.ovulation).map(([d]) => diffDays(from, d) + 1);
  assert.deepEqual(ov, [12, 13, 14, 15, 16]);
  assert.equal(marks.get(addDays(from, 13)).ovulationDay, true);
  const pred = [...marks].filter(([, m]) => m.predicted).map(([d]) => d);
  assert.deepEqual(pred, [0, 1, 2, 3, 4].map((i) => addDays(info.next.start, i)));
});

test('phaseStats: < 2 ciclos completos → explica cuándo aparecerá', () => {
  const one = cyclesFrom('2026-08-01', [28], 5);
  const st = phaseStats(cycleInfo(one.days, FEMALE, '2026-09-10'), {});
  assert.equal(st.ok, false);
  assert.equal(st.needed, 1);
  assert.match(st.reason, /2 ciclos completos/);
  assert.match(st.reason, /falta 1/);
  const none = phaseStats(cycleInfo([], FEMALE, '2026-09-10'), {});
  assert.equal(none.ok, false);
});

test('phaseStats: medias por fase de SU historial (energía, sueño, RPE, fuerza relativa, peso, síntomas)', () => {
  const { days, starts } = cyclesFrom('2026-05-04', [28, 28, 28], 5, { symptoms: { 0: ['cramps'], 1: ['cramps', 'fatigue'], 2: ['cramps'] } });
  const today = addDays(starts.at(-1), 20);
  const info = cycleInfo(days, FEMALE, today);
  const checkins = [];
  const sessions = [];
  const bodyweight = [];
  let k = 0;
  for (let d = starts[0]; d <= today; d = addDays(d, 1)) {
    const ph = phaseForDate(info, d).phase;
    // Check-in cada dos días: energía baja en la fase premenstrual, sueño normal
    if (k % 2 === 0) checkins.push({ id: `c${k}`, date: d, timing: 'pre', sleep: 2, energy: ph === 'premenstrual' ? 1 : 3 });
    // Peso: 60 kg, +0,8 los días de regla (retención)
    bodyweight.push({ id: d, kg: 60 + (ph === 'menstrual' ? 0.8 : 0) });
    // Fuerza cada 3 días: 3 % menos en la regla
    if (k % 3 === 0) {
      const w = ph === 'menstrual' ? 97 : 100;
      sessions.push({
        id: `s${k}`, kind: 'strength', status: 'done', date: d, rpe: ph === 'menstrual' ? 8 : 7, parentId: null,
        exercises: [{ exerciseId: 'sentadilla', sets: [{ type: 'effective', done: true, weight: w, reps: 5, rir: 2 }] }],
      });
    }
    k++;
  }
  const exercises = new Map([['sentadilla', { id: 'sentadilla', logType: 'weight_reps' }]]);
  const st = phaseStats(info, { checkins, sessions, exercises, bodyweight, cycleDays: days });
  assert.equal(st.ok, true);
  assert.equal(st.cycles, 3);
  assert.deepEqual(st.phases.map((p) => p.id), ['menstrual', 'follicular', 'ovulation', 'luteal', 'premenstrual']);
  const by = Object.fromEntries(st.phases.map((p) => [p.id, p]));
  assert.equal(by.premenstrual.energy.mean, 1);
  assert.equal(by.follicular.energy.mean, 3);
  assert.equal(by.luteal.sleep.mean, 2);
  assert.ok(by.menstrual.rpe.mean === 8 && by.follicular.rpe.mean === 7);
  assert.ok(by.menstrual.strength.pct < -2.5, `fuerza en la regla ${by.menstrual.strength.pct}`);
  assert.ok(Math.abs(by.follicular.strength.pct) < 0.5);
  assert.ok(by.menstrual.weight.kg > 0.5, `peso en la regla ${by.menstrual.weight.kg}`);
  assert.equal(by.menstrual.symptoms[0].id, 'cramps');
  assert.ok(by.menstrual.symptoms[0].share >= 0.5);
  const ids = st.insights.map((i) => i.id);
  assert.ok(ids.includes('cycle-energy-premenstrual'), ids.join());
  assert.ok(ids.includes('cycle-strength-menstrual'), ids.join());
  assert.ok(ids.includes('cycle-weight'), ids.join());
  assert.ok(ids.includes('cycle-symptom-menstrual'), ids.join());
  for (const i of st.insights) checkInsight(i);
  // Sin check-ins, sesiones ni pesajes: lo dice (no inventa diferencias)
  const empty = phaseStats(info, { cycleDays: [] });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.insights.map((i) => i.id), ['cycle-stats-nodata']);
  // Los síntomas salen de los días del ciclo (data.cycleDays o, si no, info.days)
  assert.deepEqual(phaseStats(info, {}).insights.map((i) => i.id), ['cycle-symptom-menstrual']);
});

test('phaseStats: sin diferencias claras → «entrena según cómo te encuentres»', () => {
  const { days, starts } = cyclesFrom('2026-05-04', [28, 28], 5);
  const today = addDays(starts.at(-1), 20);
  const info = cycleInfo(days, FEMALE, today);
  const checkins = [];
  const sessions = [];
  let k = 0;
  for (let d = starts[0]; d <= today; d = addDays(d, 1), k++) {
    checkins.push({ id: `c${k}`, date: d, timing: 'pre', sleep: 2, energy: 2 });
    if (k % 2 === 0) sessions.push({ id: `s${k}`, kind: 'strength', status: 'done', date: d, rpe: 7, exercises: [{ exerciseId: 'x', sets: [{ type: 'effective', done: true, weight: 50, reps: 8, rir: 1 }] }] });
  }
  const st = phaseStats(info, { checkins, sessions, exercises: [{ id: 'x', logType: 'weight_reps' }] });
  const ids = st.insights.map((i) => i.id);
  assert.ok(ids.includes('cycle-strength-flat'), ids.join());
  assert.ok(!ids.some((id) => id.startsWith('cycle-energy')));
});

test('consejos por fase y nota de la evidencia: con «¿Por qué?» y fuentes de la lista', () => {
  for (const id of PHASES.map((p) => p.id)) {
    assert.ok(PHASE_TIPS[id]?.length, `consejo para ${id}`);
    for (const t of PHASE_TIPS[id]) checkInsight({ ...t, area: 'cycle', level: 'info', priority: 10 });
  }
  checkInsight({ ...HORMONAL_TIP, area: 'cycle', level: 'info', priority: 10 });
  checkInsight(EVIDENCE_NOTE);
  assert.ok(EVIDENCE_NOTE.sources.some((s) => s.short === 'McNulty et al., 2020'));
  assert.ok(EVIDENCE_NOTE.sources.some((s) => s.short === 'Colenso-Semple et al., 2023'));
  assert.match(PHASE_TIPS.ovulation[0].text, /no sirve como método anticonceptivo/);
  assert.match(PHASE_TIPS.premenstrual[0].text, /retención de líquidos/);
  assert.match(PHASE_TIPS.menstrual[1].text, /ferritina/);
  for (const s of Object.values(SOURCES)) assert.ok(ALLOWED.includes(s.short), s.short);
  // Consejo breve de hoy solo si aporta
  const { days, starts } = cyclesFrom('2026-06-01', [28, 28], 5);
  assert.match(todayTip(cycleInfo(days, FEMALE, addDays(starts.at(-1), 1))).short, /suave/);
  assert.equal(todayTip(cycleInfo(days, FEMALE, addDays(starts.at(-1), 13))), null, 'ovulación: nada que aconsejar');
  assert.equal(LIMITS.normalMin, 24);
  assert.equal(LIMITS.normalMax, 38);
});
