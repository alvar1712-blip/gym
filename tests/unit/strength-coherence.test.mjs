// Coherencia del estado de cada ejercicio entre el panel semanal y «Tu análisis» › Fuerza (ronda final, analisis-3):
// «Estancado» es UNA regla (progression.stallEval, la del panel y la del «Siguiente paso» de la sesión). Con el
// generador realista (tests/realistic-data.mjs) a 6 y 12 meses, hombre y mujer, para cada ejercicio que valoran los dos:
//   - panel «progresa» ⇒ el análisis no lo da por estancado;
//   - panel «estancado» ⇒ el análisis lo da por estancado o bajando;
//   - ninguna fila de la lista de Fuerza enseña un ritmo positivo junto a «Estancado».
// Hoy = jueves 15 oct 2026 (fijo). Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realisticData } from '../realistic-data.mjs';
import { analyzeStrength, exerciseRateText } from '../../js/analysis-training.js';
import { progressStatus } from '../../js/progression.js';
import { exercisesWithHistory, exerciseHistory } from '../../js/stats.js';
import { defaultSettings, exampleWeekPatterns, SEED_EXERCISES, SEED_TEMPLATES } from '../../js/seed.js';

const TODAY = '2026-10-15';
const NOW = Date.parse(`${TODAY}T12:00:00`);
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, { archived: false, ...e }]));

function dataFor({ months, female }) {
  const r = realisticData({ months, female, today: TODAY, now: NOW, templates: SEED_TEMPLATES, exercises: EX });
  const settings = { ...defaultSettings(), weekPatterns: exampleWeekPatterns() };
  settings.profile = { ...settings.profile, ...r.profile };
  return {
    sessions: r.sessions, exercises: EX, templates: new Map(SEED_TEMPLATES.map((t) => [t.id, t])), plan: new Map(), settings,
    bodyweight: [...r.bodyweight].sort((a, b) => (a.id < b.id ? -1 : 1)), context: r.context, today: TODAY, createdAt: null,
    checkins: r.checkins, cycleDays: r.cycle, pastRecords: r.pastRecords, races: r.races, goals: r.goals,
  };
}

/** Estado del panel semanal por ejercicio (insights.classify usa progressStatus con ref = hoy en la semana en curso). */
function panelStatus(d) {
  const out = new Map();
  for (const it of exercisesWithHistory(d)) {
    const st = progressStatus({ exercise: it.exercise, history: exerciseHistory(d, it.exerciseId, { labels: false }), ref: TODAY, stall: d.settings.stall });
    if (st) out.set(it.exerciseId, st.status);
  }
  return out;
}

for (const months of [6, 12]) {
  for (const female of [true, false]) {
    test(`fuerza (${months} meses · ${female ? 'mujer' : 'hombre'}): el estado del análisis coincide con el del panel semanal`, () => {
      const d = dataFor({ months, female });
      const panel = panelStatus(d);
      const { exercises } = analyzeStrength(d, { today: TODAY, profile: d.settings.profile });
      const rows = exercises.filter((x) => x.status !== 'insufficient' && panel.has(x.exerciseId));
      assert.ok(rows.length >= 10, `pocos ejercicios valorados por los dos (${rows.length})`);
      const bad = [];
      for (const x of rows) {
        const p = panel.get(x.exerciseId);
        if (p === 'progress' && x.status === 'stalled') bad.push(`${x.name}: panel progresa, análisis estancado (${exerciseRateText(x)})`);
        if (p === 'stalled' && x.status !== 'stalled' && x.status !== 'down') bad.push(`${x.name}: panel estancado, análisis ${x.status}`);
      }
      assert.deepEqual(bad, []);
      // La fila de la lista: nunca «+x %/sem · Estancado».
      const mixed = exercises.filter((x) => x.status === 'stalled' && /^\+/.test(exerciseRateText(x)))
        .map((x) => `${x.name}: ${exerciseRateText(x)} · Estancado`);
      assert.deepEqual(mixed, []);
      for (const x of exercises.filter((r) => r.status === 'stalled' && r.ratePctPerWeek > 0)) assert.match(exerciseRateText(x), /^sin nueva marca/, x.name);
      // Sin estancar y con el ritmo plano o a la baja es «despacio», pero no cuenta como «mejora».
      const { summary } = analyzeStrength(d, { today: TODAY, profile: d.settings.profile });
      const base = exercises.filter((x) => x.status !== 'insufficient' && (summary.mainOnly ? x.main : true));
      assert.equal(summary.improving, base.filter((x) => (x.status === 'fast' || x.status === 'good') && x.ratePctPerWeek > 0).length);
    });
  }
}
