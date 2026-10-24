// Mide la redundancia REAL entre los tres sitios que dan recomendaciones: el panel semanal (insights.js), «Tu análisis»
// (analysis.js) y «Lo importante esta semana» de Hoy (focus.js), con los datos sintéticos de tests/realistic-data.mjs
// (6 y 12 meses, hombre y mujer, adulto y menor). Uso: node scripts/measure-recommendations.mjs
// Cuenta mensajes y palabras, los temas (focus.topicOf) que hablan los dos motores, cuántos mensajes de un tema repiten
// a otro, y qué hay en la lista corta de Hoy (nivel y confianza). No cambia nada: es solo una medición.
import { realisticData } from '../tests/realistic-data.mjs';
import { buildAnalysis } from '../js/analysis.js';
import { weeklyInsights, keyMessages } from '../js/insights.js';
import { weekFocus, topicOf } from '../js/focus.js';
import { defaultSettings, exampleWeekPatterns, SEED_EXERCISES, SEED_TEMPLATES } from '../js/seed.js';

const TODAY = '2026-10-15';
const NOW = Date.parse(`${TODAY}T12:00:00`);
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, { archived: false, ...e }]));
const words = (m) => [m.title, m.text, m.parts?.observation, m.parts?.interpretation, m.parts?.recommendation].filter(Boolean).join(' ').split(/\s+/).length;

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

const rows = [];
for (const months of [6, 12]) {
  for (const female of [true, false]) {
    for (const [name, birthDate] of [['adulto', '1990-06-15'], ['menor', '2011-03-01']]) {
      const data = dataFor({ months, female, birthDate });
      const weekly = weeklyInsights(data, TODAY);
      const a = buildAnalysis(data, TODAY);
      const wm = [...weekly.info, ...weekly.suggestions];
      const am = a.all.filter((m) => !/-insufficient$/.test(m.id));
      const focus = weekFocus({ weekly: keyMessages(weekly, 6), analysis: a.keyPoints });
      const tw = new Map(); const ta = new Map();
      for (const m of wm) tw.set(topicOf(m), (tw.get(topicOf(m)) || 0) + 1);
      for (const m of am) ta.set(topicOf(m), (ta.get(topicOf(m)) || 0) + 1);
      const both = [...tw.keys()].filter((t) => ta.has(t));
      // Mensajes que dicen lo mismo con otras palabras: en un tema que hablan los dos motores, todo menos uno por motor
      const dup = both.reduce((n, t) => n + (tw.get(t) - 1) + (ta.get(t) - 1) + 1, 0);
      const warnsW = wm.filter((m) => m.level === 'warn').length;
      const warnsA = am.filter((m) => m.level === 'warn').length;
      const lowWarn = am.filter((m) => m.level === 'warn' && ['low', 'insufficient'].includes(m.confidence?.level)).length;
      rows.push({
        caso: `${months}m ${female ? 'M' : 'H'} ${name}`, panel: wm.length, analisis: am.length, palabrasPanel: wm.reduce((t, m) => t + words(m), 0),
        palabrasAnalisis: am.reduce((t, m) => t + words(m), 0), temasPanel: tw.size, temasAnalisis: ta.size, temasEnComun: both.length,
        mensajesEnTemasComunes: dup, avisosPanel: warnsW, avisosAnalisis: warnsA, avisosAnalisisConfianzaBaja: lowWarn,
        hoy: focus.items.length, hoyNiveles: focus.items.map((i) => `${i.level}${i.confidence ? `/${i.confidence.level}` : ''}`).join(' '),
      });
    }
  }
}
console.table(rows);
const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
console.log(`\nMedia por caso: panel ${(sum('panel') / rows.length).toFixed(1)} mensajes (${(sum('palabrasPanel') / rows.length).toFixed(0)} palabras) · análisis ${(sum('analisis') / rows.length).toFixed(1)} (${(sum('palabrasAnalisis') / rows.length).toFixed(0)} palabras) · temas en común ${(sum('temasEnComun') / rows.length).toFixed(1)} de ${(sum('temasPanel') / rows.length).toFixed(1)} del panel y ${(sum('temasAnalisis') / rows.length).toFixed(1)} del análisis.`);
console.log(`Avisos (warn): panel ${(sum('avisosPanel') / rows.length).toFixed(1)}, análisis ${(sum('avisosAnalisis') / rows.length).toFixed(1)}, de ellos con confianza baja o insuficiente ${(sum('avisosAnalisisConfianzaBaja') / rows.length).toFixed(1)}.`);
