// views/recovery.js — #/recovery (ronda 8, F; docs/MEJORAS.md §10): cómo evolucionan tus check-ins. Solo lectura y
// sin parte médica: bloques de sueño, energía, estrés y agujetas (4 semanas · 12 semanas · todo), las frases de
// tendencia del analista (las MISMAS de la tarjeta Recuperación de #/analysis) y las zonas que se repiten («Rodilla
// izq. 6 → 5 → 4 → 2 · Mejorando»). Los números salen de recovery-logic.js (puro); aquí solo se pintan.
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, screen, emptyState, segmented, stateTag } from '../ui.js';
import { todayStr, fmtDate } from '../util.js';
import { checkinsBetween } from '../checkin-logic.js';
import { wellbeingTrend, zoneTrends, RECOVERY_PERIODS, ZONE_MIN_TIMES, ZONE_DIFF, fmtMean } from '../recovery-logic.js';
import { analysisFor, insightList } from './analysis.js';
import { areaInsights } from '../analysis.js';

/** Periodo elegido (por espectador; puede no haber localStorage: privado, bloqueado). */
const PERIOD_KEY = 'entreno.recovery.period';
function readPeriod() {
  try { return localStorage.getItem(PERIOD_KEY); } catch { return null; }
}
function savePeriod(id) {
  try { localStorage.setItem(PERIOD_KEY, id); } catch { /* sin almacenamiento: solo dura esta visita */ }
}

/** «4 semanas», «12 semanas», «todo tu historial» (dentro de una frase). */
const PERIOD_PHRASE = { '4w': '4 semanas', '12w': '12 semanas', all: 'todo tu historial' };
const ZONE_STATE = {
  better: ['ok', 'Mejorando'],
  stable: ['neutral', 'Estable'],
  worse: ['warn', 'Empeorando'],
};
const days = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;
const dayTxt = (d, today) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');

export function mountRecovery(root) {
  const today = todayStr();
  const c = screen(root, { title: 'Recuperación', subtitle: 'Tus check-ins', back: '#/progress' });
  c.classList.add('rcv');
  const checkins = store.all('checkins');
  if (!checkinsBetween(checkins, null, today).length) {
    c.appendChild(h('section.card.rcv-empty', emptyState({
      emoji: '🌙',
      title: 'Aún no hay check-ins',
      text: 'Responde «¿Cómo llegas hoy?» en Hoy (4 toques) y aquí verás cómo evolucionan tu sueño, tu energía, tu estrés y tus agujetas.',
      action: { label: 'Ir a Hoy', onClick: () => navigate('#/today') },
    })));
    return undefined;
  }

  let trend = wellbeingTrend(checkins, today, readPeriod() || '4w');
  const options = RECOVERY_PERIODS.filter((p) => p.id !== 'all' || trend.hasAll).map((p) => ({ value: p.id, label: p.label }));
  const seg = segmented({
    options,
    value: trend.period,
    ariaLabel: 'Periodo',
    onChange: (id) => { savePeriod(id); trend = wellbeingTrend(checkins, today, id); paint(); },
  });
  seg.classList.add('rcv-period');
  const feel = h('div.rcv-feel-slot');
  const zones = h('div.rcv-zones-slot');
  c.append(seg, feel);
  const ins = trendInsights(today);
  if (ins) c.appendChild(ins);
  c.appendChild(zones);

  function paint() {
    feel.replaceChildren(feelingsCard(trend, today));
    zones.replaceChildren(zonesCard(zoneTrends(checkins, today, { from: trend.from }), today));
  }
  paint();
  return undefined;
}

/** Las frases de tendencia del analista (recovery-trend-*), con su confianza y «¿Por qué?»; null si no hay. */
function trendInsights(today) {
  try {
    const a = analysisFor(today);
    const list = areaInsights(a, 'recovery').filter((i) => i.id.startsWith('recovery-trend-'));
    const el = insightList(list);
    return el ? h('section.card.rcv-insights', { dataset: { block: 'insights' } }, h('h2.rcv-title', 'Tendencia reciente'), el) : null;
  } catch (err) {
    console.error('[recuperación] análisis', err);
    return null;
  }
}

function feelingsCard(t, today) {
  const phrase = PERIOD_PHRASE[t.period];
  const range = `Del ${dayTxt(t.from, today)} a hoy · ${days(t.daysWith)} con check-in`;
  return h('section.card.rcv-feel', { dataset: { block: 'feel', period: t.period, bucket: t.bucket } },
    h('div.rcv-head', h('h2.rcv-title', 'Cómo te has sentido'), h('p.rcv-sub', range)),
    t.enough ? null : h('p.rcv-few', `En ${t.period === 'all' ? phrase : `estas ${phrase}`} solo hay ${days(t.daysWith)} con check-in: aún pocos para ver una tendencia.`),
    h('ul.rcv-rows', t.rows.map((r) => fieldRow(r, t))),
    h('p.rcv-legend',
      h('span.rcv-swatches', { 'aria-hidden': 'true' }, [1, 2, 3].map((lv) => h('span.rcv-cell.rcv-swatch', { dataset: { lv: String(lv) } }))),
      h('span', 'Tenue = bajo · intenso = alto · vacío = sin check-in')));
}

function fieldRow(r, t) {
  let sum = null;
  if (t.enough) sum = r.mean != null ? `${r.word} · media ${fmtMean(r.mean)}` : r.n ? `Pocos días (${r.n})` : 'Sin respuestas';
  const prev = t.enough && r.mean != null && r.prevMean != null ? `antes ${fmtMean(r.prevMean)}` : null;
  const aria = `${r.label}, ${PERIOD_PHRASE[t.period]}: ${days(r.n)} con check-in${t.enough && r.mean != null ? `, media ${fmtMean(r.mean)} (${r.word.toLowerCase()})` : ''}`;
  return h('li.rcv-row', { dataset: { field: r.key } },
    h('div.rcv-row-head',
      h('span.rcv-label', r.label),
      sum ? h('span.rcv-sum.tnum', sum, prev ? h('span.rcv-prev', ` · ${prev}`) : null) : null),
    h('div.rcv-strip', { role: 'img', 'aria-label': aria },
      r.cells.map((cell) => h('span.rcv-cell', {
        'aria-hidden': 'true',
        dataset: { lv: cell.level == null ? '' : String(cell.level) },
        title: cell.level == null ? `${cell.label}: sin check-in`
          : `${cell.label}: ${r.key === 'soreness' ? 'agujetas ' : ''}${wordOf(r.key, cell.level)}${cell.n > 1 ? ` (media ${fmtMean(cell.mean)} · ${days(cell.n)})` : ''}`,
      }))));
}

const WORDS = { 1: 'bajo', 2: 'normal', 3: 'alto' };
const wordOf = (key, lv) => (key === 'energy' ? { 1: 'baja', 2: 'normal', 3: 'alta' }[lv] : key === 'soreness' ? { 1: 'bajas', 2: 'normales', 3: 'altas' }[lv] : WORDS[lv]);

function zonesCard(list, today) {
  const foot = `Mejorando o empeorando compara la media de tus 2 últimos registros con la de los 2 primeros mostrados (${ZONE_DIFF} puntos o más). Solo describe lo que has apuntado: no es un diagnóstico. Si una molestia sigue o va a más, consulta a un profesional.`;
  return h('section.card.rcv-zones', { dataset: { block: 'zones' } },
    h('div.rcv-head', h('h2.rcv-title', 'Zonas que has apuntado'), h('p.rcv-sub', 'Agujetas y molestias de 0 a 10 en este periodo')),
    list.length
      ? h('ul.rcv-zone-list', list.map((z) => zoneRow(z, today)))
      : h('p.rcv-few', `Cuando apuntes la misma zona ${ZONE_MIN_TIMES} veces o más verás aquí si va a mejor o a peor.`),
    list.length ? h('p.rcv-foot', foot) : null);
}

function zoneRow(z, today) {
  const [kind, label] = ZONE_STATE[z.trend];
  const lv = z.seq.map((x) => x.level);
  return h('li.rcv-zone', { dataset: { zone: z.key, trend: z.trend } },
    h('div.rcv-zone-head',
      h('span.rcv-zone-titles', h('span.rcv-zone-name', z.name), h('span.rcv-zone-kind', z.kindWord)),
      stateTag(kind, label, { small: true, className: 'rcv-zone-state' })),
    h('p.rcv-zone-seq.tnum', { 'aria-label': `Últimos valores de 0 a 10: ${lv.join(', ')}` }, lv.join(' →\u00a0')), // «→ 2» nunca se separa de su cifra al partir la línea
    h('p.rcv-zone-meta', `Último: ${dayTxt(z.lastDate, today)} · ${z.times} ${z.times === 1 ? 'vez' : 'veces'}`),
    z.note ? h('p.rcv-zone-note', `Nota (${dayTxt(z.note.date, today)}): ${z.note.text}`) : null);
}
