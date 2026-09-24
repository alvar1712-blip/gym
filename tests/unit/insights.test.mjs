// Pruebas de js/insights.js (panel semanal de la Fase 3) con datos construidos a mano.
// Hoy = jueves 24 sep 2026. Semanas (lunes): 17 ago, 24 ago, 31 ago, 7 sep, 14 sep, 21 sep (en curso).
import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyInsights, keyMessages, incrementFor, isLowCheckin, LEVELS, LEVEL_LABEL, MIN_SESSIONS } from '../../js/insights.js';
import { muscleTable, weeklySeries } from '../../js/stats.js';
import { defaultSettings, SEED_EXERCISES } from '../../js/seed.js';
import { tsFromDate, addDays, fmtNum, deepClone } from '../../js/util.js';

const TODAY = '2026-09-24';
const W = { w0: '2026-08-17', w1: '2026-08-24', w2: '2026-08-31', w3: '2026-09-07', w4: '2026-09-14', cur: '2026-09-21' };

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------
let seq = 0;
const set = (weight, reps, rir = 1, extra = {}) => ({
  id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null,
  note: '', done: true, doneAt: 1, ...extra,
});
const warm = (weight, reps) => set(weight, reps, null, { type: 'warmup' });
const pend = (weight, reps) => set(weight, reps, 1, { done: false, doneAt: null });
const uni = (weight, l, r, rir = 1) => set(weight, l, rir, { repsR: r });

/** Sesión de fuerza: items = [[exerciseId, sets, target?], …]; target por defecto 3×8–10. */
function ses(id, date, items, extra = {}) {
  return {
    id, kind: 'strength', date, planDate: date, status: 'done', parentId: null, templateId: null, templateName: extra.templateName || 'Sesión libre',
    startedAt: tsFromDate(date, extra.hour ?? 18), createdAt: tsFromDate(date, extra.hour ?? 18), durationMin: 60, rpe: 7, notes: '',
    exercises: items.map(([exerciseId, sets, target], i) => ({
      id: `${id}_se${i}`, exerciseId, exName: exerciseId, templateItemId: null,
      target: { sets: 3, setsMax: null, repMin: 8, repMax: 10, timeMin: null, timeMax: null, distance: null, ...(target || {}) }, sets,
    })),
    ...extra,
  };
}
/** Actividad; carga = minutos × rpe. */
function act(id, kind, date, { km = null, min = 60, rpe = 5, ...extra } = {}) {
  return {
    id, kind, date, planDate: date, status: 'done', parentId: null, templateId: null, startedAt: null,
    createdAt: tsFromDate(date, 8), movingSec: min * 60, durationMin: min, rpe, distanceKm: km, ...extra,
  };
}
const EXMAP = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
function mk(over = {}) {
  return { sessions: [], exercises: EXMAP, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], checkins: [], today: TODAY, ...over };
}
const settingsWith = (patch) => {
  const s = defaultSettings();
  for (const [k, v] of Object.entries(patch)) s[k] = v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? { ...s[k], ...v } : v;
  return s;
};
const all = (r) => [...r.info, ...r.suggestions];
const byId = (r, id) => all(r).find((m) => m.id === id);
const ids = (arr) => arr.map((m) => m.id);
const whyText = (m) => `${m.why.rule}\n${m.why.data.map((d) => `${d.label}: ${d.value}`).join('\n')}`;
const kg1 = (v) => `${fmtNum(v, 1)} kg`;
const e1 = (w, reps, rir) => w * (1 + (reps + rir) / 30);

/** Semanas de press banca (sube), remo con pecho apoyado (igual) y jalón (igual). */
function strengthWeeks({ rpe = 7, weeks = ['w0', 'w1', 'w2', 'w3', 'w4', 'cur'] } = {}) {
  const out = [];
  weeks.forEach((wk, i) => {
    const d = W[wk];
    out.push(ses(`a_${wk}`, d, [
      ['press_banca', [warm(40, 8), set(70 + 2.5 * i, 6, 2), set(70 + 2.5 * i, 5, 1), set(70 + 2.5 * i, 5, 1)], { repMin: 4, repMax: 6 }],
      ['remo_pecho_apoyado', [set(60, 10, 1), set(60, 9, 1), set(60, 8, 1)]],
      ['jalon_pecho', [set(55, 12, 1), set(55, 11, 1), set(55, 10, 1)], { repMin: 8, repMax: 12 }],
    ], { rpe }));
  });
  return out;
}

// ===========================================================================
// Forma de los mensajes (criterio de aceptación: todos con «¿Por qué?»)
// ===========================================================================

function assertShape(r, label) {
  const seen = new Set();
  for (const [arr, section] of [[r.info, 'info'], [r.suggestions, 'suggestion']]) {
    for (const m of arr) {
      const where = `${label} · ${m.id}`;
      assert.ok(typeof m.id === 'string' && m.id, `${where}: id`);
      assert.ok(!seen.has(m.id), `${where}: id repetido`);
      seen.add(m.id);
      assert.equal(m.section, section, `${where}: section`);
      assert.ok(LEVELS.includes(m.level), `${where}: level ${m.level}`);
      assert.ok(typeof m.title === 'string' && m.title.trim(), `${where}: title`);
      assert.ok(typeof m.text === 'string' && m.text.trim(), `${where}: text`);
      assert.ok(m.why && typeof m.why.rule === 'string' && m.why.rule.trim().length > 20, `${where}: why.rule`);
      assert.ok(Array.isArray(m.why.data) && m.why.data.length > 0, `${where}: why.data no vacío`);
      for (const d of m.why.data) {
        assert.ok(typeof d.label === 'string' && d.label.trim(), `${where}: why.data.label`);
        assert.ok(typeof d.value === 'string' && d.value.trim(), `${where}: why.data.value (${d.label})`);
      }
      assert.ok(!/undefined|NaN|null|\[object/.test(`${m.title} ${m.text} ${whyText(m)}`), `${where}: sin textos rotos\n${m.text}\n${whyText(m)}`);
      if (m.items) assert.ok(Array.isArray(m.items) && m.items.every((it) => typeof it.label === 'string' && typeof it.value === 'string'), `${where}: items`);
    }
  }
}

function richData(over = {}) {
  const sessions = [
    ...strengthWeeks({ rpe: 9 }),
    ses('d6', W.w4, [['bulgara', [uni(16, 8, 8), uni(16, 8, 8)], { repMin: 8, repMax: 8 }], ['dominadas', [set(null, 8), set(null, 8)], { repMin: 5, repMax: 8 }]]),
    ses('d4', addDays(W.w4, 3), [['curl_supinador', [set(12, 15), set(12, 15)], { repMin: 10, repMax: 15 }], ['aperturas_mancuerna', [set(12, 15), set(12, 13)], { repMin: 10, repMax: 15 }]]),
    act('r1', 'run', W.w3, { km: 10, min: 55 }), act('r2', 'run', W.w4, { km: 13, min: 70 }), act('r3', 'run', W.cur, { km: 6, min: 33 }),
    act('b1', 'bike', W.w4, { km: 40, min: 90 }), act('sw', 'swim', W.w4, { km: 1.5, min: 35 }),
  ];
  return mk({ sessions, checkins: [{ id: 'c1', date: W.cur, timing: 'pre', sleep: 1, energy: 2, soreness: 2 }], ...over });
}

test('forma: todos los mensajes llevan id, sección, nivel, título, texto y why.rule + why.data no vacíos', () => {
  const variants = [
    ['rico · en curso', richData(), W.cur],
    ['rico · semana pasada', richData(), W.w4],
    ['rico · primera semana', richData(), W.w0],
    ['rico · semana intermedia', richData(), W.w2],
    ['solo actividades', mk({ sessions: [act('r1', 'run', W.w4, { km: 8 }), act('r2', 'run', W.cur, { km: 5 })] }), W.cur],
    ['una sesión', mk({ sessions: [ses('x', W.cur, [['press_banca', [set(80, 5)]]])] }), W.cur],
    ['umbrales editados', richData({ settings: settingsWith({ secondaryFactor: 0.25, stall: { sessions: 2, weeks: 1 }, loadWarn: { low: 5, high: 10 }, deload: { minStalled: 1, rpeHigh: 6, weeks: 3 } }) }), W.cur],
    ['ajustes incompletos', richData({ settings: { muscleTargets: defaultSettings().muscleTargets } }), W.cur],
  ];
  for (const [label, data, week] of variants) {
    const r = weeklyInsights(data, week);
    assert.ok(r.info.length > 0, `${label}: hay información`);
    assertShape(r, label);
  }
  assert.deepEqual(LEVEL_LABEL, { neutral: 'Info', good: 'Bien', warn: 'Atención' });
});

test('sin datos, semana futura y semana anterior al primer registro: listas vacías con su motivo', () => {
  const r = weeklyInsights(mk(), W.cur);
  assert.equal(r.hasHistory, false);
  assert.deepEqual([r.info, r.suggestions], [[], []]);
  assert.equal(r.week, W.cur);
  // Solo sesiones activas o sin terminar: no cuentan
  const active = weeklyInsights(mk({ sessions: [{ ...ses('a', W.cur, [['press_banca', [set(80, 5)]]]), status: 'active' }] }));
  assert.equal(active.hasHistory, false);

  const d = richData();
  const fut = weeklyInsights(d, '2026-10-01');
  assert.equal(fut.future, true);
  assert.equal(fut.week, '2026-09-28');
  assert.deepEqual([fut.info, fut.suggestions], [[], []]);

  const before = weeklyInsights(d, '2026-07-01');
  assert.equal(before.beforeHistory, true);
  assert.equal(before.firstDate, W.w0);
  assert.deepEqual([before.info, before.suggestions], [[], []]);
  assert.equal(weeklyInsights(null).hasHistory, false);
});

test('semana: cualquier fecha se normaliza al lunes; en curso, días que quedan (hoy incluido) y último día que cuenta', () => {
  const d = richData();
  const r = weeklyInsights(d);
  assert.deepEqual([r.week, r.weekEnd, r.inProgress, r.daysLeft, r.ref], [W.cur, '2026-09-27', true, 4, TODAY]);
  const r2 = weeklyInsights(d, '2026-09-17');
  assert.deepEqual([r2.week, r2.inProgress, r2.daysLeft, r2.ref], [W.w4, false, 0, '2026-09-20']);
  assert.equal(weeklyInsights({ ...d, today: '2026-09-27' }).daysLeft, 1, 'domingo: queda hoy');
  assert.equal(weeklyInsights({ ...d, today: '2026-09-21' }).daysLeft, 7, 'lunes: la semana entera');
  assert.equal(weeklyInsights(d, 'no-es-fecha').week, W.cur);
});

test('orden: INFORMACIÓN 1–6 y SUGERENCIAS 1–3', () => {
  const r = weeklyInsights(richData(), W.w4);
  const info = ids(r.info);
  const order = ['muscles', 'muscles-below', 'muscles-above', 'push-pull', 'load', 'km', 'ex-progress', 'ex-maintain', 'ex-stalled', 'ex-none'];
  const pos = info.map((id) => order.indexOf(id));
  assert.ok(pos.every((p) => p >= 0), `ids conocidos: ${info}`);
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b), `orden de la información: ${info}`);
  assert.equal(info[0], 'muscles');
  const sg = ids(r.suggestions);
  const rank = (id) => (id.startsWith('dp-up-') ? 0 : id === 'dp-hold' ? 1 : ['load-warn', 'runkm-warn', 'load-ok'].includes(id) ? 2 : id.startsWith('deload') ? 3 : 9);
  assert.deepEqual(sg.map(rank), [...sg.map(rank)].sort((a, b) => a - b), `orden de las sugerencias: ${sg}`);
  assert.ok(sg.at(-1).startsWith('deload'));
});

// ===========================================================================
// INFORMACIÓN 1–2 · Series por músculo
// ===========================================================================

test('series por músculo: mismas cifras que stats.muscleTable, rango de settings y Δ con la semana anterior', () => {
  const d = richData();
  const r = weeklyInsights(d, W.w4);
  const m = byId(r, 'muscles');
  const table = muscleTable(d, W.w4);
  assert.equal(m.items.length, table.length);
  for (const t of table) {
    const it = m.items.find((x) => x.muscleId === t.muscleId);
    assert.equal(it.sets, t.sets, t.muscleId);
    assert.equal(it.prevSets, t.prevSets);
    assert.equal(it.status, t.status);
    assert.equal(it.delta, t.sets - t.prevSets);
    assert.deepEqual([it.min, it.max], [t.min, t.max]);
  }
  const back = m.items.find((x) => x.muscleId === 'back');
  // Remo (3 × 1) + jalón (3 × 1) = 6 (+ dominadas 2 × 1 el 14 sep) = 8
  assert.equal(back.sets, 8);
  assert.equal(back.range, '14–22');
  assert.equal(back.statusLabel, 'Por debajo');
  assert.match(m.text, /de 16 músculos dentro de su rango/);
  assert.match(m.why.rule, /suma 1 al músculo principal del ejercicio y 0,5 a cada secundario/);
});

test('series por músculo: el porqué lista cada ejercicio con series × factor (principal 1, secundario según settings)', () => {
  const data = mk({ sessions: [
    ses('p', W.w4, [['remo_pecho_apoyado', [set(60, 10), set(60, 10), set(60, 10)]], ['dominadas', [set(null, 8), set(null, 8)]], ['face_pull', [set(20, 15), set(20, 15)]]]),
    ses('q', W.w3, [['remo_pecho_apoyado', [set(60, 10), set(60, 10)]]]),
  ] });
  const below = byId(weeklyInsights(data, W.w4), 'muscles-below');
  assert.equal(below.level, 'warn');
  const rows = below.why.data;
  const i = rows.findIndex((x) => x.label === 'Espalda' && !x.sub);
  assert.ok(i >= 0);
  assert.match(rows[i].value, /^6 series · rango 14–22 · semana anterior 2 \(\+4\)$/); // 3 + 2 + 2 × 0,5
  const sub = rows.slice(i + 1).filter((x) => x.sub).slice(0, 3);
  assert.deepEqual(sub.map((x) => [x.label, x.value]), [
    ['Remo con pecho apoyado', '3 series × 1 = 3'],
    ['Dominadas', '2 series × 1 = 2'],
    ['Face pull (secundario)', '2 series × 0,5 = 1'],
  ]);
  // Factor secundario editado → cambia la aportación y el total
  const s2 = settingsWith({ secondaryFactor: 0.25 });
  const b2 = byId(weeklyInsights({ ...data, settings: s2 }, W.w4), 'muscles-below');
  assert.ok(b2.why.data.some((x) => x.label === 'Face pull (secundario)' && x.value === '2 series × 0,25 = 0,5'));
  assert.ok(b2.why.data.some((x) => x.label === 'Espalda' && x.value.startsWith('5,5 series')));
  assert.match(b2.why.rule, /0,25 a cada secundario/);
});

test('series por músculo: calentamientos y series pendientes no cuentan', () => {
  const data = mk({ sessions: [ses('p', W.w4, [['remo_pecho_apoyado', [warm(30, 10), set(60, 10), pend(60, 10)]]])] });
  const m = byId(weeklyInsights(data, W.w4), 'muscles');
  assert.equal(m.items.find((x) => x.muscleId === 'back').sets, 1);
});

test('rango editado en settings: el mismo recuento pasa de «por debajo» a «dentro»', () => {
  const data = mk({ sessions: [ses('p', W.w4, [['remo_pecho_apoyado', [set(60, 10), set(60, 10), set(60, 10)]]])] });
  assert.ok(byId(weeklyInsights(data, W.w4), 'muscles-below').items.some((x) => x.muscleId === 'back'));
  const s = defaultSettings();
  s.muscleTargets.back = [2, 6];
  const r = weeklyInsights({ ...data, settings: s }, W.w4);
  const back = byId(r, 'muscles').items.find((x) => x.muscleId === 'back');
  assert.equal(back.status, 'in');
  assert.equal(back.range, '2–6');
  assert.ok(!(byId(r, 'muscles-below')?.items || []).some((x) => x.muscleId === 'back'));
  // Máximo por debajo del recuento → «por encima» (warn)
  s.muscleTargets.back = [0, 2];
  const above = byId(weeklyInsights({ ...data, settings: s }, W.w4), 'muscles-above');
  assert.equal(above.level, 'warn');
  assert.ok(above.items.some((x) => x.muscleId === 'back' && x.excess === 1));
});

test('un solo músculo por debajo / por encima: título con su nombre y texto con cifras y semana anterior', () => {
  const s = defaultSettings();
  for (const k of Object.keys(s.muscleTargets)) s.muscleTargets[k] = [0, 50];
  s.muscleTargets.back = [14, 22];
  s.muscleTargets.sidedelt = [0, 2];
  const data = mk({ settings: s, sessions: [
    ses('p', W.w4, [['remo_pecho_apoyado', [set(60, 10), set(60, 10), set(60, 10)]], ['elevaciones_laterales', [set(10, 15), set(10, 15), set(10, 15)]]]),
    ses('q', W.w3, [['remo_pecho_apoyado', [set(60, 10), set(60, 10)]]]),
  ] });
  const r = weeklyInsights(data, W.w4);
  const below = byId(r, 'muscles-below');
  assert.equal(below.title, 'Espalda por debajo del rango');
  assert.equal(below.text, '3 series esta semana; tu rango es 14–22. Semana anterior: 2 (+1).');
  const above = byId(r, 'muscles-above');
  assert.equal(above.title, 'Hombro lateral por encima del rango');
  assert.equal(above.text, '3 series esta semana; tu máximo es 2. Semana anterior: 0 (+3).');
});

test('semana en curso: «a falta de N días», sin dar por malo lo que aún se puede completar', () => {
  const data = mk({ sessions: [ses('p', W.cur, [['remo_pecho_apoyado', [set(60, 10), set(60, 10), set(60, 10)]]]), ses('q', W.w4, [['remo_pecho_apoyado', [set(60, 10)]]])] });
  const r = weeklyInsights(data);
  const m = byId(r, 'muscles');
  assert.match(m.text, /^Semana en curso, a falta de 4 días \(hoy incluido\)/);
  const below = byId(r, 'muscles-below');
  assert.equal(below.level, 'neutral', 'no es un aviso mientras la semana sigue');
  assert.equal(below.tag, 'En curso');
  assert.match(below.title, /aún por debajo del mínimo/);
  assert.match(below.text, /faltan 11/);
  assert.match(below.why.rule, /recuento provisional/);
  const back = m.items.find((x) => x.muscleId === 'back');
  assert.equal(back.pending, true);
  assert.equal(back.statusLabel, 'Faltan 11');
  // En curso, el porqué no compara una semana a medias con una entera (sin Δ)
  assert.ok(m.why.data.some((x) => x.label === 'Espalda' && x.value === '3 series · rango 14–22 · semana anterior 1'));
  // La misma semana, ya terminada: «por debajo del rango» (warn)
  const done = weeklyInsights({ ...data, today: '2026-09-30' }, W.cur);
  assert.equal(byId(done, 'muscles-below').level, 'warn');
  assert.equal(byId(done, 'muscles').items.find((x) => x.muscleId === 'back').statusLabel, 'Por debajo');
});

test('primera semana con registros: sin comparación con una semana anterior inexistente', () => {
  const data = mk({ sessions: [ses('p', W.w4, [['remo_pecho_apoyado', [set(60, 10)]], ['press_banca', [set(80, 5)]]])] });
  const r = weeklyInsights(data, W.w4);
  const m = byId(r, 'muscles');
  assert.match(m.text, /primera semana con registros/);
  assert.ok(m.items.every((x) => x.deltaLabel === '—'));
  assert.ok(m.why.data.every((x) => /semana anterior sin registros/.test(x.value)));
  assert.match(byId(r, 'push-pull').text, /primera semana con registros/);
});

// ===========================================================================
// INFORMACIÓN 3 · Empuje / tirón
// ===========================================================================

test('empuje/tirón: series por patrón del ejercicio (aislamientos fuera), good si tirones ≥ empujes', () => {
  const data = mk({ sessions: [
    ses('p', W.w4, [
      ['press_banca', [set(80, 5), set(80, 5), set(80, 5)]], // push_h
      ['press_militar', [set(40, 8), set(40, 8)]], // push_v
      ['remo_pecho_apoyado', [set(60, 10), set(60, 10), set(60, 10)]], // pull_h
      ['dominadas', [set(null, 8), set(null, 8)]], // pull_v
      ['triceps_polea', [set(20, 12), set(20, 12)]], // aislamiento: no cuenta
      ['curl_barra', [set(20, 12)]], // aislamiento: no cuenta
    ]),
    ses('q', W.w3, [['press_banca', [set(80, 5), set(80, 5)]], ['remo_pecho_apoyado', [set(60, 10)]]]),
  ] });
  const m = byId(weeklyInsights(data, W.w4), 'push-pull');
  assert.equal(m.level, 'good');
  assert.equal(m.title, 'Tirones igual que empujes');
  assert.deepEqual([m.push, m.pull, m.prevPush, m.prevPull], [5, 5, 2, 1]);
  assert.match(m.text, /^5 series de tirón y 5 de empuje \(semana anterior: 1 de tirón y 2 de empuje\)/);
  assert.match(m.why.rule, /empuje = empuje horizontal y empuje vertical; tirón = tirón horizontal y tirón vertical/);
  assert.match(m.why.rule, /Cada serie cuenta 1/);
  const rows = m.why.data.map((x) => `${x.label}=${x.value}`);
  assert.ok(rows.includes('Press banca · Empuje horizontal=3 series'));
  assert.ok(rows.includes('Dominadas · Tirón vertical=2 series'));
  assert.ok(!rows.some((x) => /Extensión de tríceps|Curl con barra/.test(x)), 'los aislamientos no aparecen');
  assert.ok(rows.includes('Semana anterior=tirón 1 · empuje 2'));
});

test('empuje/tirón: más empujes → warn en semana terminada y neutral («de momento») en curso', () => {
  const items = [['press_banca', [set(80, 5), set(80, 5), set(80, 5)]], ['remo_pecho_apoyado', [set(60, 10)]]];
  const past = byId(weeklyInsights(mk({ sessions: [ses('p', W.w4, items)] }), W.w4), 'push-pull');
  assert.equal(past.level, 'warn');
  assert.equal(past.title, 'Más empujes que tirones');
  assert.match(past.text, /faltaron 2 series de tirón/);
  const cur = byId(weeklyInsights(mk({ sessions: [ses('p', W.cur, items)] })), 'push-pull');
  assert.equal(cur.level, 'neutral');
  assert.equal(cur.title, 'De momento, más empujes que tirones');
  assert.match(cur.text, /a falta de 4 días \(hoy incluido\); para igualar harían falta 2 series de tirón más/);
  const none = byId(weeklyInsights(mk({ sessions: [ses('p', W.w4, [['curl_barra', [set(20, 10)]]])] }), W.w4), 'push-pull');
  assert.equal(none.level, 'neutral');
  assert.match(none.title, /sin series esta semana/);
});

// ===========================================================================
// INFORMACIÓN 4–5 · Carga y kilómetros
// ===========================================================================

test('carga: total y por tipo frente a la media de las 4 semanas previas (sin contar la actual)', () => {
  const sessions = [
    act('o0', 'other', W.w0, { min: 60, rpe: 5 }), // 300
    act('o1', 'other', W.w1, { min: 60, rpe: 5 }), // 300
    act('o2', 'other', W.w2, { min: 80, rpe: 5 }), // 400
    act('o3', 'other', W.w3, { min: 100, rpe: 5 }), // 500
    act('o4', 'other', W.w4, { min: 60, rpe: 10 }), // 600
    ses('s4', W.w4, [['press_banca', [set(80, 5)]]], { durationMin: 30, rpe: 6 }), // 180
  ];
  const d = mk({ sessions });
  const m = byId(weeklyInsights(d, W.w4), 'load');
  // Previas: 17 ago … 7 sep = 300, 300, 400, 500 → media 375; esta = 780 → +108 %
  assert.equal(m.total, 780);
  assert.equal(m.mean, 375);
  assert.equal(Math.round(m.pct), 108);
  assert.equal(m.text, '780 (minutos × esfuerzo), +108 % frente a la media de las 4 semanas previas (375).');
  const rows = weeklySeries(d, W.w0, W.w4);
  assert.equal(rows.at(-1).loadTotal, m.total, 'mismo total que stats.weeklySeries');
  assert.ok(m.items.some((x) => x.kind === 'strength' && x.label === 'Fuerza' && x.load === 180));
  assert.ok(m.items.some((x) => x.kind === 'other' && x.load === 600 && x.mean === 375));
  assert.ok(m.why.data.some((x) => x.label === 'Semana 7–13 sep' && x.value === '500'));
  assert.ok(m.why.data.some((x) => x.label === 'Media de las semanas previas' && x.value === '375'));
  assert.ok(m.why.data.some((x) => x.label === 'Variación' && x.value === '+108 %'));
});

test('carga: con menos de 2 semanas previas con datos, «sin referencia suficiente»; las semanas previas al primer registro no cuentan', () => {
  const one = mk({ sessions: [act('a', 'other', W.w3, { min: 60 }), act('b', 'other', W.w4, { min: 120 })] });
  const m = byId(weeklyInsights(one, W.w4), 'load');
  assert.equal(m.enough, false);
  assert.equal(m.pct, null);
  assert.match(m.text, /Sin referencia suficiente: hacen falta al menos 2 semanas previas con carga \(hay 1\)/);
  // Dos semanas previas (primer registro el 31 ago): la media es de esas 2, no de 4 con ceros
  const two = mk({ sessions: [act('a', 'other', W.w2, { min: 60 }), act('b', 'other', W.w3, { min: 100 }), act('c', 'other', W.w4, { min: 80 })] });
  const m2 = byId(weeklyInsights(two, W.w4), 'load');
  assert.equal(m2.mean, 400); // (300 + 500) / 2
  assert.match(m2.text, /media de las 2 semanas previas \(400\)/);
  // Una semana sin sesiones DESPUÉS de empezar sí cuenta (con 0)
  const gap = mk({ sessions: [act('a', 'other', W.w0, { min: 60 }), act('b', 'other', W.w2, { min: 60 }), act('c', 'other', W.w3, { min: 60 }), act('d', 'other', W.w4, { min: 60 })] });
  assert.equal(byId(weeklyInsights(gap, W.w4), 'load').mean, 225); // (300 + 0 + 300 + 300) / 4
});

test('carga en curso: «de momento», porcentaje de la media y no un negativo engañoso', () => {
  const d = mk({ sessions: [act('a', 'other', W.w3, { min: 100 }), act('b', 'other', W.w4, { min: 100 }), act('c', 'other', W.cur, { min: 50 })] });
  const m = byId(weeklyInsights(d), 'load');
  assert.equal(m.text, 'De momento 250 (minutos × esfuerzo), el 50 % de la media de las 2 semanas previas (500), a falta de 4 días (hoy incluido).');
  assert.ok(m.why.data.some((x) => x.label === 'De momento' && /el 50 % de la media/.test(x.value)));
  assert.ok(!m.why.data.some((x) => /−50 %/.test(x.value)));
});

test('kilómetros: por deporte frente a la semana anterior y a la media de 4 semanas (natación en metros)', () => {
  const d = mk({ sessions: [
    act('r0', 'run', W.w1, { km: 10 }), act('r1', 'run', W.w2, { km: 12 }), act('r2', 'run', W.w3, { km: 14 }), act('r3', 'run', W.w4, { km: 18 }),
    act('s3', 'swim', W.w3, { km: 1 }), act('s4', 'swim', W.w4, { km: 1.5 }),
  ] });
  const m = byId(weeklyInsights(d, W.w4), 'km');
  assert.equal(m.text, 'Carrera 18 km (+29 % frente a la semana anterior) · Natación 1.500 m (+50 % frente a la semana anterior).');
  const run = m.items.find((x) => x.kind === 'run');
  assert.deepEqual([run.km, run.prevKm, run.meanKm], [18, 14, 12]); // media (10 + 12 + 14) / 3
  assert.equal(Math.round(run.pctMean), 50);
  const swim = m.items.find((x) => x.kind === 'swim');
  assert.equal(swim.meanKm, null, 'natación: solo 1 semana previa con km → sin referencia');
  assert.match(swim.value, /media sin ref\./);
  assert.ok(m.why.data.some((x) => x.label === 'Semana anterior' && x.value === '14 km (variación +29 %)'));
  assert.ok(!m.items.some((x) => x.kind === 'bike'), 'sin bici no hay fila de bici');
  assert.equal(byId(weeklyInsights(mk({ sessions: [ses('p', W.w4, [['press_banca', [set(80, 5)]]])] }), W.w4), 'km'), undefined, 'sin km no hay mensaje');
});

// ===========================================================================
// INFORMACIÓN 6 · Progresan / se mantienen / se estancan
// ===========================================================================

/** Sesiones semanales de un ejercicio con los 1RM que salen de (peso, reps, rir). */
function series(exId, weeks, sets, target) {
  return weeks.map((wk, i) => ses(`${exId}_${i}`, typeof wk === 'string' && W[wk] ? W[wk] : wk, [[exId, sets(i), target]]));
}

test('progresa: nuevo mejor 1RM estimado en las últimas sesiones; why con las cifras por sesión', () => {
  const d = mk({ sessions: series('press_banca', ['w1', 'w2', 'w3', 'w4'], (i) => [set(80 + 2.5 * i, 5, 1)]) });
  const m = byId(weeklyInsights(d, W.w4), 'ex-progress');
  assert.equal(m.level, 'good');
  assert.equal(m.title, 'Press banca progresa');
  assert.equal(m.text, `Nuevo mejor 1RM estimado: ${kg1(e1(87.5, 5, 1))} (14 sep, 87,5 kg × 5 @1).`);
  const rows = m.why.data;
  assert.equal(rows[0].label, 'Press banca');
  assert.match(rows[0].value, new RegExp(`mejor anterior ${kg1(e1(80, 5, 1))}`));
  assert.deepEqual(rows.filter((x) => x.sub).map((x) => x.value), [
    `${kg1(e1(82.5, 5, 1))} · 82,5 kg × 5 @1 · nuevo mejor`,
    `${kg1(e1(85, 5, 1))} · 85 kg × 5 @1 · nuevo mejor`,
    `${kg1(e1(87.5, 5, 1))} · 87,5 kg × 5 @1 · nuevo mejor`,
  ]);
  assert.match(m.why.rule, /al menos 3 sesiones/);
});

test('estancado por sesiones: sin superar el mejor previo en las últimas stall.sessions sesiones', () => {
  // 1RM: 100, 105 (mejor), 101, 102, 103 → las 3 últimas no superan 105
  const vals = [[75, 8, 2], [78.75, 8, 2], [75.75, 8, 2], [76.5, 8, 2], [77.25, 8, 2]];
  const d = mk({ sessions: series('remo_pecho_apoyado', ['w0', 'w1', 'w2', 'w3', 'w4'], (i) => [set(vals[i][0], vals[i][1], vals[i][2])]) });
  // stall.weeks alto para aislar el criterio de sesiones
  const r = weeklyInsights({ ...d, settings: settingsWith({ stall: { sessions: 3, weeks: 10 } }) }, W.w4);
  const m = byId(r, 'ex-stalled');
  assert.equal(m.level, 'warn');
  assert.equal(m.title, 'Remo con pecho apoyado estancado');
  assert.match(m.text, /en las últimas 3 sesiones\.$/);
  assert.ok(!/semanas\.$/.test(m.text));
  const rows = m.why.data;
  assert.match(rows[0].value, /mejor anterior 105 kg \(24 ago\)/);
  assert.equal(rows.filter((x) => x.sub).length, 3, 'las 3 sesiones del tramo');
  assert.ok(!rows.some((x) => /nuevo mejor/.test(x.value)));
  // Con stall.sessions = 4 el tramo incluye el mejor (105) → progresa
  const r4 = weeklyInsights({ ...d, settings: settingsWith({ stall: { sessions: 4, weeks: 10 } }) }, W.w4);
  assert.equal(byId(r4, 'ex-stalled'), undefined);
  assert.equal(byId(r4, 'ex-progress').title, 'Remo con pecho apoyado progresa');
});

test('estancado por semanas: sin superar el mejor previo en las últimas stall.weeks semanas (con ≥ 2 sesiones en el tramo)', () => {
  // Dos sesiones por semana: el mejor (105) el 31 ago; después, 4 sesiones sin superarlo
  const dates = ['2026-08-24', '2026-08-31', '2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17'];
  const w = [75, 78.75, 76, 77, 76.5, 78];
  const d = mk({ sessions: series('remo_pecho_apoyado', dates, (i) => [set(w[i], 8, 2)]) });
  // stall.sessions alto (10) para aislar el criterio de semanas; stall.weeks = 2 → desde el 7 sep
  const s = settingsWith({ stall: { sessions: 10, weeks: 2 } });
  const m = byId(weeklyInsights({ ...d, settings: s }, W.w4), 'ex-stalled');
  assert.ok(m, 'estancado por semanas');
  assert.match(m.text, /en las últimas 2 semanas\.$/);
  assert.match(m.why.rule, /últimas 10 sesiones o en las últimas 2 semanas/);
  assert.equal(m.why.data.filter((x) => x.sub).length, 4, 'las 4 sesiones de las 2 últimas semanas');
  // Con 1 sola sesión en el tramo de semanas no basta para hablar de estancamiento por semanas (y el mejor, del
  // 31 ago, está entre sus últimas 10 sesiones → progresa)
  const s1 = settingsWith({ stall: { sessions: 10, weeks: 1 } });
  const d1 = mk({ sessions: series('remo_pecho_apoyado', dates.slice(0, 5), (i) => [set(w[i], 8, 2)]) }); // última: 15 sep
  const r1 = weeklyInsights({ ...d1, settings: s1 }, W.w4);
  assert.equal(byId(r1, 'ex-stalled'), undefined);
  assert.equal(byId(r1, 'ex-progress').title, 'Remo con pecho apoyado progresa');
  // Mismas sesiones con stall.weeks = 2 (tramo 7–20 sep: 3 sesiones sin superar 105) → estancado
  assert.ok(byId(weeklyInsights({ ...d1, settings: settingsWith({ stall: { sessions: 10, weeks: 2 } }) }, W.w4), 'ex-stalled'));
});

test('se mantiene: 3 sesiones sin mejora (aún sin sesiones suficientes para hablar de estancamiento)', () => {
  const d = mk({ sessions: series('hack_squat', ['w2', 'w3', 'w4'], () => [set(100, 10, 1)]) });
  const m = byId(weeklyInsights(d, W.w4), 'ex-maintain');
  assert.equal(m.level, 'neutral');
  assert.equal(m.title, 'Sentadilla hack se mantiene');
  assert.match(m.text, /aún sin sesiones suficientes para hablar de estancamiento/);
  assert.equal(m.why.data[0].value, 'sin sesiones anteriores al tramo');
  assert.equal(m.why.data.filter((x) => x.sub).length, 3);
});

test('progreso: menos de 3 sesiones o sin sesiones recientes → no se clasifica (mensaje de datos insuficientes)', () => {
  assert.equal(MIN_SESSIONS, 3);
  const two = mk({ sessions: series('press_banca', ['w3', 'w4'], (i) => [set(80 + i, 5)]) });
  const r = weeklyInsights(two, W.w4);
  assert.ok(!ids(r.info).some((id) => ['ex-progress', 'ex-maintain', 'ex-stalled'].includes(id)));
  const none = byId(r, 'ex-none');
  assert.equal(none.level, 'neutral');
  assert.ok(none.why.data.some((x) => x.label === 'Press banca' && x.value === '2 sesiones'));
  // Hecho hace más de stall.weeks semanas: no entra aunque tenga muchas sesiones
  const old = mk({ sessions: [...series('press_banca', ['w0', 'w1', 'w2'], () => [set(80, 5)]), ses('x', W.w4, [['curl_barra', [set(20, 10)]]])] });
  const r2 = weeklyInsights({ ...old, settings: settingsWith({ stall: { sessions: 3, weeks: 1 } }) }, W.w4);
  assert.ok(!all(r2).some((m) => (m.items || []).some((it) => it.exerciseId === 'press_banca' && m.id.startsWith('ex-') && m.id !== 'ex-none')));
  // Ejercicios sin 1RM estimado (más de 12 reps, tiempo) no se clasifican
  const noE1 = mk({ sessions: series('elevaciones_laterales', ['w1', 'w2', 'w3', 'w4'], () => [set(10, 15)]) });
  assert.ok(byId(weeklyInsights(noE1, W.w4), 'ex-none'));
});

test('varios ejercicios por estado: un mensaje por estado con la lista (items) y todas las cifras en el porqué', () => {
  const r = weeklyInsights(mk({ sessions: strengthWeeks() }), W.w4);
  const stall = byId(r, 'ex-stalled');
  assert.equal(stall.title, '2 ejercicios estancados');
  assert.deepEqual(stall.items.map((x) => x.label).sort(), ['Jalón al pecho', 'Remo con pecho apoyado']);
  assert.ok(stall.items.every((x) => /^mejor .* kg · última .* kg$/.test(x.value)));
  assert.equal(byId(r, 'ex-progress').title, 'Press banca progresa');
});

// ===========================================================================
// SUGERENCIA 1 · Doble progresión
// ===========================================================================

function dpData(exId, sets, target, { date = W.w4, settings = defaultSettings() } = {}) {
  return mk({ settings, sessions: [ses('dp', date, [[exId, sets, target]], { templateName: 'Día 1 — Upper pesado' })] });
}
const dp = (data, week = W.w4) => weeklyInsights(data, week).suggestions;

test('doble progresión · compuesto de tren superior: todas las series al tope con RIR ≥ mínimo → «sube 2,5 kg»', () => {
  const sg = dp(dpData('press_banca', [warm(40, 8), set(80, 6, 2), set(80, 6, 1), set(80, 6, 1), pend(80, 6)], { repMin: 4, repMax: 6 }));
  const m = sg.find((x) => x.id === 'dp-up-press_banca');
  assert.equal(m.level, 'good');
  assert.equal(m.title, 'Press banca: sube 2,5 kg');
  assert.equal(m.text, 'En la última sesión (14 sep) todas las series efectivas llegaron al tope del rango (6 reps) con RIR ≥ 1. Próxima vez: de 80 a 82,5 kg.');
  const rows = m.why.data.map((x) => `${x.label}=${x.value}`);
  assert.ok(rows.includes('Última sesión=lun 14 sep · Día 1 — Upper pesado'));
  assert.ok(rows.includes('Objetivo=3×4–6 (tope 6 reps)'));
  assert.ok(rows.includes('Serie 1=80 kg × 6 @2 · ✓ tope y RIR'));
  assert.equal(m.why.data.filter((x) => /^Serie \d/.test(x.label)).length, 3, 'sin calentamiento ni pendiente');
  assert.ok(rows.includes('Incremento=compuesto de tren superior: 2,5 kg'));
  assert.match(m.why.rule, /RIR ≥ 1/);
  assert.equal(m.items[0].weight, 80);
  assert.equal(sg.find((x) => x.id === 'dp-hold'), undefined);
});

test('doble progresión · tren inferior 5 kg, aislamiento «1–2 kg», core como aislamiento e incrementos editados', () => {
  assert.equal(dp(dpData('sentadilla', [set(100, 6), set(100, 6)], { repMin: 4, repMax: 6 })).find((x) => x.id === 'dp-up-sentadilla').title, 'Sentadilla: sube 5 kg');
  const iso = dp(dpData('curl_supinador', [set(12, 15), set(12, 15)], { repMin: 10, repMax: 15 })).find((x) => x.id === 'dp-up-curl_supinador');
  assert.equal(iso.title, 'Curl supinador: sube 1–2 kg');
  assert.match(iso.text, /de 12 a 13–14 kg\.$/);
  assert.ok(iso.why.data.some((x) => x.label === 'Incremento' && x.value === 'aislamiento o core: 1–2 kg'));
  const core = dp(dpData('crunch_polea', [set(35, 15), set(35, 15)], { repMin: 10, repMax: 15 })).find((x) => x.id === 'dp-up-crunch_polea');
  assert.equal(core.title, 'Crunch en polea: sube 1–2 kg');
  const s = settingsWith({ increments: { upperCompound: 5, lowerCompound: 10, isolation: 2 } });
  assert.equal(dp(dpData('press_banca', [set(80, 6), set(80, 6)], { repMin: 4, repMax: 6 }, { settings: s })).find((x) => x.id === 'dp-up-press_banca').title, 'Press banca: sube 5 kg');
  const iso2 = dp(dpData('curl_supinador', [set(12, 15)], { repMin: 10, repMax: 15 }, { settings: s })).find((x) => x.id === 'dp-up-curl_supinador');
  assert.equal(iso2.title, 'Curl supinador: sube 2 kg');
  assert.match(iso2.text, /de 12 a 14 kg\.$/);
  assert.match(iso2.why.rule, /5 kg en compuestos de tren superior, 10 kg en compuestos de tren inferior y 2 kg en aislamiento/);
});

test('doble progresión · peso corporal: añade lastre o reduce asistencia', () => {
  const t = { repMin: 5, repMax: 8 };
  const none = dp(dpData('dominadas', [set(null, 8), set(null, 8)], t)).find((x) => x.id === 'dp-up-dominadas');
  assert.equal(none.title, 'Dominadas: añade 2,5 kg de lastre');
  assert.match(none.text, /Próxima vez: \+2,5 kg de lastre \(ahora sin lastre\)\.$/);
  const lastre = dp(dpData('dominadas', [set(10, 8), set(10, 8)], t)).find((x) => x.id === 'dp-up-dominadas');
  assert.match(lastre.text, /lastre de \+10 a \+12,5 kg\.$/);
  const asist = dp(dpData('dominadas', [set(-15, 8), set(-15, 8)], t)).find((x) => x.id === 'dp-up-dominadas');
  assert.equal(asist.title, 'Dominadas: reduce 2,5 kg la asistencia');
  assert.match(asist.text, /asistencia de 15 a 12,5 kg\.$/);
  const last = dp(dpData('dominadas', [set(-2, 8)], t)).find((x) => x.id === 'dp-up-dominadas');
  assert.match(last.text, /quita la asistencia/);
  assert.match(none.why.rule, /peso corporal: añade lastre o reduce asistencia/);
  // Aislamiento de peso corporal (nordic): 1–2 kg de lastre
  assert.equal(dp(dpData('nordic', [set(null, 10)], { repMin: 8, repMax: 10 })).find((x) => x.id === 'dp-up-nordic').title, 'Nordic curl: añade 1–2 kg de lastre');
});

test('doble progresión · unilateral: por lado y con el lado de menos repeticiones', () => {
  const t = { repMin: 8, repMax: 10 };
  const up = dp(dpData('remo_unilateral', [uni(24, 10, 10), uni(24, 10, 11)], t)).find((x) => x.id === 'dp-up-remo_unilateral');
  assert.equal(up.title, 'Remo unilateral con mancuerna: sube 2,5 kg por lado');
  assert.match(up.text, /de 24 a 26,5 kg por lado\.$/);
  assert.ok(up.why.data.some((x) => x.label === 'Incremento' && /por lado$/.test(x.value)));
  const lower = dp(dpData('bulgara', [uni(16, 8, 8)], { repMin: 8, repMax: 8 })).find((x) => x.id === 'dp-up-bulgara');
  assert.equal(lower.title, 'Sentadilla búlgara: sube 5 kg por lado');
  // Un lado sin llegar al tope → mantener
  const sg = dp(dpData('remo_unilateral', [uni(24, 10, 9), uni(24, 10, 10)], t));
  assert.equal(sg.find((x) => x.id === 'dp-up-remo_unilateral'), undefined);
  const hold = sg.find((x) => x.id === 'dp-hold');
  assert.ok(hold.why.data.some((x) => x.sub && x.value === '24 kg × 10/9 @1 · falta 1 rep'));
});

test('doble progresión · RIR: por debajo del mínimo, al fallo o sin registrar → mantener; minRir editado cambia el resultado', () => {
  const t = { repMin: 4, repMax: 6 };
  const low = dp(dpData('press_banca', [set(80, 6, 1), set(80, 6, 0)], t));
  assert.equal(low.find((x) => x.id === 'dp-up-press_banca'), undefined);
  const hold = low.find((x) => x.id === 'dp-hold');
  assert.equal(hold.text, 'Press banca: todas en el tope, pero 1 con RIR por debajo de 1 o sin registrar en la última sesión (14 sep). Con el mismo peso, intenta sumar repeticiones hasta el tope.');
  assert.ok(hold.why.data.some((x) => x.value === '80 kg × 6 @0 · RIR 0 < 1'));
  const fail = dp(dpData('press_banca', [set(80, 6, 1), set(80, 6, 'F', { type: 'failure' })], t)).find((x) => x.id === 'dp-hold');
  assert.ok(fail.why.data.some((x) => x.label === 'Serie 2 (al fallo)' && /@F · RIR 0 < 1$/.test(x.value)));
  const unk = dp(dpData('press_banca', [set(80, 6, null), set(80, 6, 2)], t)).find((x) => x.id === 'dp-hold');
  assert.ok(unk.why.data.some((x) => x.value === '80 kg × 6 · sin RIR registrado'));
  // minRir = 0: RIR 0 y sin RIR valen
  const s0 = settingsWith({ progression: { minRir: 0 } });
  assert.ok(dp(dpData('press_banca', [set(80, 6, 0), set(80, 6, null)], t, { settings: s0 })).find((x) => x.id === 'dp-up-press_banca'));
  // minRir = 2: RIR 1 ya no basta
  const s2 = settingsWith({ progression: { minRir: 2 } });
  const r2 = dp(dpData('press_banca', [set(80, 6, 2), set(80, 6, 1)], t, { settings: s2 }));
  assert.equal(r2.find((x) => x.id === 'dp-up-press_banca'), undefined);
  assert.match(r2.find((x) => x.id === 'dp-hold').why.rule, /RIR ≥ 2/);
});

test('doble progresión · el drop set también tiene que llegar al tope; los calentamientos no cuentan', () => {
  const t = { repMin: 8, repMax: 10 };
  const sg = dp(dpData('jalon_pecho', [warm(20, 5), set(55, 10), set(40, 8, 1, { type: 'drop' })], t));
  const hold = sg.find((x) => x.id === 'dp-hold');
  assert.ok(hold, 'el drop set no llegó al tope');
  assert.ok(hold.why.data.some((x) => x.label === 'Serie 2 (drop set)' && /faltan 2 reps$/.test(x.value)));
  assert.equal(hold.why.data.filter((x) => /^Serie \d/.test(x.label)).length, 2);
});

test('doble progresión · mantener: un único mensaje agrupado con la lista, las series concretas y el rango', () => {
  const data = mk({ sessions: [ses('x', W.w4, [
    ['press_banca', [set(80, 6), set(80, 5), set(80, 5)], { repMin: 4, repMax: 6 }],
    ['remo_pecho_apoyado', [set(60, 10), set(60, 9), set(60, 8)]],
    ['sentadilla', [set(100, 6), set(100, 6)], { repMin: 4, repMax: 6 }],
  ])] });
  const sg = dp(data);
  const holds = sg.filter((x) => x.title === 'Mantén el peso y busca más repeticiones');
  assert.equal(holds.length, 1);
  const hold = holds[0];
  assert.equal(hold.id, 'dp-hold');
  assert.equal(hold.level, 'neutral');
  assert.deepEqual(hold.items.map((x) => [x.label, x.value]).sort(), [
    ['Press banca', '1 de 3 series en el tope (6 reps)'],
    ['Remo con pecho apoyado', '1 de 3 series en el tope (10 reps)'],
  ]);
  assert.match(hold.text, /^En 2 ejercicios no todas las series efectivas llegaron al tope del rango con RIR ≥ 1/);
  const rows = hold.why.data.map((x) => `${x.label}=${x.value}`);
  assert.ok(rows.includes('Remo con pecho apoyado · 3×8–10=14 sep · 1 de 3 series en el tope (10 reps)'));
  assert.ok(rows.includes('Serie 3=60 kg × 8 @1 · faltan 2 reps'));
  assert.ok(sg.find((x) => x.id === 'dp-up-sentadilla'));
});

test('doble progresión · solo la última sesión de cada ejercicio, de esta semana o la anterior, y con rango de reps', () => {
  const t = { repMin: 4, repMax: 6 };
  // La última (14 sep) no llega al tope aunque la anterior sí
  const d = mk({ sessions: [ses('a', W.w3, [['press_banca', [set(80, 6)], t]]), ses('b', W.w4, [['press_banca', [set(82.5, 5)], t]])] });
  const sg = dp(d);
  assert.equal(sg.find((x) => x.id === 'dp-up-press_banca'), undefined);
  assert.ok(sg.find((x) => x.id === 'dp-hold').items.some((x) => x.exerciseId === 'press_banca' && x.weight === 82.5));
  // Vista de la semana del 7 sep: su última sesión es la del 7 sep (al tope) → sube
  assert.ok(dp(d, W.w3).find((x) => x.id === 'dp-up-press_banca'));
  // Semana en curso sin sesiones aún: cuenta la de la semana anterior
  assert.ok(dp(mk({ sessions: [ses('a', W.w4, [['press_banca', [set(80, 6)], t]])] }), W.cur).find((x) => x.id === 'dp-up-press_banca'));
  // Hace más de una semana completa → fuera
  assert.equal(dp(mk({ sessions: [ses('a', W.w3, [['press_banca', [set(80, 6)], t]])] }), W.cur).filter((x) => x.id.startsWith('dp')).length, 0);
  // Sin rango de repeticiones en la sesión → fuera
  const noRange = mk({ sessions: [ses('a', W.w4, [['press_banca', [set(80, 6)], { repMin: null, repMax: null }]])] });
  assert.equal(dp(noRange).filter((x) => x.id.startsWith('dp')).length, 0);
  // Tipos sin carga (tiempo, saltos) → fuera
  const time = mk({ sessions: [ses('a', W.w4, [['plancha', [set(null, null, null, { timeSec: 45 })], { repMin: null, repMax: null, timeMin: 30, timeMax: 45 }]])] });
  assert.equal(dp(time).filter((x) => x.id.startsWith('dp')).length, 0);
});

test('incrementFor: compuesto superior/inferior, aislamiento, core y región full/sin categoría', () => {
  const inc = defaultSettings().increments;
  const ex = (id) => EXMAP.get(id);
  assert.deepEqual([incrementFor(ex('press_banca'), inc).kind, incrementFor(ex('press_banca'), inc).text], ['upperCompound', '2,5 kg']);
  assert.equal(incrementFor(ex('peso_muerto_rumano'), inc).kind, 'lowerCompound');
  assert.equal(incrementFor(ex('elevaciones_laterales'), inc).text, '1–2 kg');
  assert.equal(incrementFor(ex('rueda_abdominal'), inc).kind, 'isolation');
  assert.equal(incrementFor({ category: 'compound', region: 'full', pattern: 'hinge' }, inc).kind, 'lowerCompound');
  assert.equal(incrementFor({ category: 'compound', region: 'full', pattern: 'push_v' }, inc).kind, 'upperCompound');
  assert.equal(incrementFor({ pattern: 'isolation' }, inc).kind, 'isolation');
  assert.equal(incrementFor({ category: 'isolation' }, { isolation: 1.5 }).text, '1,5 kg');
});

// ===========================================================================
// SUGERENCIA 2 · Avisos orientativos de carga y km de carrera
// ===========================================================================

/** Carga de las 4 semanas previas = 400 cada una; esta semana = `cur`. */
function loadData(cur, extra = {}) {
  const sessions = ['w0', 'w1', 'w2', 'w3'].map((wk) => act(`o_${wk}`, 'other', W[wk], { min: 80, rpe: 5 }));
  sessions.push(act('o_w4', 'other', W.w4, { min: cur / 5, rpe: 5 }));
  return mk({ sessions, ...extra });
}

test('aviso de carga: suave por encima de loadWarn.low, aviso por encima de loadWarn.high; prudente, nunca predicción', () => {
  const soft = byId(weeklyInsights(loadData(500), W.w4), 'load-warn'); // +25 %
  assert.equal(soft.level, 'warn');
  assert.equal(soft.tag, 'Aviso suave');
  assert.equal(soft.severity, 'soft');
  assert.equal(soft.title, 'Aviso suave: la carga sube un 25 %');
  assert.equal(soft.text, 'La carga de esta semana (500) supera en un 25 % la media de las 4 semanas previas (400). Aviso orientativo: conviene que las subidas de carga sean graduales.');
  assert.match(soft.why.rule, /más de un 20 % \(aviso suave\) o de un 30 % \(aviso\)/);
  assert.match(soft.why.rule, /no una predicción de lesión/);
  assert.ok(!/lesi[oó]n|riesgo|peligro/i.test(`${soft.title} ${soft.text}`), 'el texto no habla de lesiones');
  assert.ok(soft.why.data.some((x) => /^Media de las 4 semanas previas$/.test(x.label) && x.value === '400'));
  assert.ok(soft.why.data.some((x) => x.label === 'Variación' && x.value === '+25 %'));
  const high = byId(weeklyInsights(loadData(560), W.w4), 'load-warn'); // +40 %
  assert.equal(high.tag, 'Aviso');
  assert.equal(high.severity, 'high');
  // Justo en el umbral (+20 %) no avisa
  assert.equal(byId(weeklyInsights(loadData(480), W.w4), 'load-warn'), undefined);
  // Umbrales editados
  const s = settingsWith({ loadWarn: { low: 50, high: 60 } });
  assert.equal(byId(weeklyInsights(loadData(560, { settings: s }), W.w4), 'load-warn'), undefined);
  const s2 = settingsWith({ loadWarn: { low: 5, high: 10 } });
  assert.equal(byId(weeklyInsights(loadData(460, { settings: s2 }), W.w4), 'load-warn').tag, 'Aviso'); // +15 % > 10 %
  // Sin referencia suficiente: nunca avisa
  const noRef = mk({ sessions: [act('a', 'other', W.w3, { min: 10 }), act('b', 'other', W.w4, { min: 200 })] });
  assert.equal(byId(weeklyInsights(noRef, W.w4), 'load-warn'), undefined);
});

test('aviso de km de carrera: frente a la semana anterior, solo si esa semana llegó a runKmWarn.minBaseKm', () => {
  const run = (prev, cur, extra = {}) => mk({ sessions: [act('r0', 'run', W.w3, { km: prev, min: 10 }), act('r1', 'run', W.w4, { km: cur, min: 10 })], ...extra });
  const high = byId(weeklyInsights(run(10, 12), W.w4), 'runkm-warn'); // +20 %
  assert.equal(high.level, 'warn');
  assert.equal(high.tag, 'Aviso');
  assert.equal(high.title, 'Aviso: km de carrera +20 %');
  assert.equal(high.text, 'Corriste 12 km esta semana frente a 10 km la anterior (+20 %). Aviso orientativo: en carrera conviene subir el volumen de forma gradual.');
  assert.match(high.why.rule, /no una predicción de lesión/);
  assert.ok(high.why.data.some((x) => x.label === 'Semana anterior' && x.value === '10 km'));
  assert.equal(byId(weeklyInsights(run(10, 11.2), W.w4), 'runkm-warn').tag, 'Aviso suave'); // +12 %
  assert.equal(byId(weeklyInsights(run(10, 11), W.w4), 'runkm-warn'), undefined); // +10 %: no supera
  // Semana anterior por debajo del mínimo (4 < 5 km): aunque se duplique, no se evalúa
  const small = weeklyInsights(run(4, 8), W.w4);
  assert.equal(byId(small, 'runkm-warn'), undefined);
  const ok = byId(small, 'load-ok');
  assert.match(ok.text, /km de carrera: no se evalúa \(la semana anterior tuvo 4 km, menos de 5 km\)/);
  assert.ok(ok.why.data.some((x) => x.label === 'Variación' && /no se evalúa \(menos de 5 km\)/.test(x.value)));
  // minBaseKm editado a 3 → sí se evalúa
  const s = settingsWith({ runKmWarn: { minBaseKm: 3 } });
  assert.equal(byId(weeklyInsights(run(4, 8, { settings: s }), W.w4), 'runkm-warn').tag, 'Aviso');
  // Umbrales editados
  const s2 = settingsWith({ runKmWarn: { low: 25, high: 40 } });
  assert.equal(byId(weeklyInsights(run(10, 12, { settings: s2 }), W.w4), 'runkm-warn'), undefined);
});

test('sin avisos: mensaje neutral «Sin avisos de carga» con las cifras frente a cada umbral', () => {
  const r = weeklyInsights(mk({ sessions: [
    ...['w0', 'w1', 'w2', 'w3'].map((wk) => act(`r_${wk}`, 'run', W[wk], { km: 10, min: 60, rpe: 5 })),
    act('r_w4', 'run', W.w4, { km: 10.5, min: 63, rpe: 5 }),
  ] }), W.w4);
  const ok = byId(r, 'load-ok');
  assert.equal(ok.level, 'neutral');
  assert.equal(ok.text, 'La carga queda un 5 % por encima de tu media (aviso desde +20 %); km de carrera +5 % frente a la semana anterior (aviso desde +10 %).');
  assert.ok(ok.why.data.some((x) => x.label === 'Umbrales' && /\+20 % aviso suave · \+30 % aviso/.test(x.value)));
  assert.ok(ok.why.data.some((x) => x.label === 'Umbrales' && /mínimo 5 km la semana anterior/.test(x.value)));
  assert.equal(byId(r, 'load-warn'), undefined);
});

test('avisos en la semana en curso: lo ya superado avisa («de momento»); lo que va por debajo no se da por malo', () => {
  const sessions = ['w1', 'w2', 'w3', 'w4'].map((wk) => act(`o_${wk}`, 'other', W[wk], { min: 80, rpe: 5 }));
  const over = byId(weeklyInsights(mk({ sessions: [...sessions, act('c', 'other', W.cur, { min: 120, rpe: 5 })] })), 'load-warn');
  assert.match(over.text, /^De momento \(quedan 4 días \(hoy incluido\)\), la carga de esta semana \(600\) supera en un 50 %/);
  const under = byId(weeklyInsights(mk({ sessions: [...sessions, act('c', 'other', W.cur, { min: 20, rpe: 5 })] })), 'load-ok');
  assert.match(under.text, /^De momento, la carga \(100\) no supera la media de las 4 semanas previas \(400\) en más de un 20 %/);
});

// ===========================================================================
// SUGERENCIA 3 · Descarga
// ===========================================================================

/** 3 ejercicios estancados (remo, jalón, sentadilla) y RPE de fuerza `rpe` en todas las sesiones. */
function deloadData({ rpe = 9, checkins = [], settings = defaultSettings(), today = TODAY } = {}) {
  const sessions = [];
  ['w0', 'w1', 'w2', 'w3', 'w4', 'cur'].forEach((wk) => {
    sessions.push(ses(`s_${wk}`, W[wk], [
      ['remo_pecho_apoyado', [set(60, 10)]], ['jalon_pecho', [set(55, 10)]], ['sentadilla', [set(100, 5)], { repMin: 4, repMax: 6 }],
    ], { rpe }));
  });
  return mk({ sessions, checkins, settings, today });
}
const ck = (date, sleep, energy, soreness, timing = 'pre') => ({ id: `ck_${date}_${timing}`, date, timing, sessionId: null, sleep, energy, soreness, createdAt: 1 });

test('descarga: se sugiere si coinciden estancamiento, RPE alto sostenido y (sin check-ins) no hay más condiciones', () => {
  const r = weeklyInsights(deloadData());
  const m = byId(r, 'deload');
  assert.equal(m.level, 'warn');
  assert.equal(m.title, 'Valora una semana de descarga');
  assert.equal(m.text, 'Coinciden 3 ejercicios estancados y un RPE medio de 9 en las sesiones de fuerza de las últimas 2 semanas. Una semana con menos series y menos esfuerzo puede ayudarte a recuperar y retomar la progresión.');
  assert.deepEqual(m.conditions, { stalled: true, rpe: true, checkins: true, checkinsApply: false });
  const rows = m.why.data.map((x) => `${x.label}=${x.value}`);
  assert.ok(rows.includes('(a) Ejercicios estancados=3 (mínimo 3) · se cumple'));
  assert.ok(rows.includes('(b) RPE medio de fuerza (11 sep–24 sep)=9 en 2 sesiones (umbral 8) · se cumple'), rows.join('\n'));
  assert.ok(rows.includes('(c) Check-ins (11 sep–24 sep)=sin check-ins en el periodo · no se tiene en cuenta'));
  assert.ok(m.why.data.some((x) => x.sub && x.label.startsWith('21 sep') && x.value === 'RPE 9'));
  assert.equal(byId(r, 'deload-none'), undefined);
});

test('descarga: con check-ins en el periodo, hace falta que al menos la mitad sean bajos', () => {
  const mostlyOk = weeklyInsights(deloadData({ checkins: [ck('2026-09-21', 2, 2, 2), ck('2026-09-22', 1, 2, 2), ck('2026-09-23', 2, 2, 2)] }));
  const none = byId(mostlyOk, 'deload-none');
  assert.equal(none.level, 'neutral');
  assert.equal(none.title, 'Sin señales de necesitar descarga');
  assert.equal(none.text, 'No coinciden las condiciones. Estancados 3 (mínimo 3): sí · RPE medio de fuerza 9 (umbral 8): sí · check-ins bajos 1 de 3: no.');
  assert.ok(none.why.data.some((x) => x.label.startsWith('(c)') && x.value === '1 de 3 bajos (hace falta la mitad) · no se cumple'));
  assert.ok(none.why.data.some((x) => x.sub && x.label === '22 sep · antes' && x.value === 'sueño bajo · energía normal · agujetas normales · bajo'));
  // Exactamente la mitad (agujetas altas cuentan como bajo) → sí
  const half = byId(weeklyInsights(deloadData({ checkins: [ck('2026-09-21', 2, 2, 3, 'post'), ck('2026-09-22', 2, 2, 2)] })), 'deload');
  assert.ok(half);
  assert.match(half.text, /y check-ins bajos \(1 de 2\)/);
  // Check-ins fuera del periodo (últimas 2 semanas) no cuentan
  const old = byId(weeklyInsights(deloadData({ checkins: [ck('2026-08-20', 2, 2, 2)] })), 'deload');
  assert.ok(old);
  // Check-ins como Map también sirven
  const asMap = new Map([ck('2026-09-21', 2, 2, 2), ck('2026-09-22', 2, 2, 2)].map((c) => [c.id, c]));
  assert.ok(byId(weeklyInsights(deloadData({ checkins: asMap })), 'deload-none'));
});

test('descarga: sin estancamiento suficiente o con RPE bajo → neutral con el estado de cada condición', () => {
  const lowRpe = byId(weeklyInsights(deloadData({ rpe: 7 })), 'deload-none');
  assert.ok(lowRpe.why.data.some((x) => x.label.startsWith('(b)') && x.value === '7 en 2 sesiones (umbral 8) · no se cumple'));
  assert.ok(lowRpe.why.data.some((x) => x.label.startsWith('(a)') && /se cumple$/.test(x.value)));
  // Umbrales editados: rpeHigh 7 → sí; minStalled 4 → no
  assert.ok(byId(weeklyInsights(deloadData({ rpe: 7, settings: settingsWith({ deload: { rpeHigh: 7 } }) })), 'deload'));
  const need4 = byId(weeklyInsights(deloadData({ settings: settingsWith({ deload: { minStalled: 4 } }) })), 'deload-none');
  assert.ok(need4.why.data.some((x) => x.label.startsWith('(a)') && x.value === '3 (mínimo 4) · no se cumple'));
  // deload.weeks = 1: del 18 al 24 sep solo hay 1 sesión de fuerza (lunes 21) → no basta para «sostenido»
  const oneWeek = byId(weeklyInsights(deloadData({ settings: settingsWith({ deload: { weeks: 1 } }) })), 'deload-none');
  assert.ok(oneWeek.why.data.some((x) => x.label.startsWith('(b)') && /en 1 sesión/.test(x.value) && /no se cumple$/.test(x.value)), 'con una sola sesión no hay «esfuerzo alto sostenido»');
  // Sin fuerza en el historial: no hay mensaje de descarga
  assert.equal(byId(weeklyInsights(mk({ sessions: [act('r', 'run', W.w4, { km: 5 })] }), W.w4), 'deload'), undefined);
  assert.equal(byId(weeklyInsights(mk({ sessions: [act('r', 'run', W.w4, { km: 5 })] }), W.w4), 'deload-none'), undefined);
});

test('isLowCheckin: sueño o energía bajos, o agujetas altas', () => {
  assert.equal(isLowCheckin({ sleep: 1, energy: 2, soreness: 2 }), true);
  assert.equal(isLowCheckin({ sleep: 2, energy: 1, soreness: 2 }), true);
  assert.equal(isLowCheckin({ sleep: 2, energy: 2, soreness: 3 }), true);
  assert.equal(isLowCheckin({ sleep: 3, energy: 3, soreness: 1 }), false);
  assert.equal(isLowCheckin({ sleep: null, energy: null, soreness: null }), false);
  assert.equal(isLowCheckin(null), false);
});

// ===========================================================================
// Mensajes clave (tarjeta resumen)
// ===========================================================================

test('keyMessages: 2–3 mensajes por prioridad (avisos primero), subidas agrupadas y sin los neutros de «sin avisos»', () => {
  const r = weeklyInsights(richData(), W.w4);
  const key = keyMessages(r, 3);
  assert.ok(key.length >= 2 && key.length <= 3);
  assert.ok(!key.some((m) => ['load-ok', 'deload-none', 'km'].includes(m.id)));
  const levels = key.map((m) => m.level);
  const firstNonWarn = levels.indexOf('good') === -1 ? levels.length : levels.indexOf('good');
  assert.ok(levels.slice(firstNonWarn).every((l) => l !== 'warn'), `avisos primero: ${ids(key)}`);
  for (const m of key) assert.ok(m.why && m.why.rule && m.why.data.length, `${m.id}: why`);
  // Varias subidas → un único mensaje agrupado
  const data = mk({ sessions: [ses('x', W.w4, [
    ['press_banca', [set(80, 6)], { repMin: 4, repMax: 6 }], ['sentadilla', [set(100, 6)], { repMin: 4, repMax: 6 }], ['curl_supinador', [set(12, 15)], { repMin: 10, repMax: 15 }],
  ])] });
  const k2 = keyMessages(weeklyInsights(data, W.w4), 3);
  const sum = k2.find((m) => m.id === 'dp-up-summary');
  assert.equal(sum.title, 'Puedes subir peso en 3 ejercicios');
  assert.equal(sum.level, 'good');
  assert.equal(sum.why.data.length, 3);
  assert.ok(!k2.some((m) => m.id.startsWith('dp-up-') && m.id !== 'dp-up-summary'));
  assert.equal(keyMessages(weeklyInsights(mk(), W.cur)).length, 0);
  // Con cualquier dato hay al menos 2 (la carga y las series por músculo como último recurso)
  const quiet = keyMessages(weeklyInsights(mk({ sessions: [ses('p', W.w4, [['remo_pecho_apoyado', [set(60, 10)]]])] }), W.w4), 3);
  assert.ok(quiet.length >= 2, ids(quiet).join());
  // «Aún por debajo del mínimo» solo es clave al final de la semana en curso
  const mon = mk({ today: '2026-09-21', sessions: [ses('p', W.w4, [['remo_pecho_apoyado', [set(60, 10)]]])] });
  const sun = { ...mon, today: '2026-09-27' };
  const rank = (d) => ids(keyMessages(weeklyInsights(d), 5)).indexOf('muscles-below');
  assert.ok(rank(sun) >= 0 && (rank(mon) === -1 || rank(mon) > rank(sun)), `${rank(mon)} / ${rank(sun)}`);
  assert.deepEqual(keyMessages(null), []);
  assert.equal(keyMessages(r, 1).length, 1);
});

test('pureza: weeklyInsights no muta los datos de entrada', () => {
  const d = richData();
  const snap = JSON.stringify({ sessions: d.sessions, settings: d.settings, checkins: d.checkins });
  weeklyInsights(d, W.cur);
  weeklyInsights(d, W.w4);
  keyMessages(weeklyInsights(d));
  assert.equal(JSON.stringify({ sessions: d.sessions, settings: d.settings, checkins: d.checkins }), snap);
  // Copia profunda de ajustes: mismo resultado
  const r1 = weeklyInsights(d, W.w4);
  const r2 = weeklyInsights({ ...d, settings: deepClone(d.settings) }, W.w4);
  assert.deepEqual(ids(all(r1)), ids(all(r2)));
});
