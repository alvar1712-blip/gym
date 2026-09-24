// progress-ui.js — piezas compartidas de las pantallas de progreso (Fase 2).
// PROPIETARIO: módulo de progreso. Lo usan js/views/progress.js y js/views/bodyweight.js (gráfica del hueco
// .bw-chart-slot), para que la gráfica de peso corporal sea la misma en las dos pantallas.
import * as store from './store.js';
import { h } from './ui.js';
import { lineChart, periodSelector, periodStart, getPeriod, COLORS } from './charts.js';
import { bodyweightSeries, dataRange } from './stats.js';
import { todayStr, fmtNum, weekStart } from './util.js';

/**
 * Entrada común de stats.js con los datos actuales del store. Constrúyela UNA vez por render: stats.js
 * cachea su índice por objeto `data` (un objeto nuevo = datos nuevos).
 */
export function dataFromStore(today = todayStr()) {
  return {
    sessions: store.all('sessions'),
    exercises: new Map(store.all('exercises').map((e) => [e.id, e])),
    templates: new Map(store.all('templates').map((t) => [t.id, t])),
    plan: new Map(store.all('plan').map((p) => [p.id, p])),
    settings: store.settings(),
    bodyweight: store.bodyweightList(),
    today,
    createdAt: store.get('meta', 'app')?.createdAt ?? null,
  };
}

/**
 * Primer día del periodo, sin ir más atrás que el primer dato (`first`): «1 año» con dos meses de datos
 * muestra esos dos meses a lo ancho en vez de diez meses vacíos. Sin datos → hoy.
 */
export function periodFrom(periodId, today, first) {
  let from = periodStart(periodId, today, first);
  if (first && (!from || from < first)) from = first;
  return from || today;
}

/**
 * Inicio común del periodo para TODAS las gráficas de progreso: el lunes de la semana en la que cae
 * periodFrom(...). Las barras semanales cuentan semanas enteras (`week`, su filtro) y las líneas empiezan el
 * mismo lunes (`from`), para que con el mismo selector sumen los mismos días. `from` no baja del primer dato
 * (`first`): una línea no empieza con días vacíos antes de él.
 * @returns {{ week: string, from: string }}
 */
export function periodRange(periodId, today, first) {
  const week = weekStart(periodFrom(periodId, today, first));
  return { week, from: first && week < first ? first : week };
}

/** Altura de una gráfica: algo más baja en pantallas bajas (iPhone SE, apaisado) para que quepa la tarjeta entera. */
export function chartHeight(px) {
  let vh = 0;
  try { vh = window.innerHeight || 0; } catch { vh = 0; }
  return vh && vh < 700 ? Math.round(px * 0.82) : px;
}

/** Cabecera de tarjeta: título, subtítulo (unidad) y, opcionalmente, un control a la derecha. */
export function cardHead(title, sub = null, right = null) {
  return h('div.prg-card-head',
    h('div.prg-card-titles',
      h('h2.prg-card-title', title),
      sub ? h('p.prg-card-sub', sub) : null),
    right);
}

const kgTxt = (v) => `${fmtNum(v, 1)} kg`;

/**
 * Opciones de la gráfica de peso corporal (pesajes diarios + media móvil de 7 días destacada), para
 * lineChart(). `data` necesita al menos { bodyweight, today }. Pasa `series` para no recalcular la media al
 * cambiar de periodo.
 * @returns {object} opts (series, xDomain, formato, mensaje vacío…)
 */
export function bodyweightChartOpts(data, periodId, { height = 220, series = null } = {}) {
  const today = data.today || todayStr();
  const first = dataRange(data).firstBodyweight;
  const { from } = periodRange(periodId, today, first);
  const s = series || bodyweightSeries(data); // `series`: el de bodyweightSeries(data), si ya lo tienes
  return {
    series: [
      { id: 'daily', label: 'Pesaje', color: COLORS.text2, points: s.daily, line: false, dots: true },
      // Sin etiqueta propia: el globo ya dice «Media 7 días» junto al valor.
      { id: 'ma', label: 'Media 7 días', color: COLORS.accent, points: s.ma.map((p) => ({ x: p.x, y: p.y })), emphasis: true, dots: false },
    ],
    height,
    yFormat: kgTxt,
    yTickFormat: (v) => fmtNum(v, 1),
    xDomain: [from, today],
    empty: s.count ? 'Sin pesajes en este periodo' : 'Registra tu primer pesaje para ver la gráfica.',
    ariaLabel: 'Peso corporal: pesajes diarios y media móvil de 7 días',
  };
}

/**
 * Tarjeta de la gráfica de peso para #/bodyweight: selector de periodo propio (clave 'bodyweight') y
 * redibujo al guardar, editar, borrar o deshacer un pesaje (se suscribe al store; destroy() lo desuscribe).
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function bodyweightChartCard({ key = 'bodyweight' } = {}) {
  let period = getPeriod(key);
  const slot = h('div.prg-chart');
  const sel = periodSelector({ key, value: period, ariaLabel: 'Periodo de la gráfica de peso', onChange: (id) => { period = id; paint(); } });
  const el = h('section.card.prg-card.prg-bw-chart', { dataset: { chart: 'bodyweight' } },
    cardHead('Evolución', 'kg · pesajes diarios y media móvil de 7 días'),
    sel,
    slot,
    h('p.prg-howto', 'Cada punto es un pesaje; la línea verde es la media de 7 días, la que marca la tendencia. Toca o arrastra para ver el valor exacto.'));
  let chart = null;
  function paint() {
    const data = { bodyweight: store.bodyweightList(), settings: store.settings(), sessions: [], today: todayStr() };
    const o = bodyweightChartOpts(data, period);
    if (chart) chart.update(o);
    else chart = lineChart(slot, o);
  }
  paint();
  let raf = 0;
  const off = store.on('change', (d) => {
    if (d.store !== 'bodyweight' || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paint(); });
  });
  return {
    el,
    destroy() {
      off();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (chart) chart.destroy();
      chart = null;
    },
  };
}
