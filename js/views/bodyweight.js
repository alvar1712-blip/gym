// bodyweight.js — peso corporal: registro rápido, media móvil de 7 días, tendencia semanal y lista.
// Un valor por día (id = fecha); si se registra otra vez el mismo día, el último manda.
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, screen, stepper, toast, undoToast, sheet, confirmDialog, whyBox, field, confirmRare } from '../ui.js';
import { todayStr, fmtDate, fmtNum, fmtKg, fmtSigned, relDay, parseDate, isDateStr } from '../util.js';
import { bwStats, bwWithDeltas, roundKg, trendWord, BW_TREND } from '../activity-logic.js';
import { bodyweightChartCard, bodyweightChartOpts, cardHead } from '../progress-ui.js';
import { lineChart, periodSelector, getPeriod } from '../charts.js';
import { getProfile, cycleEnabled, isHormonal } from '../profile.js';
import { periodsFromDays } from '../cycle-logic.js';
import { checkBodyweight } from '../sanity.js';

const KG_MIN = 20;
const KG_MAX = 300;
const PAGE = 60; // pesajes mostrados por tanda en la lista

const validKg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= KG_MIN && v <= KG_MAX;

/** Valor inicial del stepper: el de ese día si existe; si no, el último registrado; si no, el de Ajustes. */
function initialKg(date) {
  const same = store.get('bodyweight', date);
  if (same) return same.kg;
  const last = store.bodyweightList().at(-1);
  return last ? last.kg : store.settings()?.bodyweightDefault ?? 75;
}

/** Guarda (o sustituye) el pesaje de una fecha. Devuelve { entry, prev } (prev = copia del anterior o null). */
async function saveEntry(date, kg) {
  const value = roundKg(kg);
  let entry = store.get('bodyweight', date);
  const prev = entry ? { ...entry } : null;
  if (entry) entry.kg = value;
  else entry = { id: date, kg: value };
  await store.save('bodyweight', entry);
  return { entry, prev };
}

/** Deshacer tras sustituir o crear un pesaje. onUndone: se llama cuando ya se ha deshecho. */
function offerUndo(msg, { entry, prev }, onUndone) {
  undoToast(msg, async () => {
    if (prev) await store.restore('bodyweight', prev);
    else await store.remove('bodyweight', entry.id);
    if (onUndone) onUndone();
  });
}

/** Aviso tras guardar: si sustituye un pesaje distinto del mismo día, dice cuál y ofrece deshacer. */
function notifySaved(res, onUndone) {
  const replaced = res.prev && res.prev.kg !== res.entry.kg;
  if (replaced) offerUndo(`Peso guardado: ${fmtKg(res.entry.kg)} (antes ${fmtKg(res.prev.kg)})`, res, onUndone);
  else toast(`Peso guardado: ${fmtKg(res.entry.kg)}`, { kind: 'success' });
}

const fmtDay = (date) => {
  const sameYear = parseDate(date).getFullYear() === parseDate(todayStr()).getFullYear();
  return fmtDate(date, sameYear ? 'short' : 'full');
};

// ---------------------------------------------------------------------------
// CONTRATO (lo usa la pantalla Hoy): tarjeta de registro rápido de peso corporal.
// ---------------------------------------------------------------------------
/**
 * @param {{onSaved?:(entry)=>void}} opts
 * @returns {HTMLElement}
 */
export function bodyweightQuickEntry({ onSaved } = {}) {
  const today = todayStr();
  let val = initialKg(today);
  const info = h('div.bwq-info');
  const st = stepper({
    value: val, step: 0.1, decimals: 1, min: KG_MIN, max: KG_MAX, suffix: 'kg', size: 'md',
    ariaLabel: 'Peso de hoy (kg)', onChange: (v) => { val = v; },
  });
  st.classList.add('bwq-stepper');
  const btn = h('button.btn.btn-primary.bwq-save', {
    type: 'button',
    onClick: async () => {
      if (!validKg(val)) { toast(`Introduce un peso entre ${KG_MIN} y ${KG_MAX} kg.`, { kind: 'error' }); return; }
      if (!(await confirmRare(checkBodyweight(val)))) return; // 210 kg → «¿Seguro?»
      const res = await saveEntry(today, val);
      val = res.entry.kg;
      st.setValue(val);
      paint();
      // Sustituir el pesaje de hoy se puede deshacer (vuelve el valor anterior).
      notifySaved(res, () => {
        val = initialKg(today);
        st.setValue(val);
        paint();
      });
      if (onSaved) onSaved(res.entry);
    },
  }, 'Guardar');

  function paint() {
    const s = bwStats(store.bodyweightList(), today);
    if (!s.count) { info.textContent = 'Sin pesajes todavía.'; return; }
    const lastTxt = s.last.date === today ? `Hoy ${fmtKg(s.last.kg)}` : `Último ${fmtKg(s.last.kg)} (${relDay(s.last.date, today)})`;
    info.replaceChildren(h('span', lastTxt), h('span.bwq-sep', ' · '), h('span', 'media 7 días '), h('b', fmtKg(s.ma7)));
  }
  paint();

  return h('div.card.bwq',
    h('div.card-head',
      h('div.card-title', '⚖️ Peso corporal'),
      h('button.bwq-link', { type: 'button', onClick: () => navigate('#/bodyweight') }, 'Ver todo', icon('chevron-right', 18))),
    info,
    h('div.bwq-row', st, btn));
}

// ---------------------------------------------------------------------------
// Pantalla #/bodyweight
// ---------------------------------------------------------------------------
export function mountBodyweight(root) {
  const c = screen(root, { title: 'Peso corporal', back: '#/progress' });
  let shown = PAGE;

  // ---------- registro rápido ----------
  let date = todayStr();
  let kg = initialKg(date);
  const dateInp = h('input.input.bw-date', { type: 'date', value: date, max: todayStr(), 'aria-label': 'Fecha del pesaje' });
  const st = stepper({
    value: kg, step: 0.1, decimals: 1, min: KG_MIN, max: KG_MAX, showStep: true, suffix: 'kg', size: 'lg',
    ariaLabel: 'Peso (kg)', onChange: (v) => { kg = v; },
  });
  st.classList.add('bw-stepper');
  const hint = h('div.field-hint.bw-hint');
  const saveBtn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'button', onClick: onSave }, 'Guardar');

  dateInp.addEventListener('change', () => {
    if (!isDateStr(dateInp.value)) return;
    date = dateInp.value;
    const same = store.get('bodyweight', date);
    if (same) { kg = same.kg; st.setValue(kg); }
    paintHint();
  });

  // Si el pesaje de la fecha elegida cambia en otro sitio (tarjeta de Hoy, deshacer…), el stepper lo refleja.
  function syncStepper() {
    const same = store.get('bodyweight', date);
    if (same && same.kg !== kg && document.activeElement !== st.input) { kg = same.kg; st.setValue(kg); }
  }

  function paintHint() {
    const same = store.get('bodyweight', date);
    hint.textContent = same
      ? `Ya hay un pesaje ${date === todayStr() ? 'hoy' : 'ese día'} (${fmtKg(same.kg)}): se sustituirá.`
      : 'Un pesaje por día. Mejor en ayunas y en condiciones parecidas.';
  }

  async function onSave() {
    if (!validKg(kg)) { toast(`Introduce un peso entre ${KG_MIN} y ${KG_MAX} kg.`, { kind: 'error' }); return; }
    if (!isDateStr(date)) { toast('Elige una fecha.', { kind: 'error' }); return; }
    if (date > todayStr()) { toast('La fecha no puede ser futura.', { kind: 'error' }); return; }
    if (!(await confirmRare(checkBodyweight(kg)))) return;
    const res = await saveEntry(date, kg);
    st.setValue(res.entry.kg);
    notifySaved(res);
  }

  const entryCard = h('div.card.card-accent.bw-entry',
    h('div.row-between',
      h('div.card-title', 'Registrar peso'),
      dateInp),
    st,
    hint,
    saveBtn);

  // ---------- resumen, hueco de gráfica y lista ----------
  const statsBox = h('div.bw-stats');
  const chartSlot = h('div.bw-chart-slot'); // la Fase 2 dibuja aquí la gráfica
  const bwChart = weightChartCard(); // se redibuja sola al cambiar un pesaje (y, en modo mujer, los días de regla)
  chartSlot.appendChild(bwChart.el);
  const listTitle = h('div.section-title', 'Pesajes');
  const listBox = h('div.bw-list-box');

  c.append(entryCard, statsBox, chartSlot, listTitle, listBox);

  function paintStats() {
    const s = bwStats(store.bodyweightList(), todayStr());
    if (!s.count) {
      statsBox.replaceChildren(h('div.card', h('p.muted', 'Aún no hay pesajes. Registra el primero arriba: con unos cuantos días verás la media de 7 días y la tendencia.')));
      return;
    }
    const t = s.trend;
    const trendVal = t.ok
      ? h('div.bw-kpi-value', fmtSigned(t.kgPerWeek, 2), ' ', h('span.bw-unit', 'kg/sem')) // el espacio fuera: la unidad puede bajar de línea
      : h('div.bw-kpi-value.bw-kpi-na', 'Datos insuficientes');
    const trendSub = t.ok
      ? `${trendWord(t.kgPerWeek)} · ${t.n} pesajes en ${t.span} días`
      : `Hay ${t.n} ${t.n === 1 ? 'pesaje' : 'pesajes'} en los últimos ${BW_TREND.windowDays} días`;
    statsBox.replaceChildren(h('div.card.bw-summary',
      h('div.bw-kpis',
        h('div.bw-kpi.bw-kpi-main',
          h('div.bw-kpi-label', 'Media 7 días'),
          h('div.bw-kpi-value.bw-ma', fmtNum(s.ma7, 1), h('span.bw-unit', ' kg')),
          h('div.bw-kpi-sub', `${s.ma7N} ${s.ma7N === 1 ? 'pesaje' : 'pesajes'} · al ${fmtDate(s.ma7Date, 'day')}`)),
        h('div.bw-kpi',
          h('div.bw-kpi-label', 'Tendencia'),
          trendVal,
          h('div.bw-kpi-sub', trendSub))),
      h('div.bw-last.small.muted', `Último pesaje: ${fmtKg(s.last.kg)} · ${relDay(s.last.date)}`),
      h('p.bw-note', 'Se usa la media de 7 días porque el peso diario oscila por agua, sal o digestión; la tendencia se calcula sobre esa media, no sobre pesajes sueltos.'),
      whyBox(h('div',
        h('p', 'El peso de un día a otro puede variar ±1 kg por agua, sal, glucógeno o digestión, así que un valor aislado no indica tendencia.'),
        h('ul',
          h('li', 'La media de 7 días promedia los pesajes de la última semana y suaviza esas oscilaciones.'),
          h('li', `La tendencia es la pendiente (regresión lineal) de esa media en los últimos ${BW_TREND.windowDays} días, en kg por semana.`),
          h('li', `Solo se calcula con al menos ${BW_TREND.minPoints} pesajes que abarquen ${BW_TREND.minSpanDays} días o más.`)),
        !t.ok ? h('p.bw-why-na', t.reason) : null))));
  }

  function paintList() {
    const rows = bwWithDeltas(store.bodyweightList());
    listTitle.hidden = !rows.length;
    if (!rows.length) { listBox.replaceChildren(); return; }
    const list = h('div.list.bw-list', rows.slice(0, shown).map((e) => h('button.list-item.bw-row', {
      type: 'button',
      dataset: { id: e.id },
      'aria-label': `Pesaje del ${fmtDate(e.id, 'long')}: ${fmtKg(e.kg)}`,
      onClick: () => editEntry(e.id),
    },
    h('div.list-item-main',
      h('div.list-item-title', fmtDay(e.id)),
      h('div.list-item-sub', relDay(e.id))),
    h('div.bw-row-kg', fmtKg(e.kg)),
    h(`div.bw-row-delta${e.delta == null ? '.bw-row-delta-none' : ''}`, e.delta == null ? '' : fmtSigned(e.delta, 1)),
    icon('chevron-right', 20, 'chev'))));
    const more = rows.length > shown
      ? h('button.btn.btn-ghost.btn-block', { type: 'button', onClick: () => { shown += PAGE; paintList(); } }, `Ver más (${rows.length - shown})`)
      : null;
    listBox.replaceChildren(list, ...(more ? [more] : []));
  }

  // Hoja de edición: stepper + fecha (guardado inmediato) y borrar con deshacer.
  function editEntry(id) {
    let entry = store.get('bodyweight', id);
    if (!entry) return;
    const sst = stepper({
      value: entry.kg, step: 0.1, decimals: 1, min: KG_MIN, max: KG_MAX, showStep: true, suffix: 'kg', size: 'lg',
      ariaLabel: 'Peso del pesaje (kg)',
      onChange: (v, { final }) => {
        if (!validKg(v) || !entry) return;
        entry.kg = roundKg(v);
        if (final) store.save('bodyweight', entry);
        else store.saveSoon('bodyweight', entry);
      },
    });
    sst.classList.add('bw-stepper');
    const dInp = h('input.input', { type: 'date', value: entry.id, max: todayStr(), 'aria-label': 'Fecha del pesaje' });
    // Cambiar la fecha = mover el pesaje. Un cambio a la vez: si llegan varios seguidos (selector
    // de fecha girando), se aplica el último al terminar el que está en curso.
    let moving = false;
    const onDate = async () => {
      if (moving) return;
      const nd = dInp.value;
      const cur = store.get('bodyweight', entry.id);
      if (!cur || !isDateStr(nd) || nd === cur.id) return;
      if (nd > todayStr()) { dInp.value = cur.id; toast('La fecha no puede ser futura.', { kind: 'error' }); return; }
      moving = true;
      try {
        const clash = store.get('bodyweight', nd);
        if (clash) {
          const ok = await confirmDialog({
            title: 'Ya hay un pesaje ese día',
            message: `El ${fmtDate(nd, 'long')} ya tiene ${fmtKg(clash.kg)}. ¿Sustituirlo por ${fmtKg(cur.kg)}?`,
            confirmText: 'Sustituir',
            danger: true,
          });
          if (!ok) { dInp.value = entry.id; return; }
        }
        // El estado nuevo se fija ANTES de esperar al disco (así un segundo cambio parte de él).
        const next = { ...cur, id: nd };
        entry = next;
        const gone = store.remove('bodyweight', cur.id);
        await Promise.all([gone, store.save('bodyweight', next)]);
        s.el.querySelector('.sheet-title').textContent = `Pesaje del ${fmtDate(nd, 'day')}`;
      } finally {
        moving = false;
      }
      if (dInp.value !== entry.id) onDate();
    };
    dInp.addEventListener('change', onDate);
    const s = sheet({
      title: `Pesaje del ${fmtDate(entry.id, 'day')}`,
      body: h('div.stack',
        field('Fecha', dInp),
        h('div.field', h('span.field-label', 'Peso'), sst),
        h('button.btn.btn-danger-ghost.btn-block', {
          type: 'button',
          onClick: async () => {
            s.close();
            const removed = await store.remove('bodyweight', entry.id);
            if (removed) undoToast(`Pesaje del ${fmtDate(removed.id, 'day')} borrado`, () => store.restore('bodyweight', removed));
          },
        }, icon('trash', 20), 'Borrar pesaje')),
      actions: [{ label: 'Listo', kind: 'primary' }],
    });
  }

  // Se repinta resumen y lista cuando cambia el peso (guardar, editar, deshacer…), una vez por frame.
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paintStats(); paintList(); paintHint(); syncStepper(); });
  };
  const off = store.on('change', (d) => { if (d.store === 'bodyweight') schedule(); });

  paintHint();
  paintStats();
  paintList();

  return () => { off(); if (raf) cancelAnimationFrame(raf); bwChart.destroy(); };
}

// ---------------------------------------------------------------------------
// Gráfica de peso con los días de regla (modo mujer con seguimiento del ciclo)
// ---------------------------------------------------------------------------
const PERIOD_COLOR = '#d9506f'; // --cyc-menstrual (css/cycle.css)
const RETENTION_NOTE = 'Días de regla: es normal pesar algo más (retención de líquidos).';
const BLEED_NOTE = 'Días de sangrado.';

/** Franjas de los días de regla anotados (null si el seguimiento del ciclo no está activo o no hay reglas). */
function periodBands() {
  const profile = getProfile(store.settings());
  if (!cycleEnabled(profile)) return null;
  const periods = periodsFromDays(store.all('cycle'));
  if (!periods.length) return null;
  const note = isHormonal(profile) ? BLEED_NOTE : RETENTION_NOTE;
  const bands = periods.map((p) => ({ from: p.start, to: p.end, color: PERIOD_COLOR, opacity: 0.18, note }));
  bands.label = isHormonal(profile) ? 'Sangrado' : 'Regla';
  return bands;
}

/**
 * Tarjeta de la gráfica de peso de #/bodyweight. Sin ciclo, la de progreso tal cual (bodyweightChartCard). En modo
 * mujer con reglas anotadas, la misma gráfica con franjas rosas en los días de regla (para ver los picos de
 * retención de líquidos) y su leyenda; se redibuja al cambiar un pesaje o un día del ciclo.
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
function weightChartCard() {
  if (!periodBands()) return bodyweightChartCard({ key: 'bodyweight' });
  const key = 'bodyweight';
  let period = getPeriod(key);
  const slot = h('div.prg-chart');
  const sel = periodSelector({ key, value: period, ariaLabel: 'Periodo de la gráfica de peso', onChange: (id) => { period = id; paint(); } });
  const el = h('section.card.prg-card.prg-bw-chart', { dataset: { chart: 'bodyweight', cycle: '1' } },
    cardHead('Evolución', 'kg · pesajes diarios y media móvil de 7 días'),
    sel,
    slot,
    h('p.prg-howto', 'Cada punto es un pesaje; la línea verde es la media de 7 días, la que marca la tendencia. Las franjas rosas son tus días de regla: es normal que el peso suba un poco antes y al empezar la regla por retención de líquidos. Toca o arrastra para ver el valor exacto.'));
  let chart = null;
  function paint() {
    const data = { bodyweight: store.bodyweightList(), settings: store.settings(), sessions: [], today: todayStr() };
    const bands = periodBands() || [];
    const o = { ...bodyweightChartOpts(data, period), bands, bandsLegend: bands.length ? { label: bands.label, color: PERIOD_COLOR } : null };
    if (chart) chart.update(o);
    else chart = lineChart(slot, o);
  }
  paint();
  let raf = 0;
  const off = store.on('change', (d) => {
    if ((d.store !== 'bodyweight' && d.store !== 'cycle') || raf) return;
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
