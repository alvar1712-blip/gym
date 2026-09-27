// views/cycle.js — #/cycle: seguimiento del ciclo menstrual (ronda 5, docs/MEJORAS5.md §4) y tarjeta de Hoy.
// Lógica PURA en ../cycle-logic.js; aquí solo se pinta y se guarda (store 'cycle', un registro por día).
//   mountCycle(root)               → pantalla (back '#/today')
//   cycleTodayCard({ today })      → HTMLElement | null (tarjeta de Hoy; null si el seguimiento no aplica)
//   openDaySheet(date)             → hoja «Registrar día» (sangrado, síntomas, notas; guardado inmediato)
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, screen, sheet, chips, toast, undoToast, whyBox, emptyState, confirmDialog, field } from '../ui.js';
import { todayStr, addDays, diffDays, parseDate, fmtDate, fmtNum, weekStart, isDateStr, MONTH_LONG, DAY_LETTER, DAY_LONG, MONTH_SHORT } from '../util.js';
import { getProfile, cycleEnabled, isFemale, CONTRACEPTION, label as profileLabel } from '../profile.js';
import { barChart } from '../charts.js';
import {
  cycleInfo, phaseForDate, phaseStats, calendarMarks, endPeriodPlan, dayHasContent, suggestedFlow, todayTip, fmtRange,
  isBleeding, FLOWS, FLOW_RANK, SYMPTOMS, PHASES, PHASE_TIPS, HORMONAL_TIP, EVIDENCE_NOTE, LIMITS,
} from '../cycle-logic.js';

const NS = 'http://www.w3.org/2000/svg';
const PRIVACY = 'Estos datos solo se guardan en este iPhone (y en tus copias de seguridad).';
const OVULATION_NOTE = 'La ovulación es una estimación; no sirve como método anticonceptivo.';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const n1 = (v) => fmtNum(v, 1);
const daysTxt = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;

/** Datos actuales del store → CycleInfo. */
function currentInfo(today = todayStr()) {
  const profile = getProfile(store.settings());
  return { profile, info: cycleInfo(store.all('cycle'), profile, today) };
}

function sv(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Textos comunes
// ---------------------------------------------------------------------------
/** «Día 12 · fase folicular (estimada)». */
function stateLine(info) {
  const c = info.current;
  if (!c) return 'Sin reglas registradas';
  if (info.hormonal) return `Día ${c.day} desde el último sangrado`;
  if (info.ongoing) return `Día ${c.day} · regla`;
  if (!c.phase) return `Día ${c.day} · fase sin estimar`;
  return `Día ${c.day} · ${c.phaseLabel}${c.estimated ? ' (estimada)' : ''}`;
}

/** «Próxima regla ~3–5 oct» / «Retraso de 4 días» / «Regla en curso». */
function nextLine(info) {
  if (info.hormonal || !info.current) return null;
  if (info.ongoing) return `Desde ${info.ongoing.start === info.today ? 'hoy' : `el ${fmtDate(info.ongoing.start, 'day')}`} · suele durar ~${daysTxt(Math.round(info.periodLength))}`;
  const nx = info.next;
  if (!nx) return null;
  if (info.today > nx.to) return `Retraso de ${daysTxt(info.lateDays)} · se esperaba ~${fmtRange(nx.from, nx.to)}`;
  if (info.today >= nx.from) return `Próxima regla: puede venir ya (~${fmtRange(nx.from, nx.to)})`;
  return `Próxima regla ~${fmtRange(nx.from, nx.to)}`;
}

function basisLine(info) {
  if (info.hormonal) return null;
  if (!info.periods.length) return null;
  if (info.basis === 'own') {
    const n = Math.min(info.cycles.length, LIMITS.avgWindow);
    return `Estimado con tus ${n} últimos ciclos (media de ${n1(info.cycleLength)} días).`;
  }
  const n = info.cycles.length;
  return `Estimado con la duración que indicaste (${info.cycleLengthGuess} días) hasta tener ${LIMITS.minCyclesOwn} ciclos registrados${n ? ` (llevas ${n})` : ''}.`;
}

// ---------------------------------------------------------------------------
// Anillo del ciclo (SVG propio)
// ---------------------------------------------------------------------------
let ringSeq = 0;
function arcPath(c, r, a0, a1) {
  const rad = (a) => ((a - 90) * Math.PI) / 180;
  const x0 = c + r * Math.cos(rad(a0));
  const y0 = c + r * Math.sin(rad(a0));
  const x1 = c + r * Math.cos(rad(a1));
  const y1 = c + r * Math.sin(rad(a1));
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Días del ciclo actual con su fase: [{ day, phase }] (fase 'late' pasado el día previsto; 'none' sin fases). */
function ringDays(info) {
  const c = info.current;
  if (!c) return [];
  if (info.hormonal) {
    const n = Math.max(c.day, Math.round(info.avgCycle || 28));
    const byId = new Map(info.days.map((d) => [d.id, d]));
    return Array.from({ length: n }, (_, i) => ({ day: i + 1, phase: isBleeding(byId.get(addDays(c.cycleStart, i))) ? 'menstrual' : 'none' }));
  }
  const L = Math.round(info.cycleLength);
  const n = Math.max(L, c.day);
  return Array.from({ length: n }, (_, i) => {
    if (i + 1 > L) return { day: i + 1, phase: 'late' };
    return { day: i + 1, phase: phaseForDate(info, addDays(c.cycleStart, i))?.phase || 'none' };
  });
}

/**
 * Anillo: una vuelta = el ciclo actual; cada fase con su color (y rayado en la premenstrual), días ya pasados
 * más intensos, marcador en hoy. Sin datos: anillo gris.
 */
function cycleRing(info, { size = 232, stroke = 18, marker = true } = {}) {
  const id = `cyc-ring-${++ringSeq}`;
  const c = size / 2;
  const r = c - stroke / 2 - (marker ? 6 : 1);
  const svg = sv('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'cyc-ring-svg', 'aria-hidden': 'true', focusable: 'false' });
  const defs = sv('defs', {}, svg);
  const pat = sv('pattern', { id: `${id}-hatch`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  sv('rect', { width: 6, height: 6, class: 'cyc-hatch-bg' }, pat);
  sv('rect', { width: 3, height: 6, class: 'cyc-hatch-fg' }, pat);
  sv('circle', { cx: c, cy: c, r, class: 'cyc-ring-track', 'stroke-width': stroke, fill: 'none' }, svg);
  const days = ringDays(info);
  const n = days.length;
  if (!n) return svg;
  const today = info.current.day;
  // Tramos: misma fase y mismo lado de hoy (pasado / futuro).
  const segs = [];
  for (const d of days) {
    const past = d.day <= today;
    const last = segs.at(-1);
    if (last && last.phase === d.phase && last.past === past) last.to = d.day;
    else segs.push({ phase: d.phase, past, from: d.day, to: d.day });
  }
  const per = 360 / n;
  const gapDeg = Math.min(per * 0.45, (2.2 / (2 * Math.PI * r)) * 360 * 1.4);
  const g = sv('g', { class: 'cyc-ring-segs' }, svg);
  segs.forEach((s, i) => {
    const next = segs[(i + 1) % segs.length];
    const phaseBreak = segs.length > 1 && next.phase !== s.phase;
    const a0 = (s.from - 1) * per;
    const a1 = s.to * per - (phaseBreak ? gapDeg : 0);
    if (a1 <= a0) return;
    const path = sv('path', {
      d: arcPath(c, r, a0, Math.min(a1, a0 + 359.9)),
      class: `cyc-seg cyc-seg-${s.phase}${s.past ? ' is-past' : ' is-future'}`,
      'stroke-width': stroke,
      fill: 'none',
      'data-phase': s.phase,
    }, g);
    if (s.phase === 'premenstrual') path.setAttribute('stroke', `url(#${id}-hatch)`);
  });
  if (marker) {
    const a = (((Math.min(today, n) - 0.5) * per) - 90) * (Math.PI / 180);
    const mx = c + r * Math.cos(a);
    const my = c + r * Math.sin(a);
    const cur = days[Math.min(today, n) - 1]?.phase || 'none';
    sv('circle', { cx: mx.toFixed(2), cy: my.toFixed(2), r: stroke / 2 + 5, class: 'cyc-marker' }, svg);
    sv('circle', { cx: mx.toFixed(2), cy: my.toFixed(2), r: stroke / 2 - 3, class: `cyc-marker-dot cyc-fill-${cur}` }, svg);
  }
  return svg;
}

function phaseKey(id, cls = '') {
  return h(`span.cyc-key.cyc-key-${id}${cls}`, { 'aria-hidden': 'true' });
}

function ringLegend() {
  return h('div.cyc-legend', { role: 'list', 'aria-label': 'Fases' },
    PHASES.map((p) => h('span.cyc-legend-item', { role: 'listitem' }, phaseKey(p.id), p.name)));
}

// ---------------------------------------------------------------------------
// Insights («¿Por qué?» con regla, datos y fuentes)
// ---------------------------------------------------------------------------
function whyContent(ins) {
  return h('div.cyc-why',
    ins.why?.rule ? h('p.cyc-why-rule', h('b', 'Regla. '), ins.why.rule) : null,
    ins.why?.data?.length ? h('ul.cyc-why-data', ins.why.data.map((d) => h('li', h('span.cyc-why-label', d.label), h('span.cyc-why-value', d.value)))) : null,
    ins.sources?.length ? h('div.cyc-sources',
      h('p.cyc-why-head', 'Fuentes'),
      h('ul', ins.sources.map((s) => h('li', h('b', s.short), ` · ${s.detail}`)))) : null);
}

const LEVEL_ICON = { warn: 'alert', good: 'check', info: 'info', neutral: 'info' };
function insightCard(ins, { onAction = null, tag = 'div' } = {}) {
  const act = ins.action && onAction ? h('button.btn.btn-secondary.btn-sm.cyc-ins-action', { type: 'button', onClick: () => onAction(ins.action) }, ins.action.label) : null;
  return h(`${tag}.cyc-ins.cyc-ins-${ins.level || 'info'}`, { dataset: { id: ins.id } },
    h('div.cyc-ins-head', icon(LEVEL_ICON[ins.level] || 'info', 18, 'cyc-ins-icon'), h('h3.cyc-ins-title', ins.title)),
    h('p.cyc-ins-text', ins.text),
    h('div.cyc-ins-foot', whyBox(whyContent(ins)), act));
}

// ---------------------------------------------------------------------------
// Acciones: «Me ha venido hoy», «Ha terminado», hoja del día
// ---------------------------------------------------------------------------
const snap = (rec) => (rec ? { ...rec, symptoms: [...(rec.symptoms || [])] } : null);

/** «Me ha venido hoy»: crea (o pasa a sangrado moderado) el día de hoy, con deshacer. */
export async function periodStartedToday({ today = todayStr(), onDone = null } = {}) {
  const { info } = currentInfo(today);
  if (info.ongoing) return false;
  const last = info.periods.at(-1);
  if (last && info.daysSinceStart != null && info.daysSinceStart < 14 && info.daysSinceStart > 0) {
    const ok = await confirmDialog({
      title: '¿Es una regla nueva?',
      message: `Tu última regla empezó el ${fmtDate(last.start, 'day')} (hace ${daysTxt(info.daysSinceStart)}). Si es la misma, usa «Registrar día» para anotar los días que faltan.`,
      confirmText: 'Sí, es nueva',
    });
    if (!ok) return false;
  }
  const prev = store.get('cycle', today);
  const before = snap(prev);
  const rec = prev || { id: today, flow: 'medium', symptoms: [], notes: '' };
  if ((FLOW_RANK[rec.flow] ?? 0) < FLOW_RANK.light) rec.flow = 'medium';
  delete rec.ended;
  delete rec.auto;
  await store.save('cycle', rec);
  undoToast('Regla anotada: empieza hoy', async () => {
    if (before) await store.restore('cycle', before);
    else await store.remove('cycle', today);
    onDone?.();
  });
  onDone?.();
  return true;
}

/** «Ha terminado»: hoja para elegir el último día; rellena los días sin anotar y marca el final. */
export function periodEndedSheet({ today = todayStr(), onDone = null } = {}) {
  const { info } = currentInfo(today);
  const ong = info.ongoing;
  if (!ong) return null;
  const yesterday = addDays(today, -1);
  const apply = async (lastDay, close) => {
    const cur = currentInfo(today).info;
    const plan = endPeriodPlan(cur, lastDay);
    if (!plan) { toast('Elige un día entre el último anotado y hoy.', { kind: 'error' }); return; }
    close();
    await Promise.all(plan.save.map((r) => {
      const live = store.get('cycle', r.id);
      if (!live) return store.save('cycle', r);
      Object.assign(live, r);
      if (!r.ended) delete live.ended; // el final anterior (si lo había) deja de serlo
      return store.save('cycle', live);
    }));
    const len = diffDays(ong.start, lastDay) + 1;
    undoToast(`Regla terminada: ${daysTxt(len)}`, async () => {
      for (const b of plan.before) {
        if (b.missing) await store.remove('cycle', b.id);
        else await store.restore('cycle', b);
      }
      onDone?.();
    });
    onDone?.();
  };
  const other = h('input.input.cyc-end-date', { type: 'date', value: today, min: ong.lastLogged, max: today, 'aria-label': 'Último día de regla' });
  const opts = [{ date: today, label: 'Hoy' }];
  if (yesterday >= ong.lastLogged) opts.push({ date: yesterday, label: 'Ayer' });
  const s = sheet({
    title: 'Fin de la regla',
    className: 'cyc-sheet',
    body: (close) => h('div.stack',
      h('p.sheet-msg', `¿Cuál fue el último día con sangrado? Empezó el ${fmtDate(ong.start, 'day')}.`),
      h('div.cyc-end-opts', opts.map((o) => h('button.btn.btn-secondary.btn-lg', { type: 'button', dataset: { date: o.date }, onClick: () => apply(o.date, close) }, o.label, h('span.cyc-end-sub', fmtDate(o.date, 'day'))))),
      field('Otro día', h('div.cyc-end-row', other, h('button.btn.btn-primary', { type: 'button', onClick: () => apply(other.value, close) }, 'Guardar'))),
      h('p.small.muted', 'Los días sin anotar desde el inicio se rellenan como sangrado moderado; puedes cambiar cada uno tocándolo en el calendario.')),
  });
  return s;
}

/**
 * Hoja «Registrar día»: fecha, sangrado (chips), síntomas (chips), notas. Guardado inmediato; sin sangrado,
 * síntomas ni notas el día no se guarda. «Borrar este día» con deshacer.
 */
export function openDaySheet(date = todayStr(), { onChange = null } = {}) {
  const today = todayStr();
  let cur = isDateStr(date) && date <= today ? date : today;
  const wrap = h('div.cyc-day');
  const s = sheet({
    title: sheetTitle(cur, today),
    className: 'cyc-sheet',
    body: wrap,
    actions: [{ label: 'Listo', kind: 'primary' }],
  });
  const setTitle = () => { const t = s.el.querySelector('.sheet-title'); if (t) t.textContent = sheetTitle(cur, today); };

  function render() {
    const { info } = currentInfo(today);
    const stored = store.get('cycle', cur);
    // Borrador: lo que se ve es lo que se guarda al primer cambio.
    let rec = stored || { id: cur, flow: suggestedFlow(info, cur), symptoms: [], notes: '' };
    const commit = (soon = false) => {
      delete rec.auto;
      const exists = !!store.get('cycle', rec.id);
      if (!dayHasContent(rec)) {
        if (exists) store.remove('cycle', rec.id);
        delBtn.hidden = true;
        onChange?.();
        return;
      }
      if (soon) store.saveSoon('cycle', rec, 400); else store.save('cycle', rec);
      delBtn.hidden = false;
      autoNote.hidden = true;
      onChange?.();
    };
    const dateInp = h('input.input.cyc-day-date', { type: 'date', value: cur, max: today, 'aria-label': 'Fecha' });
    dateInp.addEventListener('change', () => {
      if (!isDateStr(dateInp.value) || dateInp.value > today) { dateInp.value = cur; return; }
      store.flush();
      cur = dateInp.value;
      setTitle();
      render();
    });
    const flow = chips({
      options: FLOWS.map((f) => ({ value: f.id, label: f.label, className: `cyc-flow-chip cyc-flow-${f.id}` })),
      value: rec.flow || 'none',
      className: 'cyc-flow',
      onChange: (v) => { rec.flow = v; commit(); },
    });
    const sym = chips({
      options: SYMPTOMS.map((x) => ({ value: x.id, label: x.label })),
      value: rec.symptoms || [],
      multi: true,
      className: 'cyc-sym',
      onChange: (v) => { rec.symptoms = v; commit(); },
    });
    const notes = h('textarea.input.cyc-notes', { rows: 2, placeholder: 'Opcional', 'aria-label': 'Notas', maxlength: 500 }, rec.notes || '');
    notes.addEventListener('input', () => { rec.notes = notes.value; commit(true); });
    const autoNote = h('p.small.cyc-auto-note', { hidden: !stored?.auto }, 'Día rellenado al marcar el final de la regla: cámbialo si no fue así.');
    const delBtn = h('button.btn.btn-danger-ghost.btn-block.cyc-day-del', {
      type: 'button',
      hidden: !stored,
      onClick: async () => {
        s.close();
        const removed = await store.remove('cycle', cur);
        if (removed) undoToast(`Día ${fmtDate(removed.id, 'day')} borrado`, () => { store.restore('cycle', removed); onChange?.(); });
        onChange?.();
      },
    }, icon('trash', 20), 'Borrar este día');
    wrap.replaceChildren(
      field('Fecha', dateInp),
      h('div.field', h('span.field-label', 'Sangrado'), flow,
        h('span.field-hint', 'La regla empieza con sangrado leve o más; el manchado no cuenta como regla.')),
      autoNote,
      h('div.field', h('span.field-label', 'Síntomas'), sym),
      field('Notas', notes),
      delBtn);
  }
  render();
  return s;
}

function sheetTitle(date, today) {
  if (date === today) return 'Hoy';
  if (date === addDays(today, -1)) return 'Ayer';
  const d = parseDate(date);
  return cap(`${DAY_LONG[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`);
}

// ---------------------------------------------------------------------------
// Pantalla #/cycle
// ---------------------------------------------------------------------------
export function mountCycle(root) {
  const c = screen(root, {
    title: 'Ciclo',
    back: '#/today',
    actions: [{ icon: 'sliders', label: 'Ajustes del ciclo', onClick: () => navigate('#/settings/profile') }],
  });
  c.classList.add('cyc');
  let month = null; // 'YYYY-MM-01' del calendario (se conserva al repintar)
  let charts = [];

  function render() {
    for (const ch of charts) ch.destroy();
    charts = [];
    const today = todayStr();
    const { profile, info } = currentInfo(today);
    if (!cycleEnabled(profile)) {
      c.replaceChildren(disabledState(profile));
      return;
    }
    if (!month) month = `${today.slice(0, 7)}-01`;
    const stats = phaseStats(info, {
      checkins: store.all('checkins'),
      sessions: store.all('sessions'),
      exercises: new Map(store.all('exercises').map((e) => [e.id, e])),
      bodyweight: store.bodyweightList(),
      cycleDays: info.days,
    });
    c.replaceChildren(...[
      heroCard(info),
      ...info.alerts.map((a) => insightCard(a, { tag: 'section', onAction: () => openDaySheet(today) })),
      calendarCard(info),
      historyCard(info, (ch) => charts.push(ch)),
      effectCard(info, stats),
      tipsCard(info),
      h('p.cyc-privacy', h('span', { 'aria-hidden': 'true' }, '🔒 '), PRIVACY),
    ].filter(Boolean));
  }

  function heroCard(info) {
    const today = info.today;
    const cur = info.current;
    const center = h('div.cyc-ring-center');
    if (!cur) {
      center.append(h('div.cyc-ring-big.cyc-ring-na', '—'), h('div.cyc-ring-phase', 'Sin datos'));
    } else {
      center.append(h('div.cyc-ring-kicker', info.hormonal ? 'Día' : 'Día del ciclo'), h('div.cyc-ring-big.tnum', String(cur.day)));
      if (info.hormonal) center.append(h('div.cyc-ring-phase', 'desde el último sangrado'));
      else if (info.lateDays > 0 && today > info.next.to) center.append(h('div.cyc-ring-phase', `Retraso: ${daysTxt(info.lateDays)}`));
      else if (cur.phase) {
        center.append(h('div.cyc-ring-phase', phaseKey(cur.phase), cap(cur.phase === 'menstrual' ? 'regla' : cur.phaseLabel)),
          cur.estimated ? h('div.cyc-ring-est', 'estimada') : h('div.cyc-ring-est', 'anotada'));
      }
    }
    const ring = h('div.cyc-ring', { role: 'img', 'aria-label': `${stateLine(info)}${nextLine(info) ? `. ${nextLine(info)}` : ''}` }, cycleRing(info), center);

    const kpis = [];
    if (!info.hormonal && info.next) {
      const late = today > info.next.to;
      const nx = info.next;
      const a = Math.max(1, diffDays(today, nx.from));
      const b = diffDays(today, nx.to);
      const sub = info.ongoing ? 'la siguiente' : late ? `retraso de ${daysTxt(info.lateDays)}` : today >= nx.from ? 'puede venir ya' : a === b ? `en ${daysTxt(a)}` : `en ${a}–${b} días`;
      kpis.push(kpi(late ? 'Se esperaba' : 'Próxima regla', `~${fmtRange(nx.from, nx.to)}`, sub, late ? 'warn' : ''));
    }
    if (info.ongoing) kpis.push(kpi('Regla', `Día ${info.ongoing.day}`, `desde el ${fmtDate(info.ongoing.start, 'day')}`));
    else if (!info.hormonal && cur) {
      const ov = ovulationAhead(info);
      if (ov) kpis.push(kpi('Ovulación aprox.', `~${fmtDate(ov, 'day')}`, 'estimación'));
      else kpis.push(kpi('Ciclo', `${n1(info.cycleLength)} días`, info.basis === 'own' ? 'tu media' : 'estimado'));
    }
    if (info.hormonal) {
      kpis.push(kpi('Anticonceptivo', profileLabel(CONTRACEPTION, info.contraception), 'hormonal'));
      if (info.periods.length) kpis.push(kpi('Último sangrado', fmtDate(info.periods.at(-1).start, 'day'), daysTxt(info.periods.at(-1).lengthDays)));
    }

    const primary = info.ongoing
      ? h('button.btn.btn-primary.btn-lg.cyc-main-btn', { type: 'button', dataset: { act: 'end' }, onClick: () => periodEndedSheet({ onDone: render }) }, 'Ha terminado')
      : h('button.btn.btn-primary.btn-lg.cyc-main-btn', { type: 'button', dataset: { act: 'start' }, onClick: () => periodStartedToday({ onDone: render }) }, info.hormonal ? 'Sangrado hoy' : 'Me ha venido hoy');
    const secondary = h('button.btn.btn-secondary.btn-lg.cyc-log-btn', { type: 'button', onClick: () => openDaySheet(today) }, 'Registrar día');

    const tip = todayTip(info);
    return h('section.card.cyc-hero', { dataset: { phase: cur?.phase || 'none' } },
      ring,
      info.hormonal ? h('p.cyc-hormonal-note', info.note) : ringLegend(),
      kpis.length ? h('div.cyc-kpis', kpis) : null,
      !cur ? h('p.cyc-empty-text', info.hormonal
        ? 'Registra tus sangrados y síntomas para ver tus patrones.'
        : 'Pulsa «Me ha venido hoy» el primer día de tu próxima regla, o usa «Registrar día» para anotar la última con su fecha.') : null,
      h('div.cyc-actions', primary, secondary),
      tip ? h('p.cyc-hero-tip', phaseKey(cur.phase), h('span', tip.short)) : null,
      basisLine(info) ? h('p.cyc-basis', basisLine(info)) : null);
  }

  function calendarCard(info) {
    const today = info.today;
    const first = month;
    const d = parseDate(first);
    const lastDay = addDays(`${first.slice(0, 7)}-01`, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - 1);
    const from = weekStart(first);
    const to = addDays(weekStart(lastDay), 6);
    const marks = calendarMarks(info, from, to);
    const show = (m) => {
      month = m;
      const old = c.querySelector('.cyc-cal');
      if (old) old.replaceWith(calendarCard(currentInfo().info));
    };
    const go = (delta) => {
      const nd = new Date(d.getFullYear(), d.getMonth() + delta, 1, 12);
      show(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-01`);
    };
    const cells = [];
    for (let x = from; x <= to; x = addDays(x, 1)) {
      const m = marks.get(x);
      const cls = [
        x.slice(0, 7) !== first.slice(0, 7) ? 'is-out' : '',
        x === today ? 'is-today' : '',
        x > today ? 'is-future' : '',
        m?.period ? 'm-period' : '',
        m?.period && m.flow === 'heavy' ? 'm-heavy' : '',
        m?.predicted ? 'm-predicted' : '',
        m?.ovulation ? 'm-ov' : '',
        m?.ovulationDay ? 'm-ovday' : '',
        m?.symptoms ? 'm-sym' : '',
      ].filter(Boolean).join(' ');
      const bits = [m?.period ? 'regla' : '', m?.predicted ? 'regla prevista' : '', m?.ovulation ? 'ovulación aproximada' : '', m?.symptoms ? 'síntomas' : ''].filter(Boolean);
      const aria = `${fmtDate(x, 'long')}${bits.length ? `: ${bits.join(', ')}` : ''}`;
      const inner = [h('span.cyc-cal-num.tnum', String(parseDate(x).getDate())), h('span.cyc-cal-dot', { 'aria-hidden': 'true' })];
      cells.push(x > today
        ? h('div.cyc-cal-day', { role: 'gridcell', class: cls, dataset: { date: x }, 'aria-label': aria }, inner)
        : h('button.cyc-cal-day', { type: 'button', role: 'gridcell', class: cls, dataset: { date: x }, 'aria-label': aria, onClick: () => openDaySheet(x) }, inner));
    }
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(h('div.cyc-cal-row', { role: 'row' }, cells.slice(i, i + 7)));
    const isCur = first.slice(0, 7) === today.slice(0, 7);
    return h('section.card.cyc-cal',
      h('div.cyc-cal-nav',
        h('button.icon-btn.cyc-cal-btn', { type: 'button', 'aria-label': 'Mes anterior', onClick: () => go(-1) }, icon('chevron-left', 24)),
        h('div.cyc-cal-title', cap(`${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`)),
        h('button.icon-btn.cyc-cal-btn', { type: 'button', 'aria-label': 'Mes siguiente', onClick: () => go(1) }, icon('chevron-right', 24)),
        h('button.btn.btn-sm.btn-secondary.cyc-cal-today', { type: 'button', disabled: isCur, onClick: () => show(`${today.slice(0, 7)}-01`) }, 'Hoy')),
      h('div.cyc-cal-grid', { role: 'grid', 'aria-label': 'Calendario del ciclo' },
        h('div.cyc-cal-row.cyc-cal-head', { role: 'row' }, DAY_LETTER.map((l) => h('span.cyc-cal-dow', { role: 'columnheader' }, l))),
        rows),
      h('div.cyc-cal-legend',
        h('span.cyc-cal-leg', h('span.cyc-leg-period'), 'Regla'),
        info.hormonal ? null : h('span.cyc-cal-leg', h('span.cyc-leg-predicted'), 'Prevista'),
        info.hormonal ? null : h('span.cyc-cal-leg', h('span.cyc-leg-ov'), 'Ovulación aprox.'),
        h('span.cyc-cal-leg', h('span.cyc-leg-sym'), 'Síntomas')),
      info.hormonal ? null : h('p.cyc-cal-note', icon('info', 15), OVULATION_NOTE),
      h('p.cyc-cal-hint', 'Toca un día para anotar sangrado, síntomas o notas.'));
  }

  function historyCard(info, keep) {
    const title = info.hormonal ? 'Tus sangrados' : 'Tus ciclos';
    const card = h('section.card.cyc-hist', h('div.card-head', h('h2.cyc-h2', title)));
    if (!info.periods.length) {
      card.append(h('p.muted.cyc-hist-empty', 'Aquí verás la duración de tus ciclos y de tu regla en cuanto registres la primera.'));
      return card;
    }
    const varSub = info.variation == null ? 'faltan ciclos'
      : info.cycles.length < LIMITS.minCyclesRegular ? `con ${LIMITS.minCyclesRegular} ciclos se valora`
        : info.variation <= 7 ? 'regular' : info.variation <= LIMITS.variationMax ? 'algo variable' : 'irregular';
    const nPer = info.periods.length - (info.ongoing ? 1 : 0);
    card.append(h('div.cyc-hist-kpis',
      kpi(info.hormonal ? 'Intervalo' : 'Ciclo medio', info.avgCycle != null ? `${n1(info.avgCycle)} d` : '—', info.cycles.length ? `${info.cycles.length} ${info.cycles.length === 1 ? 'ciclo' : 'ciclos'}` : 'sin completar'),
      kpi('Variación', info.variation != null ? `${info.variation} d` : '—', varSub),
      kpi(info.hormonal ? 'Sangrado' : 'Regla media', info.avgPeriod != null ? `${n1(info.avgPeriod)} d` : '—', nPer > 0 ? `${nPer} ${nPer === 1 ? (info.hormonal ? 'sangrado' : 'regla') : (info.hormonal ? 'sangrados' : 'reglas')}` : 'en curso')));
    if (info.cycles.length >= 2) {
      const slot = h('div.cyc-hist-chart');
      card.append(slot);
      const ch = barChart(slot, {
        bars: info.cycles.slice(-12).map((cy) => ({ x: cy.start, label: `Ciclo del ${fmtDate(cy.start, 'day')}`, segments: [{ key: 'len', value: cy.lengthDays, color: '#d9506f', label: `${cy.lengthDays} días`, name: `regla ${daysTxt(cy.periodDays)}` }] })),
        height: 170,
        band: info.hormonal ? null : { min: LIMITS.normalMin, max: LIMITS.normalMax, label: 'Habitual 24–38', color: '#8b94a5' },
        yFormat: (v) => `${fmtNum(v, 0)} días`,
        yTickFormat: (v) => fmtNum(v, 0),
        xFormat: (x) => fmtDate(x, 'day'),
        xLabel: (x, b) => b.label,
        ariaLabel: 'Duración de tus últimos ciclos, en días',
      });
      keep(ch);
      card.append(h('p.cyc-chart-note', info.hormonal ? 'Días entre el inicio de un sangrado y el siguiente.' : 'Duración de cada ciclo (del primer día de regla al día antes de la siguiente). La franja gris es el rango habitual (24–38 días, FIGO).'));
    }
    const rows = [];
    const last = info.periods.at(-1);
    if (info.current) {
      rows.push(h('button.list-item.cyc-cycle-row.is-current', { type: 'button', onClick: () => jumpTo(last.start) },
        h('span.cyc-cycle-bar', { style: { '--w': `${Math.min(100, (info.current.day / Math.max(info.cycleLength, info.current.day)) * 100)}%` } }),
        h('span.list-item-main',
          h('span.list-item-title', info.hormonal ? `Desde el ${fmtDate(last.start, 'day')}` : 'Ciclo actual'),
          h('span.list-item-sub', `${info.hormonal ? '' : `Desde el ${fmtDate(last.start, 'day')} · `}día ${info.current.day} · ${info.hormonal ? 'sangrado' : 'regla'} ${daysTxt(last.lengthDays)}${info.ongoing ? ' (en curso)' : ''}`)),
        icon('chevron-right', 20, 'chev')));
    }
    for (const cy of [...info.cycles].reverse().slice(0, 12)) {
      const out = cy.lengthDays < LIMITS.normalMin || cy.lengthDays > LIMITS.normalMax;
      rows.push(h('button.list-item.cyc-cycle-row', { type: 'button', dataset: { start: cy.start }, onClick: () => jumpTo(cy.start) },
        h('span.list-item-main',
          h('span.list-item-title', `${fmtDate(cy.start, 'day')} – ${fmtDate(cy.end, 'day')}${parseDate(cy.start).getFullYear() !== parseDate(info.today).getFullYear() ? ` ${parseDate(cy.start).getFullYear()}` : ''}`),
          h('span.list-item-sub', `${info.hormonal ? 'sangrado' : 'regla'} ${daysTxt(cy.periodDays)}`)),
        h(`span.cyc-cycle-len.tnum${out && !info.hormonal ? '.is-out' : ''}`, `${cy.lengthDays} días`),
        icon('chevron-right', 20, 'chev')));
    }
    card.append(h('div.list.cyc-cycles', rows));
    return card;
  }

  function jumpTo(date) {
    month = `${date.slice(0, 7)}-01`;
    const old = c.querySelector('.cyc-cal');
    if (old) {
      const fresh = calendarCard(currentInfo().info);
      old.replaceWith(fresh);
      fresh.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  function effectCard(info, stats) {
    const card = h('section.card.cyc-effect', h('div.card-head', h('h2.cyc-h2', 'Cómo te afecta')));
    if (info.hormonal) {
      card.append(h('p.cyc-effect-intro', 'Con anticonceptivo hormonal no hay fases naturales que comparar. Tus síntomas anotados siguen apareciendo en el calendario.'),
        insightCard(HORMONAL_TIP));
      return card;
    }
    if (!stats.ok) {
      card.append(
        h('div.cyc-effect-wait',
          h('div.cyc-effect-progress', { role: 'img', 'aria-label': `${stats.cycles} de ${LIMITS.statsCycles} ciclos` },
            Array.from({ length: LIMITS.statsCycles }, (_, i) => h(`span${i < stats.cycles ? '.is-done' : ''}`))),
          h('p.cyc-effect-reason', stats.reason)),
        h('p.cyc-effect-intro', 'Cruzará tus datos con cada fase: energía y sueño del check-in, esfuerzo (RPE), tu fuerza frente a tu nivel de esas semanas, tu peso frente a tu tendencia y los síntomas que anotes. Así verás cómo te afecta a ti, no a la media.'));
    } else {
      card.append(h('p.cyc-effect-intro', `Tus medias por fase (estimada) en tus ${stats.cycles} ciclos completos y el actual. «—» = pocos datos.`), effectTable(stats));
      const sym = stats.phases.filter((p) => p.symptoms.length);
      if (sym.length) {
        card.append(h('div.cyc-sym-list', h('p.cyc-sub-head', 'Síntomas frecuentes (días anotados)'),
          h('ul', sym.map((p) => h('li', phaseKey(p.id), h('b', `${p.name}: `), p.symptoms.map((s) => `${s.label.toLowerCase()} (${Math.round((s.share || 0) * 100)} %)`).join(', '))))));
      }
      card.append(h('div.cyc-ins-list', stats.insights.map((i) => insightCard(i))));
    }
    card.append(insightCard(EVIDENCE_NOTE));
    return card;
  }

  function effectTable(stats) {
    const MIN = 2;
    const signed = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${fmtNum(Math.abs(r), 1, 1)}`; };
    const pct = (v) => `${signed(v)} %`;
    const kg = signed;
    const lvl = (v) => fmtNum(v, 1, 1);
    const COLS = [
      { key: 'energy', th: 'Energía', get: (p) => [p.energy.mean, p.energy.n], fmt: lvl },
      { key: 'sleep', th: 'Sueño', get: (p) => [p.sleep.mean, p.sleep.n], fmt: lvl },
      { key: 'rpe', th: 'RPE', get: (p) => [p.rpe.mean, p.rpe.n], fmt: lvl },
      { key: 'strength', th: 'Fuerza', get: (p) => [p.strength.pct, p.strength.n], fmt: pct },
      { key: 'weight', th: 'Peso kg', get: (p) => [p.weight.kg, p.weight.n], fmt: kg },
    ].filter((col) => stats.phases.some((p) => { const [v, n] = col.get(p); return v != null && n >= MIN; }));
    if (!COLS.length) {
      return h('p.cyc-effect-nodata', 'Aún no hay check-ins, sesiones con esfuerzo (RPE) ni pesajes en las fechas de tus ciclos. En cuanto los registres, aquí verás tus medias por fase.');
    }
    const cols = { gridTemplateColumns: `repeat(${COLS.length}, minmax(0, 1fr))` };
    const cell = (col, p) => {
      const [v, n] = col.get(p);
      const ok = v != null && n >= MIN;
      return h('span.cyc-eff-val.tnum', { class: ok ? '' : 'is-na', dataset: { col: col.key } }, ok ? col.fmt(v) : '—');
    };
    const notes = [];
    if (COLS.some((x) => x.key === 'energy' || x.key === 'sleep')) notes.push('Energía y sueño: media de tus check-ins (1 bajo · 3 alto).');
    if (COLS.some((x) => x.key === 'rpe')) notes.push('RPE: esfuerzo medio de tus sesiones (1–10).');
    if (COLS.some((x) => x.key === 'strength')) notes.push('Fuerza: frente a tu nivel de esas semanas.');
    if (COLS.some((x) => x.key === 'weight')) notes.push('Peso: frente a tu tendencia.');
    return h('div.cyc-eff', { role: 'table', 'aria-label': 'Medias por fase' },
      h('div.cyc-eff-row.cyc-eff-head', { role: 'row', style: cols }, COLS.map((col) => h('span.cyc-eff-th', { role: 'columnheader' }, col.th))),
      stats.phases.map((p) => h('div.cyc-eff-phase', { role: 'rowgroup', dataset: { phase: p.id } },
        h('div.cyc-eff-name', { role: 'rowheader' }, phaseKey(p.id), p.name),
        h('div.cyc-eff-row', { role: 'row', style: cols }, COLS.map((col) => cell(col, p))))),
      h('p.cyc-eff-foot', notes.join(' ')));
  }

  function tipsCard(info) {
    if (info.hormonal) return null;
    const curPhase = info.current?.phase;
    const order = PHASES.map((p) => p.id);
    return h('section.card.cyc-tips',
      h('div.card-head', h('h2.cyc-h2', 'Consejos por fase')),
      h('p.cyc-effect-intro', 'Prácticos y con evidencia. Ninguno es obligatorio: si te encuentras bien, entrena con normalidad.'),
      h('div.cyc-tip-list', order.map((id) => h('details.cyc-tip-group', { dataset: { phase: id }, open: id === curPhase ? true : null },
        h('summary.cyc-tip-phase', phaseKey(id), h('span.cyc-tip-phase-name', PHASES.find((p) => p.id === id).name),
          id === curPhase ? h('span.badge.badge-accent', 'Ahora') : null, icon('chevron-down', 18, 'cyc-tip-chev')),
        (PHASE_TIPS[id] || []).map((t) => h('div.cyc-tip-item',
          h('h3.cyc-tip-title', t.title),
          h('p.cyc-tip-text', t.text),
          whyBox(whyContent(t))))))));
  }

  render();
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  // Las notas se guardan con saveSoon (e.soon) y no cambian nada de la pantalla: no se repinta al teclear.
  const off = store.on('change', (e) => { if ((e.store === 'cycle' && !e.soon) || (e.store === 'meta' && e.id === 'settings')) schedule(); });
  const offReset = store.on('reset', schedule);
  return () => { off(); offReset(); if (raf) cancelAnimationFrame(raf); for (const ch of charts) ch.destroy(); charts = []; };
}

function kpi(label, value, sub = '', tone = '') {
  const long = String(value).length > 12; // texto (p. ej. el anticonceptivo): más pequeño y en dos líneas si hace falta
  return h(`div.cyc-kpi${tone ? `.is-${tone}` : ''}`, h('div.cyc-kpi-label', label), h(`div.cyc-kpi-value.tnum${long ? '.is-long' : ''}`, value), sub ? h('div.cyc-kpi-sub', sub) : null);
}

/** Próxima ovulación estimada del ciclo actual (si aún no ha pasado). */
function ovulationAhead(info) {
  const c = info.current;
  if (!c || info.hormonal || info.lateDays > 0) return null;
  const L = Math.round(info.cycleLength);
  const day = L - 14;
  if (c.day > day + LIMITS.ovulationSpread) return null;
  return addDays(c.cycleStart, day - 1);
}

function disabledState(profile) {
  const female = isFemale(profile);
  return h('div.cyc-disabled', emptyState({
    emoji: '🌙',
    title: female ? 'Seguimiento del ciclo desactivado' : 'Seguimiento del ciclo',
    text: female
      ? 'Tienes el seguimiento del ciclo desactivado. Actívalo en tu perfil para registrar tu regla y ver en qué fase estás, cómo te afecta y cuándo esperar la próxima.'
      : 'El seguimiento del ciclo menstrual está disponible en modo mujer. Si quien usa la app es una mujer, indícalo en el perfil y se activará.',
    action: { label: 'Ir al perfil', onClick: () => navigate('#/settings/profile') },
  }), h('p.cyc-privacy', h('span', { 'aria-hidden': 'true' }, '🔒 '), PRIVACY));
}

// ---------------------------------------------------------------------------
// Tarjeta de Hoy
// ---------------------------------------------------------------------------
/**
 * Tarjeta del ciclo para Hoy: «Día 12 · fase folicular (estimada)», próxima regla, consejo breve si aporta,
 * botón rápido («Me ha venido hoy» / «Ha terminado» / «Registrar síntomas») y enlace a #/cycle.
 * @param {{ today?: string }} opts
 * @returns {HTMLElement|null} null si no está en modo mujer o el seguimiento está desactivado.
 */
export function cycleTodayCard({ today = todayStr() } = {}) {
  const profile = getProfile(store.settings());
  if (!cycleEnabled(profile)) return null;
  const info = cycleInfo(store.all('cycle'), profile, today);
  const card = h('section.card.cyc-today', { dataset: { phase: info.current?.phase || 'none' } });
  const repaint = () => { if (card.isConnected) card.replaceWith(cycleTodayCard({ today })); };
  const cur = info.current;
  const next = nextLine(info);
  const tip = todayTip(info);

  let quick;
  if (info.ongoing) quick = { label: 'Ha terminado', act: 'end', icon: 'check', onClick: () => periodEndedSheet({ today, onDone: repaint }) };
  else if (!info.hormonal && (!cur || (info.next && today >= addDays(info.next.from, -2)))) quick = { label: 'Me ha venido hoy', act: 'start', icon: 'plus', onClick: () => periodStartedToday({ today, onDone: repaint }) };
  else quick = { label: 'Registrar síntomas', act: 'log', icon: 'edit', onClick: () => openDaySheet(today, { onChange: repaint }) };

  const mini = h('span.cyc-today-ring', cycleRing(info, { size: 60, stroke: 7, marker: false }), h('span.cyc-today-day.tnum', cur ? String(cur.day) : '—'));
  card.append(
    h('button.cyc-today-main', { type: 'button', 'aria-label': `Ciclo: ${stateLine(info)}${next ? `. ${next}` : ''}. Ver ciclo`, onClick: () => navigate('#/cycle') },
      mini,
      h('span.cyc-today-texts',
        h('span.cyc-today-kicker', 'Ciclo'),
        h('span.cyc-today-title', cur ? stateLine(info) : 'Registra tu regla'),
        h('span.cyc-today-sub', next || (cur ? (info.hormonal ? 'Sin fases naturales (anticonceptivo hormonal)' : '') : 'Para ver tu fase y cuándo esperar la próxima'))),
      icon('chevron-right', 20, 'chev')),
    tip ? h('p.cyc-today-tip', tip.short) : null,
    h('div.cyc-today-actions',
      h('button.btn.btn-secondary.cyc-today-quick', { type: 'button', dataset: { act: quick.act }, onClick: quick.onClick }, icon(quick.icon, 18), quick.label),
      h('button.cal-link-btn.cyc-today-link', { type: 'button', onClick: () => navigate('#/cycle') }, 'Ver ciclo', icon('chevron-right', 18))));
  return card;
}
