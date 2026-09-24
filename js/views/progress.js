// progress.js — Fase 2: pestaña Progreso (#/progress), progreso de un ejercicio (#/progress/exercise/:id) y
// récords (#/records). PROPIETARIO: módulo de progreso.
// Los números salen de js/stats.js (puro) con un `data` construido UNA vez por pantalla; las gráficas, de
// js/charts.js. Cambiar el periodo o un chip solo filtra lo ya calculado y actualiza las gráficas afectadas;
// al salir de la pantalla se destruyen todas (listeners y observers).
import { navigate } from '../router.js';
import { h, icon, screen, chips, segmented, emptyState } from '../ui.js';
import { fmtDate, fmtNum, fmtDuration, fmtPace, fmtWeekRange, weekStart, relDay, plural } from '../util.js';
import { lineChart, barChart, periodSelector, getPeriod, COLORS } from '../charts.js';
import * as S from '../stats.js';
import { MUSCLES, MUSCLE_LABEL } from '../seed.js';
import { emptyBests, addToBests, detectPRs } from '../calc.js';
import { formatSet, fmtSec } from '../session-logic.js';
import { dataFromStore, periodRange, chartHeight, cardHead, bodyweightChartOpts } from '../progress-ui.js';

// Estado de la interfaz mientras la app está abierta (al volver de una ficha se conserva).
const ui = { muscle: 'back', q: '', km: 'all', recSeg: 'strength', recQ: '', scroll: null };

const LOAD_TYPES = ['weight_reps', 'bodyweight', 'unilateral'];
// Orden de apilado de la carga (de abajo arriba) y de la leyenda.
const LOAD_KINDS = [
  { key: 'strength', label: 'Fuerza', color: COLORS.strength },
  { key: 'other', label: 'Otras', color: COLORS.other },
  { key: 'run', label: 'Carrera', color: COLORS.run },
  { key: 'bike', label: 'Bici', color: COLORS.bike },
  { key: 'swim', label: 'Natación', color: COLORS.swim },
];
const KM_KINDS = [
  { key: 'run', label: 'Carrera', color: COLORS.run, emoji: '🏃' },
  { key: 'bike', label: 'Bici', color: COLORS.bike, emoji: '🚴' },
  { key: 'swim', label: 'Natación', color: COLORS.swim, emoji: '🏊' },
];
const STATUS_TXT = { below: 'Por debajo', in: 'Dentro', above: 'Por encima', none: 'Sin rango', short: 'Faltan series' };
const STATUS_LONG = { below: 'Por debajo del rango', in: 'Dentro del rango', above: 'Por encima del rango', none: 'Sin rango objetivo' };
/** Series que faltan para el mínimo del rango: «faltan 7 series para el mínimo». */
const shortTxt = (sets, min) => `faltan ${fmtNum(Math.max(0, min - sets), 1)} ${min - sets === 1 ? 'serie' : 'series'} para el mínimo`;
const SPRINT_COLORS = [COLORS.accent, COLORS.info, COLORS.run, COLORS.swim, COLORS.other];

const nf0 = (v) => S.fmtNumFast(v, 0);
const nf1 = (v) => S.fmtNumFast(v, 1);
const kg1 = (v) => `${S.fmtNumFast(v, 1)} kg`;
const sumBy = (arr, fn) => arr.reduce((t, x) => t + (fn(x) || 0), 0);
const sameYear = (a, b) => a.slice(0, 4) === b.slice(0, 4);
/** '23 sep' este año; '23 sep 2025' si es de otro. */
const fmtDay = (date, today) => (date ? fmtDate(date, sameYear(date, today) ? 'day' : 'full') : '—');

/** Navega a una pantalla hija recordando el scroll (al volver a Progreso se restaura). */
function goChild(hash) {
  ui.scroll = { y: window.scrollY, at: Date.now() };
  navigate(hash);
}
function restoreScroll() {
  const s = ui.scroll;
  ui.scroll = null;
  if (!s || Date.now() - s.at > 30 * 60 * 1000 || !(s.y > 0)) return;
  // Después del scrollTo(0) del router (que va en el frame siguiente al montaje).
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, s.y)));
}

/** Lunes desde el que se cuentan las barras semanales del periodo (el mismo día en que empiezan las líneas). */
const weekFrom = (ctx, pid) => periodRange(pid, ctx.today, ctx.range.firstSession).week;

/** Fila de datos breve: «Esta semana 1230 · Semana pasada 1480». */
function statLine(items) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return h('div.prg-stats', list.map((it) => h('div.prg-stat', { class: it.cls || '' },
    h('span.prg-stat-label', it.label),
    h('span.prg-stat-value', it.value),
    it.sub ? h('span.prg-stat-sub', it.sub) : null)));
}

/** Selector de periodo pegajoso bajo la cabecera. */
function periodBar(root, key, onChange) {
  const sel = periodSelector({ key, onChange, ariaLabel: 'Periodo de las gráficas' });
  const bar = h('div.prg-period-bar', sel);
  // La cabecera puede medir más (safe area, subtítulo): el selector se pega justo debajo.
  requestAnimationFrame(() => {
    const tb = root.querySelector('.topbar');
    if (tb && bar.isConnected) bar.style.top = `${tb.offsetHeight}px`;
  });
  bar.getValue = sel.getValue;
  return bar;
}

/** Crea la gráfica la primera vez (con el contenedor ya en el DOM) y la actualiza después. */
function chartHolder(charts, slot, kind, base) {
  let ch = null;
  return (o) => {
    if (ch) ch.update(o);
    else {
      ch = (kind === 'bar' ? barChart : lineChart)(slot, { ...base, ...o });
      charts.push(ch);
    }
    return ch;
  };
}

function chartSection(id, { title, sub, right = null, before = [], note = null, howto = null }) {
  const slot = h('div.prg-chart');
  const el = h('section.card.prg-card', { dataset: { chart: id } },
    cardHead(title, sub, right),
    ...before,
    slot,
    note ? h('p.prg-note', icon('info', 16), h('span', note)) : null,
    howto ? h('p.prg-howto', howto) : null);
  return { el, slot };
}

function weekNotes(r) {
  const out = [];
  if (r.current) out.push('Semana en curso');
  if (r.noLoad) out.push(`${plural(r.noLoad, 'sesión', 'sesiones')} sin esfuerzo percibido (no suman carga)`);
  return out;
}

/** Media móvil de las últimas n actividades, ponderada por distancia: ratio(Σ segundos, Σ km). */
function rolling(points, n, ratio) {
  const out = [];
  let km = 0;
  let sec = 0;
  for (let i = 0; i < points.length; i++) {
    km += points[i].km || 0;
    sec += points[i].sec || 0;
    if (i >= n) { km -= points[i - n].km || 0; sec -= points[i - n].sec || 0; }
    const y = ratio(sec, km);
    if (y != null && Number.isFinite(y)) out.push({ x: points[i].x, y });
  }
  return out;
}
const paceOf = (sec, km) => (km > 0 && sec > 0 ? sec / km : null);
const speedOf = (sec, km) => (km > 0 && sec > 0 ? km / (sec / 3600) : null);
const pace100Of = (sec, km) => (km > 0 && sec > 0 ? sec / (km * 10) : null);

// ===========================================================================
// #/progress
// ===========================================================================

export function mountProgress(root) {
  const c = screen(root, { title: 'Progreso' });
  c.classList.add('prg');
  const data = dataFromStore();
  const today = data.today;
  const range = S.dataRange(data);
  const charts = [];
  const ctx = {
    data, today, range, charts,
    settings: data.settings || {},
    hasSessions: !!range.firstSession,
    weeks: S.weeklySeries(data), // todas las semanas desde la primera sesión (se filtran por periodo)
    // Sin ningún dato, las gráficas vacías ocupan menos; en pantallas bajas (SE, apaisado), algo menos altas.
    h: (px) => (range.first ? chartHeight(px) : 112),
  };

  c.appendChild(h('div.progress-extra')); // Fase 3: panel semanal y objetivos
  const exSection = exercisesSection(ctx);
  c.appendChild(linksRow(ctx, exSection));
  if (!range.first) {
    c.appendChild(h('section.card.prg-nodata', emptyState({
      emoji: '📈',
      title: 'Aún no hay datos',
      text: 'Registra tu primera sesión (o tu peso) y aquí verás tu carga semanal, el volumen, las series por músculo, tus ritmos, tu peso y tus récords.',
      action: { label: 'Ir a Hoy', onClick: () => navigate('#/today') },
    })));
  }

  const cards = [];
  let period = getPeriod('global');
  // El selector solo se pega mientras se ven las gráficas que dependen de él: sticky dentro de .prg-charts.
  const chartsBox = h('div.prg-charts');
  chartsBox.appendChild(periodBar(root, 'global', (id) => { period = id; for (const k of cards) k.update(period); }));
  c.appendChild(chartsBox);

  const muscle = muscleCard(ctx);
  const makers = [loadCard, volumeCard, () => muscle, kmCard, runCard, bikeCard, swimCard, bodyweightCard, adherenceCard];
  for (const make of makers) {
    const card = make(ctx);
    if (!card) continue;
    chartsBox.appendChild(card.el);
    if (card.update) { card.update(period); cards.push(card); }
  }
  // Sin periodo: la semana en curso por músculo y la lista de ejercicios.
  const table = muscleTableCard(ctx, muscle);
  if (table) c.appendChild(table.el);
  c.appendChild(exSection.el);
  exSection.paint();
  restoreScroll();
  return () => { for (const ch of charts) ch.destroy(); charts.length = 0; };
}

/** Accesos: Récords, Peso corporal y salto a la lista de ejercicios. */
function linksRow(ctx, exSection) {
  const tile = (emoji, label, aria, onClick, key) => h('button.prg-link', { type: 'button', dataset: { link: key }, 'aria-label': aria, onClick },
    h('span.prg-link-emoji', { 'aria-hidden': 'true' }, emoji),
    h('span.prg-link-label', label));
  return h('nav.prg-links', { 'aria-label': 'Accesos de progreso' },
    tile('🏆', 'Récords', 'Récords de fuerza y resistencia', () => goChild('#/records'), 'records'),
    tile('⚖️', 'Peso', 'Peso corporal', () => goChild('#/bodyweight'), 'bodyweight'),
    tile('🏋️', 'Ejercicios', 'Ir a la lista de ejercicios', () => exSection.el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 'exercises'));
}

/**
 * Media de las `n` semanas ANTERIORES a cada semana (nunca la propia: la semana en curso está a medias), solo
 * con semanas desde la primera sesión (`weeks` empieza ahí). Es la referencia de la Fase 3 («frente a la media
 * de las 4 semanas previas»). Puntos {x, y, weeks, label: «2.829»} (solo el valor: el nombre de la línea ya dice
 * «Media 4 sem. previas»); weeks < n al principio del registro (la vista lo aclara como nota del globo).
 * La primera semana no tiene.
 */
function previousAverage(weeks, get, n = 4) {
  const out = [];
  for (let i = 1; i < weeks.length; i++) {
    const win = weeks.slice(Math.max(0, i - n), i);
    const y = sumBy(win, get) / win.length;
    out.push({ x: weeks[i].week, y, weeks: win.length, label: nf0(y) });
  }
  return out;
}

// ---------- a) Carga semanal ----------
function loadCard(ctx) {
  const { weeks } = ctx;
  const avg = previousAverage(weeks, (r) => r.loadTotal, 4);
  const avgByWeek = new Map(avg.map((p) => [p.x, p]));
  // Media con menos de 4 semanas (inicio del registro): aclaración en el globo, no en el nombre de la línea.
  const avgNote = (week) => {
    const p = avgByWeek.get(week);
    return p && p.weeks < 4 ? `Media de solo ${plural(p.weeks, 'semana anterior', 'semanas anteriores')} (aún no hay 4)` : null;
  };
  const cur = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const ref = avg.length && avg[avg.length - 1].x === cur.week ? avg[avg.length - 1] : null; // la de esta semana
  const { el, slot } = chartSection('load', {
    title: 'Carga semanal',
    sub: 'Minutos × esfuerzo percibido (1–10)',
    before: [ctx.hasSessions ? statLine([
      { label: 'Esta semana', value: nf0(cur.loadTotal), sub: 'en curso' },
      prev ? { label: 'Sem. pasada', value: nf0(prev.loadTotal) } : null,
      ref ? { label: `Media ${ref.weeks} sem.`, value: nf0(ref.y), sub: 'anteriores' } : null,
    ]) : null],
    howto: 'Cada barra es una semana (lunes a domingo), apilada por tipo. La línea blanca es la media de las 4 semanas anteriores a cada una: si la barra la supera, cargaste más de lo habitual. La fuerza también suma: duración × esfuerzo.',
  });
  const draw = chartHolder(ctx.charts, slot, 'bar', {
    stacked: true, height: ctx.h(220), yFormat: nf0, totalLabel: 'Total', ariaLabel: 'Carga semanal total y por tipo de actividad',
  });
  return {
    el,
    update(pid) {
      const wk = weekFrom(ctx, pid);
      const rows = weeks.filter((r) => r.week >= wk);
      const used = LOAD_KINDS.filter((k) => rows.some((r) => r.load[k.key] > 0));
      const kinds = used.length ? used : LOAD_KINDS;
      draw({
        bars: rows.map((r) => ({
          x: r.week,
          segments: kinds.map((k) => ({ key: k.key, value: r.load[k.key], color: k.color, label: r.labels.load[k.key] })),
          tooltip: [...weekNotes(r), avgNote(r.week)].filter(Boolean),
        })),
        legend: kinds.map(({ key, label, color }) => ({ key, label, color })),
        overlay: { points: avg.filter((p) => p.x >= wk), color: COLORS.text, label: 'Media 4 sem. previas' },
        empty: ctx.hasSessions ? 'Sin sesiones en este periodo' : 'Registra tu primera sesión para ver tu carga semanal.',
      });
    },
  };
}

// ---------- b) Volumen semanal de fuerza ----------
function volumeCard(ctx) {
  const { weeks } = ctx;
  const hasStrength = weeks.some((r) => r.strengthVolume > 0);
  const cur = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const { el, slot } = chartSection('volume', {
    title: 'Volumen de fuerza',
    sub: 'kg por semana · peso × repeticiones, sin calentamientos',
    before: [hasStrength ? statLine([
      { label: 'Esta semana', value: S.fmtMetric('volume', cur.strengthVolume), sub: 'en curso' },
      prev ? { label: 'Sem. pasada', value: S.fmtMetric('volume', prev.strengthVolume) } : null,
    ]) : null],
    howto: 'Suma de kg × reps de todas las series de trabajo de la semana (en peso corporal, tu peso + lastre; en core, solo el lastre). Toca una barra para ver el total exacto.',
  });
  const draw = chartHolder(ctx.charts, slot, 'bar', {
    height: ctx.h(200), yFormat: (v) => S.fmtMetric('volume', v), yTickFormat: nf0, ariaLabel: 'Volumen semanal de fuerza en kg',
  });
  return {
    el,
    update(pid) {
      const wk = weekFrom(ctx, pid);
      draw({
        bars: weeks.filter((r) => r.week >= wk).map((r) => ({
          x: r.week,
          segments: [{ key: 'volume', value: r.strengthVolume, color: COLORS.strength, label: r.labels.strengthVolume, name: 'Volumen' }],
          tooltip: [r.current ? 'Semana en curso' : null, r.workSets ? plural(r.workSets, 'serie de trabajo', 'series de trabajo') : null].filter(Boolean),
        })),
        empty: hasStrength ? 'Sin sesiones de fuerza en este periodo' : 'Registra tu primera sesión de fuerza para ver el volumen semanal.',
      });
    },
  };
}

// ---------- c) Series por músculo ----------
function muscleCard(ctx) {
  const { data, settings } = ctx;
  const hasStrength = ctx.weeks.some((r) => r.workSets > 0);
  const cache = new Map(); // músculo → filas de todas las semanas (se calcula al elegirlo)
  const rowsOf = (m) => {
    let r = cache.get(m);
    if (!r) { r = S.muscleWeekly(data, m); cache.set(m, r); }
    return r;
  };
  if (!MUSCLE_LABEL[ui.muscle]) ui.muscle = 'back';
  let pid = null;
  const caption = h('p.prg-caption');
  const chipsEl = chips({
    options: MUSCLES.map((m) => ({ value: m.id, label: m.label })),
    value: ui.muscle,
    className: 'chips-scroll prg-chips',
    onChange: (v) => { ui.muscle = v; paint(); },
  });
  chipsEl.setAttribute('aria-label', 'Músculo');
  const pf = settings.primaryFactor ?? 1;
  const sf = settings.secondaryFactor ?? 0.5;
  const { el, slot } = chartSection('muscle', {
    title: 'Series por músculo',
    sub: `Series efectivas por semana · principal ${fmtNum(pf, 2)}, secundario ${fmtNum(sf, 2)}`,
    before: [chipsEl, caption],
    howto: 'La franja verde es tu rango objetivo semanal (Ajustes › Umbrales y reglas). Los calentamientos no cuentan y la semana en curso aún no ha terminado.',
  });
  const draw = chartHolder(ctx.charts, slot, 'bar', { height: ctx.h(200), yFormat: nf1, bandLabel: 'Rango objetivo' });
  function paint() {
    const m = ui.muscle;
    const name = MUSCLE_LABEL[m] || m;
    const t = S.muscleTarget(settings, m);
    caption.replaceChildren(h('b', name), t ? ` · objetivo ${fmtNum(t[0], 1)}–${fmtNum(t[1], 1)} series por semana` : ' · sin rango objetivo');
    const wk = weekFrom(ctx, pid);
    draw({
      bars: rowsOf(m).filter((r) => r.week >= wk).map((r) => ({
        x: r.week,
        segments: [{ key: 'sets', value: r.sets, color: COLORS.info, label: r.label, name: 'Series efectivas' }],
        tooltip: [
          !t ? null : r.current && r.status === 'below' ? `Semana en curso: ${shortTxt(r.sets, t[0])}` : STATUS_LONG[r.status],
          r.current && !(t && r.status === 'below') ? 'Semana en curso' : null,
        ].filter(Boolean),
      })),
      band: t ? { min: t[0], max: t[1], label: 'Rango objetivo' } : null,
      legend: [{ key: 'sets', label: 'Series efectivas', color: COLORS.info }],
      ariaLabel: `Series efectivas por semana de ${name}`,
      empty: hasStrength ? `Sin series de ${name.toLowerCase()} en este periodo` : 'Registra tu primera sesión de fuerza para ver tus series por músculo.',
    });
  }
  return {
    el,
    update(p) { pid = p; paint(); },
    select(m) {
      if (!MUSCLE_LABEL[m]) return;
      ui.muscle = m;
      chipsEl.setValue(m);
      paint();
      const chip = chipsEl.querySelector('.chip.active');
      if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: 'nearest', inline: 'center' });
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  };
}

/**
 * Tabla «esta semana»: todos los músculos frente a su rango, con una barrita y el estado. La semana está en
 * curso: lo que aún no llega al mínimo sale en gris («Faltan 7»), no como aviso; «Dentro» y «Por encima» ya no
 * cambian a peor. Sin ninguna serie de fuerza en el historial no se muestra.
 */
function muscleTableCard(ctx, muscle) {
  if (!ctx.weeks.some((r) => r.workSets > 0)) return null;
  const rows = S.muscleTable(ctx.data);
  const ws = weekStart(ctx.today);
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.sets, r.max ?? 0))) * 1.08;
  const pct = (v) => `${Math.max(0, Math.min(100, (v / scale) * 100)).toFixed(2)}%`;
  const list = h('div.prg-mtable', { role: 'list' }, rows.map((r) => {
    const range = r.target ? `${fmtNum(r.min, 1)}–${fmtNum(r.max, 1)}` : '—';
    const st = r.status === 'below' ? 'short' : r.status;
    const chip = st === 'short' ? `Faltan ${fmtNum(r.min - r.sets, 1)}` : STATUS_TXT[st];
    const long = st === 'short' ? shortTxt(r.sets, r.min) : STATUS_LONG[st].toLowerCase();
    return h('button.prg-mrow', {
      type: 'button',
      role: 'listitem',
      dataset: { muscle: r.muscleId, status: st },
      'aria-label': `${r.name}: ${r.setsLabel}${r.target ? `, rango ${range}` : ''}, ${long}`,
      onClick: () => muscle.select(r.muscleId),
    },
    h('span.prg-mrow-top',
      h('span.prg-mrow-name', r.name),
      h('span.prg-mrow-val', h('b', fmtNum(r.sets, 1)), h('span.prg-mrow-range', ` / ${range}`)),
      h(`span.prg-status.prg-status-${st}`, chip)),
    h('span.prg-mbar', { 'aria-hidden': 'true' },
      r.target ? h('span.prg-mbar-band', { style: { left: pct(r.min), width: `calc(${pct(r.max)} - ${pct(r.min)})` } }) : null,
      h('span.prg-mbar-fill', { style: { width: r.sets > 0 ? pct(r.sets) : '0' } })));
  }));
  const el = h('section.card.prg-card', { dataset: { chart: 'muscle-table' } },
    cardHead('Esta semana por músculo', `${fmtWeekRange(ws)} (en curso) · series efectivas frente a tu rango`,
      h('button.prg-head-link', { type: 'button', onClick: () => goChild('#/settings/thresholds') }, 'Rangos', icon('chevron-right', 16))),
    h('div.prg-mlegend', { 'aria-hidden': 'true' },
      ...['short', 'in', 'above'].map((s) => h('span.prg-mlegend-item', h(`span.prg-dot.prg-dot-${s}`), STATUS_TXT[s]))),
    list,
    h('p.prg-howto', 'La zona clara de cada barra es tu rango objetivo y la barra, las series hechas esta semana (en gris mientras aún no llegan al mínimo: la semana no ha terminado). Toca un músculo para ver su evolución arriba.'));
  return { el };
}

// ---------- d) Kilómetros semanales ----------
function kmCard(ctx) {
  const { weeks } = ctx;
  const any = KM_KINDS.filter((k) => weeks.some((r) => r.km[k.key] > 0));
  const cur = weeks[weeks.length - 1];
  let pid = null;
  if (!['all', ...KM_KINDS.map((k) => k.key)].includes(ui.km)) ui.km = 'all';
  const seg = segmented({
    options: [{ value: 'all', label: 'Todos' }, ...KM_KINDS.map((k) => ({ value: k.key, label: k.label }))],
    value: ui.km,
    ariaLabel: 'Deporte',
    onChange: (v) => { ui.km = v; paint(); },
  });
  seg.classList.add('prg-seg');
  const { el, slot } = chartSection('km', {
    title: 'Kilómetros semanales',
    sub: 'km por semana · carrera, bici y natación',
    before: [
      any.length ? statLine(any.map((k) => ({ label: `${k.emoji} ${k.label}`, value: S.fmtMetric(`km.${k.key}`, cur.km[k.key]), sub: 'esta semana' }))) : null,
      seg,
    ],
    howto: 'Cada barra es una semana; con «Todos» se apilan los deportes. Elige un deporte para verlo con su propia escala (natación en metros).',
  });
  const draw = chartHolder(ctx.charts, slot, 'bar', { height: ctx.h(200), totalLabel: 'Total', ariaLabel: 'Kilómetros semanales por deporte' });
  function paint() {
    const wk = weekFrom(ctx, pid);
    const rows = weeks.filter((r) => r.week >= wk);
    const one = KM_KINDS.find((k) => k.key === ui.km) || null;
    const used = KM_KINDS.filter((k) => rows.some((r) => r.km[k.key] > 0));
    const kinds = one ? [one] : used.length ? used : KM_KINDS;
    const swimOnly = one && one.key === 'swim';
    draw({
      bars: rows.map((r) => ({
        x: r.week,
        segments: kinds.map((k) => ({ key: k.key, value: r.km[k.key], color: k.color, label: r.labels.km[k.key], name: k.label })),
        tooltip: r.current ? ['Semana en curso'] : [],
      })),
      legend: one ? [] : kinds.map(({ key, label, color }) => ({ key, label, color })),
      yFormat: swimOnly ? (v) => S.fmtMetric('km.swim', v) : (v) => `${nf1(v)} km`,
      yTickFormat: swimOnly ? (v) => S.fmtNumFast(v * 1000, 0) : nf1,
      empty: !any.length
        ? 'Registra tu primera carrera, salida en bici o natación (con distancia) para ver tus kilómetros.'
        : one ? `Sin kilómetros de ${one.label.toLowerCase()} en este periodo` : 'Sin kilómetros en este periodo',
    });
  }
  return { el, update(p) { pid = p; paint(); } };
}

// ---------- e) Ritmo de carrera, velocidad en bici (y ritmo de natación si hay) ----------
function activityLineCard(ctx, spec) {
  const pts = spec.points;
  const avg = rolling(pts, 5, spec.ratio);
  const last = pts[pts.length - 1] || null;
  const statsBox = h('div.prg-stats-box');
  const { el, slot } = chartSection(spec.id, { title: spec.title, sub: spec.sub, before: [statsBox], howto: spec.howto });
  const draw = chartHolder(ctx.charts, slot, 'line', {
    height: ctx.h(210),
    series: [
      { id: 'each', label: spec.eachLabel, color: spec.color, points: pts, line: false, dots: true, opacity: 0.75 },
      { id: 'avg', label: 'Media 5 últimas', color: spec.color, points: avg, emphasis: true, dots: false },
    ],
    invertY: !!spec.invertY,
    yTicks: spec.yTicks || 'auto',
    yFormat: spec.fmt,
    yTickFormat: spec.tick,
    ariaLabel: spec.aria,
  });
  return {
    el,
    update(pid) {
      const { from } = periodRange(pid, ctx.today, ctx.range.firstSession);
      const inP = pts.filter((p) => p.x >= from && p.x <= ctx.today);
      const km = sumBy(inP, (p) => p.km);
      const sec = sumBy(inP, (p) => p.sec);
      const y = spec.ratio(sec, km);
      statsBox.replaceChildren(pts.length ? statLine([
        last ? { label: 'Última', value: spec.fmt(last.y), sub: `${S.distanceLabel(spec.kind, last.km)} · ${fmtDay(last.x, ctx.today)}` } : null,
        { label: 'Media del periodo', value: y != null ? spec.fmt(y) : '—', sub: inP.length ? `${S.distanceLabel(spec.kind, km)} en ${plural(inP.length, spec.one, spec.many)}` : 'sin datos en el periodo' },
      ]) : '');
      draw({ xDomain: [from, ctx.today], empty: pts.length ? `Sin ${spec.many} en este periodo` : spec.emptyAll });
    },
  };
}

function runCard(ctx) {
  return activityLineCard(ctx, {
    id: 'run-pace', kind: 'run', title: 'Ritmo de carrera', sub: 'min/km · más arriba = más rápido', color: COLORS.run,
    points: S.runPaceSeries(ctx.data), ratio: paceOf, invertY: true, yTicks: 'time', fmt: (v) => fmtPace(v), tick: fmtDuration,
    eachLabel: 'Cada carrera', one: 'carrera', many: 'carreras', aria: 'Ritmo medio de cada carrera y media de las 5 últimas',
    emptyAll: 'Registra tu primera carrera (con distancia y tiempo) para ver tu ritmo.',
    howto: 'Cada punto es una carrera (su ritmo medio); la línea es la media de las 5 últimas, ponderada por distancia. El eje va invertido: subir es ir más rápido.',
  });
}

function bikeCard(ctx) {
  return activityLineCard(ctx, {
    id: 'bike-speed', kind: 'bike', title: 'Velocidad en bici', sub: 'km/h · velocidad media de cada salida', color: COLORS.bike,
    points: S.bikeSpeedSeries(ctx.data), ratio: speedOf, fmt: (v) => `${nf1(v)} km/h`, tick: nf1,
    eachLabel: 'Cada salida', one: 'salida', many: 'salidas', aria: 'Velocidad media de cada salida en bici y media de las 5 últimas',
    emptyAll: 'Registra tu primera salida en bici (con distancia y tiempo) para ver tu velocidad.',
    howto: 'Cada punto es una salida (km ÷ tiempo en movimiento); la línea es la media de las 5 últimas, ponderada por distancia. Las rutas con desnivel bajan la media.',
  });
}

function swimCard(ctx) {
  const pts = S.swimPaceSeries(ctx.data);
  if (!pts.length) return null; // solo si ya nadas: no es una gráfica pedida y evita una tarjeta vacía más
  return activityLineCard(ctx, {
    id: 'swim-pace', kind: 'swim', title: 'Ritmo de natación', sub: 'min/100 m · más arriba = más rápido', color: COLORS.swim,
    points: pts, ratio: pace100Of, invertY: true, yTicks: 'time', fmt: (v) => fmtPace(v, '/100 m'), tick: fmtDuration,
    eachLabel: 'Cada sesión', one: 'sesión', many: 'sesiones', aria: 'Ritmo de natación por sesión',
    emptyAll: '',
    howto: 'Cada punto es una sesión de natación; la línea es la media de las 5 últimas, ponderada por distancia.',
  });
}

// ---------- f) Peso corporal ----------
function bodyweightCard(ctx) {
  const s = S.bodyweightSeries(ctx.data);
  const { el, slot } = chartSection('bodyweight', {
    title: 'Peso corporal',
    sub: 'kg · pesajes diarios y media móvil de 7 días',
    right: h('button.prg-head-link', { type: 'button', onClick: () => goChild('#/bodyweight') }, s.count ? 'Ver todo' : 'Registrar', icon('chevron-right', 16)),
    before: [s.count ? statLine([
      { label: 'Media 7 días', value: kg1(s.ma7), sub: `al ${fmtDay(s.ma7Date, ctx.today)}` },
      { label: 'Tendencia', value: s.trend.ok ? s.trend.label : 'Datos insuficientes', sub: s.trend.ok ? 'sobre la media de 7 días' : 'faltan pesajes', cls: s.trend.ok ? '' : 'prg-stat-na' },
    ]) : null],
    howto: 'Cada punto es un pesaje; la línea verde es la media de 7 días: fíjate en ella, no en un pesaje suelto (el agua o la sal lo mueven ±1 kg).',
  });
  const draw = chartHolder(ctx.charts, slot, 'line', {});
  return {
    el,
    update(pid) {
      const o = bodyweightChartOpts(ctx.data, pid, { height: ctx.h(210), series: s });
      draw(o);
    },
  };
}

// ---------- g) Adherencia ----------
function adherenceCard(ctx) {
  const all = S.adherenceSeries(ctx.data);
  const statsBox = h('div.prg-stats-box');
  const { el, slot } = chartSection('adherence', {
    title: 'Adherencia',
    sub: 'Sesiones planificadas frente a hechas, por semana',
    before: [statsBox],
    howto: 'Planificadas = días de tu semana tipo (o del calendario) que no son descanso. Hechas = hechas, parciales o sustituidas. La semana en curso incluye los días que aún quedan.',
  });
  const draw = chartHolder(ctx.charts, slot, 'bar', {
    // Agrupadas; con muchas semanas (1 año, Todo) charts.js las superpone solo: las hechas delante de las
    // planificadas, y lo gris que asoma encima son las no hechas.
    stacked: false, height: ctx.h(190), yFormat: nf0,
    legend: [{ key: 'planned', label: 'Planificadas', color: COLORS.muted }, { key: 'completed', label: 'Hechas', color: COLORS.accent }],
    ariaLabel: 'Adherencia: sesiones planificadas frente a hechas por semana',
  });
  return {
    el,
    update(pid) {
      const first = all.length ? all[0].week : null;
      const wk = periodRange(pid, ctx.today, first).week;
      const rows = all.filter((r) => r.week >= wk);
      const t = S.adherenceTotals(rows);
      const past = t.planned - t.pending;
      statsBox.replaceChildren(statLine([
        { label: 'Hechas', value: t.pctPast != null ? `${t.pctPast} %` : '—', sub: past > 0 ? `${t.completed} de ${past} en el periodo` : 'sin días planificados todavía' },
        t.pending ? { label: 'Pendientes', value: nf0(t.pending), sub: 'esta semana' } : null,
        t.extra ? { label: 'Extra', value: nf0(t.extra), sub: 'en días de descanso' } : null,
      ]) || '');
      draw({
        bars: rows.map((r) => ({
          x: r.week,
          segments: [
            { key: 'planned', value: r.planned, color: COLORS.muted, name: 'Planificadas' },
            { key: 'completed', value: r.completed, color: COLORS.accent, name: 'Hechas' },
          ],
          tooltip: [r.label, r.pending ? `${plural(r.pending, 'día pendiente', 'días pendientes')}` : null],
        })),
        empty: 'Sin días planificados en este periodo',
      });
    },
  };
}

// ---------- h) Ejercicios con historial ----------
/** Mejor marca que se enseña en listas: 1RM estimado, tiempo, altura o sprint. */
function bestOf(rec) {
  if (!rec) return null;
  if (rec.logType === 'bodyweight') {
    if (rec.bestWeight && rec.bestWeight.value > 0) return { value: rec.bestWeight.label, label: 'lastre máx.' };
    if (rec.maxReps) return { value: rec.maxReps.label, label: 'máximo' };
  }
  if (rec.bestE1rm) return { value: rec.bestE1rm.label, label: '1RM est.' };
  if (rec.bestWeight) return { value: rec.bestWeight.label, label: 'mejor peso' };
  if (rec.maxTime) return { value: rec.maxTime.label, label: 'máximo' };
  if (rec.maxHeight) return { value: rec.maxHeight.label, label: 'altura' };
  if (rec.bestSprint) {
    const first = Object.values(rec.bestSprint)[0];
    if (first) return { value: `${fmtNum(first.timeSec, 2)} s`, label: `${fmtNum(first.distanceM, 1)} m` };
  }
  if (rec.maxReps) return { value: rec.maxReps.label, label: 'máximo' };
  return null;
}

function exercisesSection(ctx) {
  const list = S.exercisesWithHistory(ctx.data);
  const input = h('input.input.prg-search', {
    type: 'search', value: ui.q, placeholder: 'Buscar ejercicio', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
    spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Buscar ejercicio con historial',
  });
  const listEl = h('div.list.prg-ex-list');
  const emptyEl = h('div.prg-ex-empty');
  input.addEventListener('input', () => { ui.q = input.value; paint(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  function row(it) {
    const best = bestOf(S.exerciseRecord(ctx.data, it.exerciseId));
    return h('button.list-item.prg-ex-row', { type: 'button', dataset: { id: it.exerciseId }, onClick: () => goChild(`#/progress/exercise/${it.exerciseId}`) },
      h('span.list-item-main',
        h('span.list-item-title', it.name, it.archived ? h('span.badge.badge-warn.prg-badge-inline', 'Archivado') : null),
        h('span.list-item-sub.wrap', `Última: ${fmtDay(it.lastDate, ctx.today)} · ${plural(it.sessions, 'sesión', 'sesiones')}`)),
      best ? h('span.prg-best', h('span.prg-best-v', best.value), h('span.prg-best-l', best.label)) : null,
      icon('chevron-right', 20, 'chev'));
  }
  function paint() {
    const res = S.searchExercises(list, ui.q);
    listEl.hidden = !res.length;
    listEl.replaceChildren(...res.map(row));
    emptyEl.replaceChildren(res.length ? '' : list.length
      ? h('p.muted.prg-ex-none', `Ningún ejercicio con historial coincide con «${ui.q.trim()}».`)
      : emptyState({ emoji: '🏋️', title: 'Sin ejercicios todavía', text: 'Registra tu primera sesión de fuerza: aquí aparecerán tus ejercicios con su última fecha y su mejor 1RM estimado.' }));
  }
  const el = h('section.prg-ex', { id: 'prg-ex', dataset: { chart: 'exercises' } },
    h('div.row-between.prg-ex-head',
      h('h2.section-title', 'Ejercicios'),
      list.length ? h('span.muted.small', plural(list.length, 'con historial', 'con historial')) : null),
    list.length ? input : null,
    listEl,
    emptyEl);
  return { el, paint };
}

// ===========================================================================
// #/progress/exercise/:id
// ===========================================================================

/** Récords batidos serie a serie (misma regla que el resumen de la sesión: nunca en la primera sesión). */
function prMarks(hist, ex) {
  const bests = emptyBests();
  return hist.map((e) => {
    bests.prior = bests.count;
    return e.sets.map((set) => {
      const prs = detectPRs(set, ex, bests, e.bw);
      addToBests(bests, set, ex, e.bw);
      return prs;
    });
  });
}

function fichaLink(ex) {
  return h('button.list-item.prg-link-row', { type: 'button', dataset: { link: 'ficha' }, onClick: () => navigate(`#/exercise/${ex.id}`) },
    icon('dumbbell', 22),
    h('span.list-item-main', h('span.list-item-title', 'Ficha del ejercicio'), h('span.list-item-sub', 'Músculos, patrón, notas y rutinas')),
    icon('chevron-right', 20, 'chev'));
}

/** Dato clave de una fila del historial (a la derecha). */
function histKey(e, lt) {
  if (lt === 'bodyweight') {
    if (e.maxWeight) return { v: S.weightLabel(lt, e.maxWeight), l: e.maxWeight > 0 ? 'lastre' : 'asist.' };
    return e.maxReps != null ? { v: `${e.maxReps} reps`, l: 'máx.' } : null;
  }
  if (LOAD_TYPES.includes(lt)) return e.e1rm != null ? { v: kg1(e.e1rm), l: '1RM est.' } : e.maxWeight != null ? { v: S.weightLabel(lt, e.maxWeight), l: 'máx.' } : null;
  if (lt === 'time' && e.maxTime != null) return { v: fmtSec(e.maxTime), l: 'máx.' };
  if (lt === 'jumps') return e.maxHeight != null ? { v: `${fmtNum(e.maxHeight, 1)} cm`, l: 'altura' } : e.maxReps != null ? { v: `${e.maxReps} reps`, l: 'máx.' } : null;
  if (lt === 'distance_time') {
    const k = Object.keys(e.sprints || {}).sort((a, b) => Number(a) - Number(b))[0];
    if (k) return { v: `${fmtNum(e.sprints[k], 2)} s`, l: `${fmtNum(Number(k), 1)} m` };
  }
  return null;
}

export function mountExerciseProgress(root, params = {}) {
  const data = dataFromStore();
  const ex = data.exercises.get(params.id);
  if (!ex) {
    const c = screen(root, { title: 'Progreso', back: '#/progress' });
    c.appendChild(emptyState({ emoji: '🤷', title: 'Ejercicio no encontrado', text: 'Puede que se haya borrado.', action: { label: 'Volver a Progreso', onClick: () => navigate('#/progress', { replace: true }) } }));
    return undefined;
  }
  const c = screen(root, { title: ex.name, back: '#/progress' });
  c.classList.add('prg', 'prg-exp');
  const today = data.today;
  const lt = ex.logType;
  if (lt === 'cardio') {
    c.append(h('section.card', h('p.text-2', 'Es una actividad de resistencia: se registra como carrera, bici o natación y su progreso (kilómetros, ritmo, velocidad y récords) está en Progreso.'),
      h('button.btn.btn-secondary.btn-block', { type: 'button', onClick: () => navigate('#/progress') }, 'Ir a Progreso')), fichaLink(ex));
    return undefined;
  }
  const sum = S.exerciseSummary(data, ex.id);
  if (!sum || !sum.sessions) {
    c.append(h('section.card', emptyState({
      emoji: '📈', title: 'Sin historial todavía',
      text: 'Registra una sesión con este ejercicio (al menos una serie de trabajo) para ver aquí su peso máximo, su 1RM estimado y su historial. Los calentamientos no cuentan.',
    })), fichaLink(ex));
    return undefined;
  }
  const rec = sum.record || {};
  const hist = S.exerciseHistory(data, ex.id, { labels: false }); // asc: una fila por sesión, series de trabajo
  const load = LOAD_TYPES.includes(lt);
  const bw = lt === 'bodyweight';
  const charts = [];

  // KPIs
  const k = (label, value, sub, key) => h('div.kpi.prg-kpi', { dataset: { kpi: key } },
    h('div.kpi-label', label), h('div.kpi-value', value ?? '—'), sub ? h('div.kpi-sub', sub) : null);
  const dated = (r) => (r ? fmtDay(r.date, today) : null);
  const kpis = [];
  const anyLastre = bw && hist.some((e) => e.maxWeight);
  const ser = S.exerciseSeries(data, ex.id);
  // Peso corporal sin 1RM estimado (core, donde el peso corporal no cuenta, o todas las series de más de 12 reps):
  // ni KPI ni gráfica de 1RM; se sigue por repeticiones.
  const bwNoE1rm = bw && !rec.bestE1rm && !ser.e1rm.length;
  const core = bw && ex.pattern === 'core';
  const repsKpi = () => k('Más repeticiones', rec.maxReps?.label, rec.maxReps ? `${rec.maxReps.setLabel} · ${dated(rec.maxReps)}` : null, 'reps');
  if (load) {
    if (bw && !anyLastre) kpis.push(repsKpi());
    else kpis.push(k(bw ? 'Mayor lastre' : 'Mejor peso', rec.bestWeight?.label, rec.bestWeight ? `${rec.bestWeight.setLabel} · ${dated(rec.bestWeight)}` : null, 'weight'));
    if (!bwNoE1rm) kpis.push(k('Mejor 1RM estimado', rec.bestE1rm?.label, rec.bestE1rm ? `${bw ? 'estimación (con tu peso)' : 'estimación'} · ${dated(rec.bestE1rm)}` : 'sin series de 1–12 reps', 'e1rm'));
    else if (anyLastre) kpis.push(repsKpi());
    else kpis.push(k('Series de trabajo', nf0(sum.workSets), 'en total', 'sets'));
  } else if (lt === 'time') {
    kpis.push(k('Tiempo máximo', rec.maxTime?.label, rec.maxTime ? dated(rec.maxTime) : null, 'time'));
    kpis.push(k('Series de trabajo', nf0(sum.workSets), 'en total', 'sets'));
  } else if (lt === 'jumps') {
    kpis.push(k('Altura máxima', rec.maxHeight?.label ?? 'Sin altura', rec.maxHeight ? dated(rec.maxHeight) : 'regístrala (opcional)', 'height'));
    kpis.push(k('Más repeticiones', rec.maxReps?.label, rec.maxReps ? dated(rec.maxReps) : null, 'reps'));
  } else if (lt === 'distance_time') {
    const sp = Object.values(rec.bestSprint || {}).slice(0, 2);
    for (const r of sp) kpis.push(k(`Mejor ${fmtNum(r.distanceM, 1)} m`, `${fmtNum(r.timeSec, 2)} s`, dated(r), `sprint-${r.distanceM}`));
    if (sp.length < 2) kpis.push(k('Series de trabajo', nf0(sum.workSets), 'en total', 'sets'));
  }
  kpis.push(k('Sesiones', nf0(sum.sessions), plural(sum.workSets, 'serie de trabajo', 'series de trabajo'), 'sessions'));
  kpis.push(k('Última vez', fmtDay(sum.lastDate, today), relDay(sum.lastDate, today), 'last'));
  c.appendChild(h('div.kpis.kpis-2.prg-kpis', kpis));

  // Gráficas (todas con el mismo selector de periodo)
  const defs = [];
  if (load) {
    const showWeight = !bw || anyLastre;
    const wFmt = bw ? (v) => S.weightLabel('bodyweight', v) : kg1;
    if (showWeight) {
      defs.push({
        id: 'maxWeight', title: bw ? 'Lastre máximo' : 'Peso máximo', color: COLORS.accent, points: ser.maxWeight, fmt: wFmt, tick: nf1,
        sub: bw ? 'kg de lastre de la serie más pesada (negativo = asistencia)' : 'kg · la serie más pesada de cada sesión',
        howto: 'Toca un punto para ver esa serie: peso × repeticiones @RIR.',
      });
    }
    if (!bwNoE1rm) {
      defs.push({
        id: 'e1rm', title: '1RM estimado', color: COLORS.info, points: ser.e1rm, fmt: kg1, tick: nf1, sub: bw ? 'kg · el mejor de cada sesión (peso corporal + lastre)' : 'kg · el mejor de cada sesión',
        note: `Estimación con la fórmula de Epley usando reps + RIR; solo series de 1–12 reps.${bw ? ' Incluye tu peso corporal del día.' : ''} No es un peso levantado.`,
        empty: 'Sin series de 1–12 repeticiones en este periodo',
      });
    }
    // Mejor serie de cada sesión (stats: la de mayor 1RM estimado o, si ninguna lo tiene, la de más peso × reps),
    // tal cual: y = peso levantado de esa serie (peso corporal: lastre) y el globo, la serie entera.
    if (showWeight) {
      const unit = bw ? 'kg de lastre' : 'kg';
      const weightMode = {
        mode: 'weight',
        sub: bwNoE1rm ? `${unit} · la serie de más peso × reps de cada sesión`
          : `${unit} · la serie con mayor 1RM estimado de cada sesión (sin series de 1–12 reps, la de más peso × reps)`,
        howto: 'El globo muestra la serie completa (peso × reps @RIR). Si sube el peso sin perder repeticiones, progresas. Si ninguna serie del día tiene 1RM estimado (más de 12 reps), cuenta la de más peso × reps.',
        opts: { series: [{ id: 'bestSet', label: 'Mejor serie', color: COLORS.swim, points: ser.bestSet, dots: true }], yFormat: wFmt, yTickFormat: nf1 },
      };
      // Doble progresión: si en el periodo la mejor serie pesa siempre lo mismo que el peso máximo, la gráfica
      // repetiría la de arriba; entonces dibuja las repeticiones de esa serie (el globo sigue dando la serie entera).
      const repsPts = ser.bestSet.filter((p) => p.reps != null).map((p) => ({ ...p, y: p.reps }));
      const repsMode = {
        mode: 'reps',
        sub: `reps · la mejor serie de cada sesión (en este periodo, su ${bw ? 'lastre' : 'peso'} es siempre el ${bw ? 'lastre' : 'peso'} máximo)`,
        howto: 'Con doble progresión la mejor serie es la más pesada, así que aquí ves sus repeticiones: suben a igual peso y bajan al subir el peso. El globo muestra la serie completa (peso × reps @RIR).',
        opts: { series: [{ id: 'bestSet', label: 'Mejor serie', color: COLORS.swim, points: repsPts, dots: true }], yFormat: (v) => `${nf0(v)} reps`, yTickFormat: nf0 },
      };
      defs.push({
        id: 'bestSet', title: 'Mejor serie', color: COLORS.swim, points: ser.bestSet, fmt: wFmt, tick: nf1,
        sub: weightMode.sub, howto: weightMode.howto, empty: 'Sin series en este periodo',
        adapt(from, to) {
          const inP = (p) => p.x >= from && p.x <= to;
          const bs = ser.bestSet.filter(inP);
          const mw = ser.maxWeight.filter(inP);
          const same = bs.length > 0 && bs.length === mw.length && bs.every((p, i) => p.reps != null && p.x === mw[i].x && Math.abs(p.y - mw[i].y) < 1e-9);
          return same ? repsMode : weightMode;
        },
      });
    }
    if (bw) {
      defs.push({ id: 'maxReps', title: 'Repeticiones máximas', color: COLORS.accent, points: ser.maxReps, fmt: (v) => `${nf0(v)} reps`, tick: nf0, sub: 'reps · la serie con más repeticiones de cada sesión' });
    }
    // Core de peso corporal: el volumen es solo el lastre × reps (sin lastre no hay volumen: no se pinta la tarjeta).
    if (!core || ser.volume.length) {
      defs.push({
        id: 'volume', title: 'Volumen', color: COLORS.strength, points: ser.volume, fmt: (v) => S.fmtMetric('volume', v), tick: nf0,
        sub: core ? 'kg por sesión · lastre × reps (en core el peso corporal no cuenta)' : bw ? 'kg por sesión · (peso corporal + lastre) × reps' : lt === 'unilateral' ? 'kg por sesión · peso × reps de los dos lados' : 'kg por sesión · peso × repeticiones',
        howto: 'Suma de las series de trabajo de cada sesión (sin calentamientos).',
      });
    }
  } else if (lt === 'time') {
    defs.push({ id: 'maxTime', title: 'Tiempo máximo', color: COLORS.accent, points: ser.maxTime, fmt: (v) => fmtSec(v), tick: fmtDuration, yTicks: 'time', sub: 'la serie más larga de cada sesión (min:s)', howto: 'Toca un punto para ver el tiempo exacto.' });
  } else if (lt === 'jumps') {
    defs.push({ id: 'maxHeight', title: 'Altura máxima', color: COLORS.accent, points: ser.maxHeight, fmt: (v) => `${nf1(v)} cm`, tick: nf1, sub: 'cm · el salto más alto de cada sesión', empty: 'Registra la altura de tus saltos (es opcional) para ver su evolución.' });
    defs.push({ id: 'maxReps', title: 'Repeticiones máximas', color: COLORS.info, points: ser.maxReps, fmt: (v) => `${nf0(v)} reps`, tick: nf0, sub: 'reps · la serie con más repeticiones de cada sesión' });
  } else if (lt === 'distance_time') {
    defs.push({
      id: 'sprint', title: 'Mejor tiempo por distancia', fmt: (v) => `${S.fmtNumFast(v, 2)} s`, tick: (v) => S.fmtNumFast(v, 2), invertY: true,
      series: ser.sprint.map((s, i) => ({ id: `d${s.distanceM}`, label: s.label, color: SPRINT_COLORS[i % SPRINT_COLORS.length], points: s.points, dots: true })),
      sub: 's · el más rápido de cada sesión; más arriba = más rápido', empty: 'Registra distancia y tiempo de tus series para ver su evolución.',
    });
  }

  const first = sum.firstDate;
  const holders = [];
  if (defs.length) {
    let period = getPeriod('exercise');
    const update = (pid) => {
      const { from } = periodRange(pid, today, first);
      for (const { draw, d, el } of holders) {
        const o = { xDomain: [from, today] };
        if (d.adapt) { // lo que dibuja depende del periodo (mejor serie con doble progresión)
          const m = d.adapt(from, today);
          Object.assign(o, m.opts);
          el.dataset.mode = m.mode;
          const subEl = el.querySelector('.prg-card-sub');
          const howEl = el.querySelector('.prg-howto');
          if (subEl) subEl.textContent = m.sub;
          if (howEl) howEl.textContent = m.howto;
        }
        draw(o);
      }
    };
    // Selector pegajoso solo sobre las gráficas (no sobre el historial, que no depende del periodo).
    const chartsBox = h('div.prg-charts', periodBar(root, 'exercise', (id) => { period = id; update(period); }));
    c.appendChild(chartsBox);
    for (const d of defs) {
      const { el, slot } = chartSection(d.id, { title: d.title, sub: d.sub, note: d.note, howto: d.howto });
      chartsBox.appendChild(el);
      const draw = chartHolder(charts, slot, 'line', {
        series: d.series || [{ id: d.id, label: d.title, color: d.color, points: d.points, dots: true }],
        height: chartHeight(190), yFormat: d.fmt, yTickFormat: d.tick || d.fmt, invertY: !!d.invertY, yTicks: d.yTicks || 'auto',
        empty: d.empty || 'Sin datos en este periodo', ariaLabel: `${ex.name}: ${d.title.toLowerCase()}`,
      });
      holders.push({ draw, d, el });
    }
    update(period);
  }

  // Historial completo (más reciente primero): todas las sesiones y series de trabajo, récords marcados.
  const marks = prMarks(hist, ex);
  const listEl = h('div.list.prg-hist');
  for (let i = hist.length - 1; i >= 0; i--) {
    const e = hist[i];
    const mk = marks[i];
    const key = histKey(e, lt);
    const anyPr = mk.some((m) => m.length);
    listEl.appendChild(h('button.list-item.prg-hrow', {
      type: 'button', dataset: { session: e.sessionId, pr: anyPr ? '1' : '' }, onClick: () => navigate(`#/session/${e.sessionId}`),
    },
    h('span.list-item-main',
      h('span.prg-hrow-title', h('span', fmtDate(e.date, 'full')), anyPr ? h('span.badge.badge-pr', '🏆 Récord') : null),
      h('span.list-item-sub', e.templateName),
      h('span.prg-hrow-sets', e.sets.flatMap((set, j) => [
        j ? h('span.prg-sep', ' · ') : null,
        h(`span.prg-set${mk[j].length ? '.prg-set-pr' : ''}`, formatSet(set, lt), mk[j].length ? h('span.prg-pr-mark', { 'aria-label': 'récord', role: 'img' }, ' 🏆') : null),
      ]))),
    key ? h('span.prg-best', h('span.prg-best-v', key.v), h('span.prg-best-l', key.l)) : null,
    icon('chevron-right', 18, 'chev')));
  }
  c.append(
    h('div.row-between.prg-hist-head', h('h2.section-title', 'Historial completo'), h('span.muted.small', plural(hist.length, 'sesión', 'sesiones'))),
    h('p.prg-hist-note', '🏆 = récord en ese momento (más peso, más 1RM estimado, más reps a un peso, más tiempo o altura). Solo series de trabajo: sin calentamientos. Toca una sesión para abrirla.'),
    listEl,
    fichaLink(ex));
  return () => { for (const ch of charts) ch.destroy(); charts.length = 0; };
}

// ===========================================================================
// #/records
// ===========================================================================

function recRow({ label, value, sub, sessionId = null, href = null, badge = null, key = '', muted = false }) {
  const inner = [
    h('span.prg-rec-main',
      h('span.prg-rec-label', label, badge ? h('span.badge.badge-info.prg-badge-inline', badge) : null),
      sub ? h('span.prg-rec-sub', sub) : null),
    h(`span.prg-rec-value${muted ? '.prg-rec-na' : ''}`, value),
  ];
  if (!sessionId) return h('div.prg-rec-row.prg-rec-static', { dataset: { rec: key } }, ...inner);
  return h('button.prg-rec-row', { type: 'button', dataset: { rec: key, session: sessionId }, onClick: () => navigate(href || `#/session/${sessionId}`) },
    ...inner, icon('chevron-right', 18, 'chev'));
}

export function mountRecords(root) {
  const c = screen(root, { title: 'Récords', back: '#/progress' });
  c.classList.add('prg', 'prg-records');
  const data = dataFromStore();
  const today = data.today;
  if (ui.recSeg !== 'strength' && ui.recSeg !== 'endurance') ui.recSeg = 'strength';
  const body = h('div.prg-rec-body');
  const seg = segmented({
    options: [{ value: 'strength', label: '🏋️ Fuerza' }, { value: 'endurance', label: '🏃 Resistencia' }],
    value: ui.recSeg,
    ariaLabel: 'Tipo de récords',
    onChange: (v) => { ui.recSeg = v; paint(); window.scrollTo(0, 0); },
  });
  seg.classList.add('prg-seg');
  c.append(seg, body);
  let strengthEl = null;
  let enduranceEl = null;
  function paint() {
    if (ui.recSeg === 'strength') body.replaceChildren(strengthEl || (strengthEl = strengthRecordsView(data, today)));
    else body.replaceChildren(enduranceEl || (enduranceEl = enduranceRecordsView(data, today)));
  }
  paint();
  return undefined;
}

function strengthRecordsView(data, today) {
  const recs = S.strengthRecords(data);
  if (!recs.length) {
    return h('section.card', emptyState({
      emoji: '🏆', title: 'Aún no hay récords de fuerza',
      text: 'Registra tu primera sesión de fuerza: cada ejercicio con series de trabajo tendrá aquí su mejor peso, su mejor 1RM estimado y sus mejores repeticiones a cada peso.',
    }));
  }
  const items = recs.map((r) => ({ name: r.name, exercise: data.exercises.get(r.exerciseId), rec: r }));
  const dateTxt = (r) => fmtDate(r.date, 'full');
  const input = h('input.input.prg-search', {
    type: 'search', value: ui.recQ, placeholder: 'Buscar ejercicio', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
    spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Buscar récords por ejercicio',
  });
  const listEl = h('div.prg-rec-list');
  const cardCache = new Map();
  function card(r) {
    const lt = r.logType;
    const bw = lt === 'bodyweight';
    const rows = [];
    if (r.bestWeight && !(bw && !r.bestWeight.value)) {
      rows.push(recRow({ key: 'weight', label: bw ? 'Mayor lastre' : 'Mejor peso', value: r.bestWeight.label, sub: `${r.bestWeight.setLabel} · ${dateTxt(r.bestWeight)}`, sessionId: r.bestWeight.sessionId }));
    }
    if (r.bestE1rm) {
      rows.push(recRow({
        key: 'e1rm', label: 'Mejor 1RM estimado', badge: 'estimación', value: r.bestE1rm.label,
        sub: `${r.bestE1rm.setLabel}${r.bwLabel ? ` · con ${r.bwLabel}` : ''} · ${dateTxt(r.bestE1rm)}`, sessionId: r.bestE1rm.sessionId,
      }));
    }
    if (r.maxTime) rows.push(recRow({ key: 'time', label: 'Tiempo máximo', value: r.maxTime.label, sub: dateTxt(r.maxTime), sessionId: r.maxTime.sessionId }));
    if (r.maxHeight) rows.push(recRow({ key: 'height', label: 'Salto más alto', value: r.maxHeight.label, sub: `${r.maxHeight.setLabel} · ${dateTxt(r.maxHeight)}`, sessionId: r.maxHeight.sessionId }));
    if (r.bestSprint) {
      for (const sp of Object.values(r.bestSprint)) {
        rows.push(recRow({ key: `sprint-${sp.distanceM}`, label: `Mejor en ${fmtNum(sp.distanceM, 1)} m`, value: `${fmtNum(sp.timeSec, 2)} s`, sub: dateTxt(sp), sessionId: sp.sessionId }));
      }
    }
    const showMaxReps = !!r.maxReps && (bw || lt === 'jumps' || (!r.bestWeight && !r.maxTime && !r.bestSprint));
    if (showMaxReps) {
      rows.push(recRow({ key: 'reps', label: 'Más repeticiones', value: r.maxReps.label, sub: `${r.maxReps.setLabel} · ${dateTxt(r.maxReps)}`, sessionId: r.maxReps.sessionId }));
    }
    const perSide = lt === 'unilateral' ? '/lado' : '';
    let reps = null;
    if (r.repsAtWeight.length === 1) {
      // Un solo peso (doble progresión a peso fijo: 10 kg × 12 → × 15 → × 18): fila directa con las mejores reps
      // a ese peso y su fecha, salvo que ya lo diga «Más repeticiones» (peso corporal sin lastre).
      const x = r.repsAtWeight[0];
      if (!(showMaxReps && r.maxReps.value === x.reps)) {
        const wTxt = bw && !x.weight ? 'sin lastre' : `con ${S.weightLabel(lt, x.weight)}`;
        rows.push(recRow({ key: 'reps-at', label: `Mejores reps ${wTxt}`, value: `× ${x.reps}${perSide}`, sub: dateTxt(x), sessionId: x.sessionId }));
      }
    } else if (r.repsAtWeight.length > 1) {
      const box = h('div.prg-rec-reps', { hidden: true },
        r.repsAtWeight.map((x) => recRow({
          key: 'reps-at', label: S.weightLabel(lt, x.weight), value: `× ${x.reps}${perSide}`,
          sub: `${dateTxt(x)}${x.dominated ? ' · superado con más peso' : ''}`, sessionId: x.sessionId, muted: x.dominated,
        })));
      const btn = h('button.prg-rec-toggle', { type: 'button', 'aria-expanded': 'false' },
        h('span', 'Mejores reps a cada peso'), h('span.prg-rec-count', `${r.repsAtWeight.length}`), icon('chevron-down', 18));
      btn.addEventListener('click', () => {
        box.hidden = !box.hidden;
        btn.setAttribute('aria-expanded', String(!box.hidden));
        btn.classList.toggle('open', !box.hidden);
      });
      reps = [btn, box];
    }
    return h('section.card.prg-rec', { dataset: { ex: r.exerciseId } },
      h('button.prg-rec-head', { type: 'button', onClick: () => navigate(`#/progress/exercise/${r.exerciseId}`), 'aria-label': `${r.name}: ver progreso` },
        h('span.prg-rec-titles',
          h('span.prg-rec-name', r.name, r.archived ? h('span.badge.badge-warn.prg-badge-inline', 'Archivado') : null),
          h('span.prg-rec-meta', `${plural(r.sessions, 'sesión', 'sesiones')} · última ${fmtDay(r.lastDate, today)}`)),
        h('span.prg-rec-go', 'Progreso', icon('chevron-right', 16))),
      h('div.prg-rec-rows', rows),
      reps);
  }
  function paint() {
    const res = S.searchExercises(items, ui.recQ);
    listEl.replaceChildren(...(res.length
      ? res.map((it) => { let el = cardCache.get(it.rec.exerciseId); if (!el) { el = card(it.rec); cardCache.set(it.rec.exerciseId, el); } return el; })
      : [h('p.muted.prg-ex-none', `Ningún ejercicio coincide con «${ui.recQ.trim()}».`)]));
  }
  input.addEventListener('input', () => { ui.recQ = input.value; paint(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  paint();
  return h('div.prg-rec-strength',
    input,
    h('p.prg-hist-note', 'Cada récord lleva la fecha de la primera vez que lo lograste; tócalo para abrir esa sesión. El 1RM es una estimación (Epley con reps + RIR, series de 1–12 reps), no un peso levantado.'),
    listEl);
}

function enduranceRecordsView(data, today) {
  const e = S.enduranceRecords(data);
  const dateTxt = (r) => fmtDate(r.date, 'full');
  const km = (v) => fmtNum(v, 2);
  const longestRow = (kind, r, emptyTxt) => {
    if (!r) return recRow({ key: 'longest', label: 'Mayor distancia', value: 'sin datos', sub: emptyTxt, muted: true });
    const parts = [];
    if (r.movingSec > 0) {
      parts.push(fmtDuration(r.movingSec));
      if (kind === 'run') parts.push(fmtPace(r.movingSec / r.distanceKm));
      if (kind === 'bike') parts.push(`${nf1(r.distanceKm / (r.movingSec / 3600))} km/h`);
      if (kind === 'swim') parts.push(fmtPace(r.movingSec / (r.distanceKm * 10), '/100 m'));
    }
    parts.push(dateTxt(r));
    return recRow({ key: 'longest', label: 'Mayor distancia', value: r.label, sub: parts.join(' · '), sessionId: r.sessionId, href: `#/activity/${r.sessionId}` });
  };
  const head = (emoji, title, count, one, many) => h('div.prg-rec-khead',
    h('span.prg-rec-name', h('span', { 'aria-hidden': 'true' }, `${emoji} `), title),
    h('span.prg-rec-meta', count ? plural(count, one, many) : 'sin registros'));

  const runRows = [longestRow('run', e.run.longest, 'Registra tu primera carrera con distancia.')];
  for (const r of S.RACE_DISTANCES) {
    const b = e.run.best[r.id];
    if (!b) {
      runRows.push(recRow({ key: r.id, label: r.label, value: 'sin datos', sub: `Aún no hay carreras de ${fmtNum(r.km, 1)} km o más`, muted: true }));
      continue;
    }
    const how = b.estimated
      ? `estimado a ritmo medio desde una carrera de ${km(b.fromKm)} km`
      : `en una carrera de ${km(b.fromKm)} km`;
    runRows.push(recRow({ key: r.id, label: r.label, value: b.timeLabel, sub: `${b.paceLabel} · ${how} · ${dateTxt(b)}`, sessionId: b.sessionId, href: `#/activity/${b.sessionId}`, badge: b.estimated ? 'estimado' : null }));
  }
  return h('div.prg-rec-endurance',
    h('section.card.prg-rec', { dataset: { sport: 'run' } },
      head('🏃', 'Carrera', e.run.count, 'carrera', 'carreras'),
      h('div.prg-rec-rows', runRows),
      h('p.prg-hist-note', 'Los tiempos salen de carreras de esa distancia o más largas. Si la carrera fue más larga, el tiempo se estima con su ritmo medio (no es un tiempo cronometrado en esa distancia).')),
    h('section.card.prg-rec', { dataset: { sport: 'bike' } },
      head('🚴', 'Bici', e.bike.count, 'salida', 'salidas'),
      h('div.prg-rec-rows', longestRow('bike', e.bike.longest, 'Registra tu primera salida en bici con distancia.'))),
    h('section.card.prg-rec', { dataset: { sport: 'swim' } },
      head('🏊', 'Natación', e.swim.count, 'sesión', 'sesiones'),
      h('div.prg-rec-rows', longestRow('swim', e.swim.longest, 'Registra tu primera sesión de natación con distancia.'))));
}
