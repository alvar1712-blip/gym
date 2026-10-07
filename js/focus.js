// focus.js — «Lo importante esta semana» (docs/PULIDO.md §6): junta los mensajes del panel semanal (insights.js) y
// los del analista (analysis.js) en UNA lista corta —uno principal y hasta dos secundarios—, sin dos que digan lo
// mismo (un mensaje por tema: «tus ejercicios se estancan» lo dicen los dos) y cada uno con UN paso siguiente claro
// («Mantén lo que haces», «Reduce 1–2 series», «Acumula más datos»…). Si no hay nada que cambiar, lo dice.
// PURO: no lee el store ni toca el DOM; recibe los resultados ya calculados (no repite cálculos). Pruebas:
// tests/unit/focus.test.mjs.
//
// ENTRADA weekFocus({ weekly, analysis }, max):
//   weekly  : insights.keyMessages(weeklyInsights(...)) → Message[] { id, section, level: neutral|good|warn, title, text, why }
//   analysis: buildAnalysis(...).keyPoints → Insight[] { id, area, level: good|neutral|warn|info, priority, title, text,
//             why, confidence?, parts?, action? }
// SALIDA { items: FocusItem[], allGood: boolean, message: string|null }
//   FocusItem = { key, source: 'weekly'|'analysis', id, topic, level, title, text, why, confidence, step, stepLabel, href }
//   - stepLabel: la recomendación propia del analista si la tiene (parts.recommendation); si no, STEPS[step].
//   - items[0] es el principal; como mucho `max` (3).
//   - allGood: nada pide un cambio (sin avisos) → `message` = ALL_GOOD y los items son, como mucho, lo que va bien.

/** Pasos siguientes: un verbo claro, siempre de esta lista (la explicación larga sigue en su tarjeta). */
export const STEPS = {
  keep: 'Mantén lo que haces',
  none: 'No necesitas cambiar nada',
  data: 'Acumula más datos',
  recheck: 'Reevalúa en una semana',
  recover: 'Prioriza la recuperación',
  reduce: 'Reduce 1–2 series',
  add: 'Añade 1–2 series',
  up: 'Sube el peso',
};
export const ALL_GOOD = 'Todo evoluciona dentro de lo esperado. No necesitas cambiar nada.';

/** Tema de un mensaje: dos mensajes del mismo tema dicen lo mismo con otras palabras (se queda uno). */
export function topicOf(m) {
  const id = String(m?.id || '');
  if (/^ex-|^strength-(stalled|down|summary|top|new|recovery|insufficient)/.test(id)) return 'strength';
  if (/^muscles|^push-pull|^strength-volume|^volume-change/.test(id)) return 'volume';
  if (/^dp-/.test(id)) return 'progression';
  if (/^load|^km$|^load-sport|^endurance-(intensity|interference)/.test(id)) return 'load';
  if (/^endurance-|^forecast-5k/.test(id)) return 'endurance';
  if (/^recovery-|^doms-|^fatigue|^checkins|^assoc-/.test(id)) return 'recovery';
  if (/^weight-|^forecast-weight/.test(id)) return 'weight';
  if (/^cycle-/.test(id)) return 'cycle';
  if (/^forecast-/.test(id)) return 'forecast';
  return m?.area || 'other';
}

/** El paso siguiente de un mensaje (clave de STEPS). */
export function nextStep(m) {
  const id = String(m?.id || '');
  const level = m?.level;
  if (/-insufficient$|^ex-none$|-nodata$/.test(id) || m?.confidence?.level === 'insufficient') return 'data';
  if (/^dp-up/.test(id)) return 'up';
  if (/^dp-hold/.test(id)) return 'keep';
  if (level === 'good') return 'keep';
  if (level !== 'warn') return 'none';
  // Avisos: qué hacer según el tema
  if (/^muscles-above/.test(id)) return 'reduce';
  if (/^muscles-below|^push-pull/.test(id)) return 'add';
  if (id === 'strength-volume') return /^Puedes añadir/.test(m.title || '') ? 'add' : 'reduce';
  if (/^recovery-|^doms-|^fatigue|^load|^weight-reds|^endurance-interference|^assoc-/.test(id)) return 'recover';
  return 'recheck';
}

/** Peso para elegir: primero lo que pide un cambio; después lo accionable que va bien; lo informativo al final. */
const SEVERITY = { warn: 3, good: 1.5, neutral: 1, info: 1 };
function weight(m, source, idx) {
  const base = SEVERITY[m.level] ?? 1;
  const actionable = /^dp-up/.test(m.id) ? 0.8 : 0;
  // Dentro del mismo nivel: el orden de su fuente (ya viene por prioridad); el analista lleva confianza y fuentes,
  // así que en empate gana su versión.
  return base + actionable + (source === 'analysis' ? 0.05 : 0) - idx * 0.01;
}

/** Destino de «ver más» de cada mensaje. */
function hrefOf(m, source) {
  if (m.action?.href) return m.action.href;
  return source === 'weekly' ? '#/weekly' : '#/analysis';
}

/**
 * «Lo importante esta semana».
 * @param {{ weekly?: object[], analysis?: object[] }} input
 * @param {number} [max=3]
 */
export function weekFocus({ weekly = [], analysis = [] } = {}, max = 3) {
  const cands = [];
  (weekly || []).forEach((m, i) => { if (m && m.id !== 'checkins') cands.push({ m, source: 'weekly', w: weight(m, 'weekly', i) }); });
  (analysis || []).forEach((m, i) => {
    if (!m || /-insufficient$/.test(m.id)) return; // «faltan datos» no es algo importante de la semana
    cands.push({ m, source: 'analysis', w: weight(m, 'analysis', i) });
  });
  cands.sort((a, b) => b.w - a.w);
  const byTopic = new Map();
  for (const c of cands) {
    const t = topicOf(c.m);
    if (!byTopic.has(t)) byTopic.set(t, c);
  }
  const chosen = [...byTopic.values()].sort((a, b) => b.w - a.w);
  const warns = chosen.filter((c) => c.m.level === 'warn' || /^dp-up/.test(c.m.id));
  const allGood = warns.length === 0;
  // Solo lo que pide un cambio o lo que va bien: lo informativo («Nota», «Info») no ocupa un hueco de «lo importante»
  // (sigue en su tarjeta y en el panel). Sin avisos, solo lo que va bien.
  const pool = chosen.filter((c) => c.m.level === 'good' || (!allGood && c.m.level === 'warn'));
  const items = pool.slice(0, allGood ? Math.max(0, max - 1) : max).map(({ m, source }) => {
    const step = nextStep(m);
    // Si el analista ya dice qué hacer (parts.recommendation: «…y revisa en 3 semanas»), esa es LA acción: no se
    // pone otra genérica que pueda contradecirla, y el texto se queda con el dato y su lectura (sin repetirla).
    const rec = m.parts?.recommendation || null;
    const text = rec ? [m.parts.observation, m.parts.interpretation].filter(Boolean).join(' ') || m.text : m.text;
    return {
      key: `${source}:${m.id}`, source, id: m.id, topic: topicOf(m), level: m.level, title: m.title, text,
      why: m.why || null, confidence: m.confidence || null, step, stepLabel: rec || STEPS[step], href: hrefOf(m, source),
    };
  });
  return { items, allGood, message: allGood ? ALL_GOOD : null };
}
