// views/focus.js — «Lo importante esta semana» en Hoy (docs/PULIDO.md §6 y §33): UNA tarjeta en lugar de las dos que
// había (resumen del panel semanal y «Tu análisis»), con un mensaje principal, hasta dos secundarios —sin repetir
// tema— y un único paso siguiente en cada uno, plegados (título + qué hacer; el resto al tocar). Sin avisos: «Todo evoluciona dentro de lo esperado…» (o «Aún pocos datos…» si
// aún no se ha podido valorar nada). La lógica es pura
// (js/focus.js) y reutiliza lo ya calculado: weeklyInsights/keyMessages y el análisis en caché (analysisFor).
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon } from '../ui.js';
import { fmtWeekRange } from '../util.js';
import { weeklyInsights, keyMessages } from '../insights.js';
import { weekFocus } from '../focus.js';
import { focusItem } from './focus-item.js';
import { analysisFor } from './analysis.js';

/** Mensajes candidatos de cada fuente (la lógica elige 3 como mucho). */
const CANDIDATES = 6;

/** «quedan 4 días» / «último día» de la semana en curso. */
const leftTxt = (n) => (n <= 1 ? 'último día' : `quedan ${n} días`);

/**
 * Tarjeta de Hoy. null sin nada que decir (sin historial ni análisis).
 * @param {{ data: object, today: string }} opts  `data` = el de la pantalla (weekly.weeklyData), compartido con las demás
 */
/** La parte del panel semanal (Hoy la calcula en su propia tarea, antes que la del analista). */
export function focusWeekly(data) {
  if (!data.checkins) data.checkins = store.all('checkins');
  return weeklyInsights(data, data.today);
}

/** `weekly`: el resultado de focusWeekly(data), si ya se calculó (Hoy: en otra tarea, para no bloquear). */
export function focusCard({ data, today, weekly: pre = null }) {
  const r = pre || focusWeekly(data);
  const a = analysisFor(today, data);
  if (a.errors?.length) console.error('[análisis]', a.errors);
  const weekly = r.hasHistory ? keyMessages(r, CANDIDATES) : [];
  const analysis = a.hasData ? a.keyPoints : [];
  if (!weekly.length && !analysis.length) return null;
  const f = weekFocus({ weekly, analysis });
  const sub = `${fmtWeekRange(r.week)}${r.inProgress ? ` · ${leftTxt(r.daysLeft)}` : ''}`;
  return h('section.card.focus', { dataset: { card: 'focus', allGood: f.allGood ? '1' : '' } },
    h('div.focus-head',
      h('h2.focus-heading', 'Lo importante esta semana'),
      h('p.focus-sub', sub)),
    // Sin avisos: «Todo evoluciona…»; sin avisos ni nada evaluado aún (ronda 9): «Aún pocos datos…», sin el check.
    f.allGood || f.fewData ? h(`p.focus-allgood${f.fewData ? '.focus-fewdata' : ''}`, icon(f.fewData ? 'clock' : 'check', 18), h('span', f.message)) : null,
    // Cada punto, plegado: título + qué hacer; al tocarlo, el resto (views/focus-item.js, PULIDO §33)
    f.items.length ? h('ol.focus-list', f.items.map((it, i) => focusItem(it, { main: i === 0 && !f.allGood && !f.fewData, scope: 'today' }))) : null,
    h('div.focus-links',
      h('button.cal-link-btn.focus-link', { type: 'button', dataset: { go: 'weekly' }, onClick: () => navigate(`#/weekly?week=${r.week}`) }, 'Panel semanal', icon('chevron-right', 18)),
      h('button.cal-link-btn.focus-link', { type: 'button', dataset: { go: 'analysis' }, onClick: () => navigate('#/analysis') }, 'Tu análisis', icon('chevron-right', 18))));
}
