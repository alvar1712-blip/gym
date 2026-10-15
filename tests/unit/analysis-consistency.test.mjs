// Prueba cruzada de coherencia (ronda 9, bloque 2): con el generador realista (tests/realistic-data.mjs, el mismo de
// las E2E) a 6 y 12 meses, hombre y mujer (con ciclo), adulto y menor, se juntan TODOS los textos de Hoy («Lo
// importante esta semana»), del panel semanal y de «Tu análisis» (funciones puras: weeklyInsights, keyMessages,
// weekFocus, buildAnalysis y el informe para IA) y se comprueba que no conviven mensajes que se contradicen:
//   - «Sin señales de necesitar descarga» (panel) frente a «descarga» / «semana más suave» (Hoy o Análisis);
//   - «reduce el volumen de <m>» frente a «+1–2 series de <m>» / «añade series de <m>»;
//   - «Bien» que afirma que tus ejercicios progresan o que conservas la fuerza con ejercicios estancados o bajando;
//   - kcal o «déficit» para un menor.
// Hoy = jueves 15 oct 2026 (fijo). Los datos son sintéticos: ningún ejemplo personal vive en el código.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realisticData } from '../realistic-data.mjs';
import { buildAnalysis } from '../../js/analysis.js';
import { weeklyInsights, keyMessages } from '../../js/insights.js';
import { weekFocus } from '../../js/focus.js';
import { reportText } from '../../js/analysis-report.js';
import { defaultSettings, exampleWeekPatterns, SEED_EXERCISES, SEED_TEMPLATES } from '../../js/seed.js';

const TODAY = '2026-10-15';
const NOW = Date.parse(`${TODAY}T12:00:00`);
const ADULT = '1990-06-15';
const MINOR = '2011-03-01';
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, { archived: false, ...e }]));

/** El `data` de las pantallas (progress-ui.dataFromStore + lo que añade analysisData) con el generador realista. */
function dataFor({ months, female, birthDate }) {
  const r = realisticData({ months, female, birthDate, today: TODAY, now: NOW, templates: SEED_TEMPLATES, exercises: EX });
  const settings = { ...defaultSettings(), weekPatterns: exampleWeekPatterns() };
  settings.profile = { ...settings.profile, ...r.profile };
  return {
    sessions: r.sessions, exercises: EX, templates: new Map(SEED_TEMPLATES.map((t) => [t.id, t])), plan: new Map(), settings,
    bodyweight: [...r.bodyweight].sort((a, b) => (a.id < b.id ? -1 : 1)), context: r.context, today: TODAY, createdAt: null,
    checkins: r.checkins, cycleDays: r.cycle, pastRecords: r.pastRecords, races: r.races, goals: r.goals,
  };
}

/** Textos visibles de un mensaje (título, texto y sus partes) y, aparte, los de «¿Por qué?» (regla y datos). */
const shown = (m) => [m.title, m.text, m.parts?.observation, m.parts?.interpretation, m.parts?.recommendation, m.stepLabel].filter(Boolean).join(' ');
const whyOf = (m) => [m.why?.rule, ...(m.why?.data || []).map((d) => d && `${d.label} ${d.value}`)].filter(Boolean).join(' ');

function screens(data) {
  const weekly = weeklyInsights(data, TODAY);
  const a = buildAnalysis(data, TODAY);
  const focus = weekFocus({ weekly: keyMessages(weekly, 6), analysis: a.keyPoints });
  const weeklyMsgs = [...weekly.info, ...weekly.suggestions].map((m) => ({ src: 'panel', ...m }));
  const analysisMsgs = a.all.map((m) => ({ src: 'análisis', ...m }));
  const focusMsgs = focus.items.map((m) => ({ src: 'hoy', ...m }));
  return { weekly, a, focus, weeklyMsgs, analysisMsgs, focusMsgs, report: reportText(a, { includeCycle: true }) };
}

const CASES = [];
for (const months of [6, 12]) {
  for (const female of [true, false]) {
    for (const minor of [false, true]) CASES.push({ months, female, minor, birthDate: minor ? MINOR : ADULT });
  }
}
const label = (c) => `${c.months} meses · ${c.female ? 'mujer' : 'hombre'} · ${c.minor ? 'menor' : 'adulto'}`;
const list = (msgs) => msgs.map((m) => `[${m.src}] ${m.id}: ${shown(m)}`).join('\n');

for (const c of CASES) {
  test(`coherencia (${label(c)}): ningún par de mensajes se contradice`, () => {
    const s = screens(dataFor(c));
    const all = [...s.weeklyMsgs, ...s.analysisMsgs, ...s.focusMsgs];
    if (s.focus.message) all.push({ src: 'hoy', id: 'all-good', title: s.focus.message });

    // 1 · Descarga: si el panel dice que no hace falta, nadie más la propone (ni «una semana más suave»).
    const deloadNone = s.weekly.suggestions.some((m) => m.id === 'deload-none');
    const deload = s.weekly.suggestions.some((m) => m.id === 'deload');
    assert.ok(!(deloadNone && deload));
    if (deloadNone) {
      const bad = all.filter((m) => !/^deload|^checkins$/.test(m.id) && /descarga|semana más suave/i.test(shown(m)));
      assert.deepEqual(bad.map((m) => m.id), [], `el panel dice «Sin señales de necesitar descarga» y aun así:\n${list(bad)}`);
    }

    // 2 · Volumen: un músculo que se pide reducir no recibe a la vez «+1–2 series» ni «añade series».
    const vol = s.a.hybrid?.volume?.muscles || [];
    const reduce = vol.filter((m) => m.decision === 'reduce').map((m) => m.name.toLowerCase());
    // Hoy con «Añade 1–2 series»: los músculos de su mensaje (sus filas, no solo los nombres que caben en el texto)
    // no son de los que se pide reducir.
    const reduceIds = new Set(vol.filter((m) => m.decision === 'reduce').map((m) => m.muscleId));
    for (const it of s.focusMsgs.filter((x) => x.step === 'add')) {
      const src = (it.source === 'weekly' ? s.weeklyMsgs : s.analysisMsgs).find((x) => x.id === it.id);
      const ids = (src?.items || []).map((r) => r.muscleId).filter((id) => reduceIds.has(id));
      assert.deepEqual(ids, [], `Hoy pide añadir series (${it.id}) de músculos que se pide reducir`);
    }
    for (const m of reduce) {
      const re = new RegExp(`\\+1–2 series[^.;]*\\bde ${m}\\b|añadir 1–2 series de [^.]*\\b${m}\\b`, 'i');
      const bad = all.filter((x) => re.test(shown(x)));
      assert.deepEqual(bad.map((x) => x.id), [], `se pide reducir ${m} y a la vez:\n${list(bad)}`);
      // …ni la tarjeta de Hoy pide «Añade 1–2 series» con un aviso de músculos por debajo que incluya ese músculo
      const addBelow = s.focusMsgs.filter((x) => x.step === 'add' && new RegExp(`\\b${m}\\b`, 'i').test(shown(x)));
      assert.deepEqual(addBelow.map((x) => x.id), [], `Hoy pide añadir series de ${m}:\n${list(addBelow)}`);
    }
    const volIns = s.a.all.find((i) => i.id === 'strength-volume');
    if (volIns && reduce.length && vol.some((m) => m.decision === 'reduce' && m.below)) {
      assert.doesNotMatch(shown(volIns), /dentro de tu rango/, 'con músculos por debajo no se dice «aunque estés dentro de tu rango»');
    }

    // 3 · «Bien» falsos: con ejercicios estancados o bajando, nada en «Bien» dice que progresan; con ≥ 1/3 de los
    // principales bajando, no se dice «conservas la fuerza».
    const sum = s.a.strength.summary;
    const struggling = s.a.strength.exercises.filter((x) => x.status === 'stalled' || x.status === 'down');
    if (struggling.length) {
      const bad = all.filter((m) => m.level === 'good' && /(tus ejercicios|sus ejercicios) progresan|progresan o se mantienen/i.test(shown(m)));
      assert.deepEqual(bad.map((m) => m.id), [], `con ${struggling.length} ejercicios estancados o bajando:\n${list(bad)}`);
      if (volIns) assert.notEqual(volIns.level, 'good', `volumen en «Bien» con ejercicios estancados: ${shown(volIns)}`);
    }
    if (sum.mainCount && sum.down * 3 >= sum.mainCount) {
      const bad = all.filter((m) => m.level === 'good' && /conservas/.test(shown(m)));
      assert.deepEqual(bad.map((m) => m.id), [], `${sum.down} de ${sum.mainCount} bajando:\n${list(bad)}`);
    }
    if (s.a.weight.goal === 'gain') {
      const bad = all.filter((m) => m.level === 'good' && /Bajas peso y conservas/.test(m.title || ''));
      assert.deepEqual(bad.map((m) => m.id), [], 'objetivo ganar: bajar de peso no es «Bien»');
    }

    // 4 · Menores: ni kcal ni «déficit» en ningún texto, en el «¿Por qué?» ni en el informe.
    if (c.minor) {
      const bad = all.filter((m) => /kcal|déficit/i.test(`${shown(m)} ${whyOf(m)}`));
      assert.deepEqual(bad.map((m) => m.id), [], `menor con cifras de dieta:\n${list(bad)}`);
      assert.doesNotMatch(s.report, /kcal|déficit/i);
    }
  });
}

test('coherencia: el generador realista produce casos con lo que se vigila (fatiga, estancados y menores)', () => {
  // Que la prueba de arriba no pase «en vacío»: los datos realistas traen check-ins bajos, estancados y un menor.
  const s = screens(dataFor({ months: 6, female: true, birthDate: ADULT }));
  assert.ok(s.a.strength.exercises.some((x) => x.status === 'stalled'), 'hay ejercicios estancados');
  assert.ok(s.weekly.suggestions.some((m) => /^deload/.test(m.id)), 'el panel valora la descarga');
  const m = screens(dataFor({ months: 6, female: true, birthDate: MINOR }));
  assert.equal(m.a.context.age.group, 'minor');
  assert.ok(m.a.all.some((i) => i.id === 'weight-strength'), 'el menor pasa por el cruce peso × fuerza');
});
