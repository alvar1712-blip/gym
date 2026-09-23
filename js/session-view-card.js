// session-view-card.js — tarjeta de un ejercicio de la sesión de fuerza y editor de series.
// PROPIETARIO: módulo de sesión. La vista (views/session.js) crea el contexto `ctx` y monta las tarjetas.
// Cada tarjeta se vuelve a pintar sola (ctx.rerenderCard) al confirmar/editar series: nunca toda la vista.
import { h, icon, stepper, chips, segmented, toast, undoToast, confirmDialog, haptic } from './ui.js';
import { fmtDate, fmtNum, fmtKm, fmtDuration, fmtPace, fmtSpeed, uniq } from './util.js';
import { pace, speed, pace100, sessionDurationMin } from './calc.js';
import { ACTIVITY_EMOJI } from './seed.js';
import { navigate } from './router.js';
import {
  LOAD_REP_TYPES, formatSet, targetText, prMessage, inheritWeight, validateSet,
  extraSet, warmupSet, switchExercise,
} from './session-logic.js';

const TYPE_OPTS = [
  { value: 'warmup', label: 'Calent.' },
  { value: 'effective', label: 'Efectiva' },
  { value: 'failure', label: 'Al fallo' },
  { value: 'drop', label: 'Drop' },
];
const TYPE_BADGE = { warmup: 'Calent.', failure: 'Fallo', drop: 'Drop' };
const RIR_OPTS = [{ value: 'F', label: 'Fallo' }, ...[0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))];
const SPORT_BTN = {
  run: ['Registrar carrera', 'Añadir otra carrera'],
  bike: ['Registrar bici', 'Añadir otra salida en bici'],
  swim: ['Registrar natación', 'Añadir otra sesión de natación'],
};

/**
 * Tarjeta de un ejercicio de sesión.
 * @param {object} ctx  contexto de la vista (ver views/session.js)
 * @param {object} se   SessionExercise
 */
export function renderCard(ctx, se) {
  const ex = ctx.exercise(se.exerciseId);
  const logType = ex?.logType || 'weight_reps';
  const label = ctx.labels.get(se.id) || null;
  const name = ex?.name || se.exName || 'Ejercicio';
  const allDone = se.sets.length > 0 && se.sets.every((s) => s.done);

  const card = h(`section.card.ses-card${allDone ? '.ses-card-done' : ''}`, { dataset: { se: se.id } });
  card.appendChild(h('div.ses-card-head',
    label ? h('span.ses-label', label) : null,
    h('h3.ses-name', name),
    allDone ? h('span.ses-done-mark', { 'aria-label': 'Completado' }, icon('check', 18)) : null,
    h('button.icon-btn.ses-more', { type: 'button', 'aria-label': `Opciones de ${name}`, onClick: () => ctx.exerciseMenu(se) }, icon('more', 22))));

  // Alternativas: «⇄ Prensa · Hack»
  const base = se.baseExerciseId || se.exerciseId;
  const opts = uniq([base, ...(se.alternatives || []), se.exerciseId]).filter((id) => ctx.exercise(id));
  if (opts.length > 1) {
    const altChips = chips({
      options: opts.map((id) => ({ value: id, label: ctx.exercise(id).name })),
      value: se.exerciseId,
      className: 'ses-alt-chips',
      onChange: (v) => chooseAlternative(ctx, se, v, altChips),
    });
    card.appendChild(h('div.ses-alts', h('span.ses-alts-icon', { 'aria-hidden': 'true' }, '⇄'), altChips));
  }

  const tgt = targetText(se.target, logType);
  if (tgt || se.notes) {
    card.appendChild(h('div.ses-target',
      tgt ? h('span.ses-target-txt', `Objetivo ${tgt}`) : null,
      se.notes ? h('span.ses-tnote', se.notes) : null));
  }
  if (se.note) card.appendChild(h('div.ses-enote', h('span', { 'aria-hidden': 'true' }, '📝 '), se.note));

  if (logType === 'cardio') {
    renderCardio(ctx, se, ex, card);
    return card;
  }

  // Última vez
  const last = ctx.lastFor(se.exerciseId);
  if (last) {
    const parts = [];
    last.sets.forEach((s, i) => {
      if (i) parts.push(' · ');
      parts.push(h(s.type === 'warmup' ? 'span.ses-warm' : 'span', (s.type === 'warmup' ? 'C ' : '') + formatSet(s, logType)));
    });
    card.appendChild(h('div.ses-last',
      h('span.ses-last-label', `Última vez (${fmtDate(last.session.date, 'day')}): `),
      h('span.ses-last-sets.tnum', parts)));
  } else {
    card.appendChild(h('div.ses-last.ses-last-none', 'Primera vez con este ejercicio'));
  }

  // Series
  const prs = ctx.prsFor(se.exerciseId);
  const editId = currentEditId(ctx, se);
  const list = h('div.ses-sets');
  let workN = 0;
  se.sets.forEach((set) => {
    const num = set.type === 'warmup' ? 'C' : String(++workN);
    if (set.id === editId) list.appendChild(renderEditor(ctx, se, set, ex, logType, num));
    else list.appendChild(renderRow(ctx, se, set, logType, num, prs.get(set.id)));
  });
  if (list.childNodes.length) card.appendChild(list);

  const hasPending = se.sets.some((s) => !s.done);
  const btnCls = hasPending ? 'btn.btn-ghost.btn-sm' : 'btn.btn-secondary';
  card.appendChild(h('div.btn-row.ses-card-actions',
    h(`button.${btnCls}.ses-add-set`, { type: 'button', onClick: () => addSet(ctx, se, logType) }, icon('plus', 18), 'Serie'),
    h(`button.${btnCls}.ses-add-warm`, { type: 'button', onClick: () => addWarmup(ctx, se, logType) }, icon('plus', 18), 'Calentamiento')));
  return card;
}

/** Serie que se muestra en el editor grande: la elegida por el usuario o la primera pendiente. */
function currentEditId(ctx, se) {
  const chosen = ctx.editing.get(se.id);
  if (chosen && se.sets.some((s) => s.id === chosen)) return chosen;
  ctx.editing.delete(se.id);
  return se.sets.find((s) => !s.done)?.id || null;
}

// ---------------------------------------------------------------------------
// Filas compactas
// ---------------------------------------------------------------------------
function renderRow(ctx, se, set, logType, num, prs) {
  const pending = !set.done;
  const rirPart = LOAD_REP_TYPES.includes(logType) && set.rir != null ? (set.rir === 'F' ? '@F' : `@${set.rir}`) : '';
  return h(`button.ses-row${pending ? '.ses-row-pending' : ''}${set.type === 'warmup' ? '.ses-row-warm' : ''}`, {
    type: 'button',
    dataset: { set: set.id, state: pending ? 'pending' : 'done' },
    'aria-label': `${pending ? 'Serie pendiente' : 'Serie'} ${num}: ${formatSet(set, logType, { kg: true })}. Tocar para editar`,
    onClick: () => { ctx.editing.set(se.id, set.id); ctx.touch(se); ctx.rerenderCard(se); },
  },
  h('span.ses-row-num', num),
  h('span.ses-row-main',
    h('span.ses-row-val.tnum', formatSet(set, logType, { kg: true, rir: false })),
    set.note ? h('span.ses-row-note', set.note) : null),
  TYPE_BADGE[set.type] && set.type !== 'warmup' ? h('span.badge.ses-row-type', TYPE_BADGE[set.type]) : null,
  rirPart ? h('span.ses-row-rir.tnum', rirPart) : null,
  prs ? h('span.badge.badge-pr.ses-row-pr', { title: 'Récord' }, '🏆') : null,
  pending ? null : h('span.ses-row-check', icon('check', 16)));
}

// ---------------------------------------------------------------------------
// Editor grande
// ---------------------------------------------------------------------------
function renderEditor(ctx, se, set, ex, logType, num) {
  const pending = !set.done;
  // Peso prellenado al abrir el editor (para la herencia de peso al confirmar).
  if (pending && !ctx.origWeights.has(set.id)) ctx.origWeights.set(set.id, set.weight ?? null);

  const changed = () => { ctx.touch(se); ctx.saveSoon(); };
  const bind = (key) => (v) => { set[key] = v; changed(); };
  const fields = [];
  const field = (lbl, ctl, extra = null) => h('div.ses-field', h('span.ses-field-label', lbl), h('div.ses-field-ctl', ctl, extra));
  const weightStep = (lbl, opts = {}) => stepper({
    value: set.weight, step: 2.5, decimals: 2, inputmode: 'decimal', suffix: 'kg', showStep: true, min: 0, max: 999,
    ariaLabel: lbl, onChange: bind('weight'), ...opts,
  });
  const repsStep = (key, lbl) => stepper({
    value: set[key], step: 1, decimals: 0, inputmode: 'numeric', min: 0, max: 999, ariaLabel: lbl, onChange: bind(key),
  });

  switch (logType) {
    case 'bodyweight': {
      const hint = h('div.ses-hint');
      const paint = (w) => { hint.textContent = w > 0 ? `Lastre de ${fmtNum(w, 2)} kg` : w < 0 ? `Asistencia de ${fmtNum(-w, 2)} kg` : 'Peso corporal (negativo = asistencia)'; };
      paint(set.weight);
      fields.push(field('Lastre', weightStep('Lastre', {
        min: -300, onChange: (v) => { set.weight = v; paint(v); changed(); },
      }), hint));
      fields.push(field('Reps', repsStep('reps', 'Repeticiones')));
      break;
    }
    case 'unilateral':
      fields.push(field('Peso', weightStep('Peso')));
      fields.push(field('Reps izq.', repsStep('reps', 'Repeticiones lado izquierdo')));
      fields.push(field('Reps der.', repsStep('repsR', 'Repeticiones lado derecho')));
      break;
    case 'time':
      fields.push(field('Tiempo', stepper({ value: set.timeSec, step: 5, decimals: 0, inputmode: 'numeric', suffix: 's', min: 0, max: 36000, showStep: true, ariaLabel: 'Segundos', onChange: bind('timeSec') })));
      fields.push(field('Lastre', weightStep('Lastre (opcional)', { size: 'md', placeholder: 'opcional' })));
      break;
    case 'distance_time':
      fields.push(field('Metros', stepper({ value: set.distanceM, step: 5, decimals: 1, inputmode: 'decimal', suffix: 'm', min: 0, max: 100000, showStep: true, ariaLabel: 'Metros', onChange: bind('distanceM') })));
      fields.push(field('Tiempo', stepper({ value: set.timeSec, step: 0.1, decimals: 2, inputmode: 'decimal', suffix: 's', min: 0, max: 36000, showStep: true, ariaLabel: 'Segundos', onChange: bind('timeSec') })));
      break;
    case 'jumps':
      fields.push(field('Reps', repsStep('reps', 'Repeticiones')));
      fields.push(field('Altura', stepper({ value: set.heightCm, step: 1, decimals: 1, inputmode: 'decimal', suffix: 'cm', min: 0, max: 200, size: 'md', placeholder: 'opcional', ariaLabel: 'Altura en cm (opcional)', onChange: bind('heightCm') })));
      break;
    default:
      fields.push(field('Peso', weightStep('Peso')));
      fields.push(field('Reps', repsStep('reps', 'Repeticiones')));
  }

  // RIR (solo tipos con carga y repeticiones)
  let rirChips = null;
  if (LOAD_REP_TYPES.includes(logType)) {
    rirChips = chips({ options: RIR_OPTS, value: set.rir ?? null, allowNone: true, className: 'ses-rir', onChange: (v) => { set.rir = v; changed(); } });
    fields.push(h('div.ses-sub', h('span.ses-sub-label', 'RIR · repeticiones en reserva'), rirChips));
  }

  const submit = h('button.btn.btn-primary.btn-lg.btn-block.ses-register', { type: 'button' });
  const headNum = h('span.ses-editor-num');
  const paintSubmit = () => {
    headNum.textContent = num === 'C' ? 'Calentamiento' : `Serie ${num}`;
    submit.replaceChildren(icon('check', 22), pending ? (set.type === 'warmup' ? 'Registrar calentamiento' : `Registrar serie ${num}`) : 'Listo');
  };
  paintSubmit();

  const typeSeg = segmented({
    options: TYPE_OPTS,
    value: set.type,
    ariaLabel: 'Tipo de serie',
    onChange: (v) => {
      set.type = v;
      if (v === 'failure') { set.rir = 'F'; rirChips?.setValue('F'); }
      if (v === 'warmup') { set.rir = null; rirChips?.setValue(null); }
      num = v === 'warmup' ? 'C' : String(se.sets.filter((s) => s.type !== 'warmup').indexOf(set) + 1);
      paintSubmit();
      changed();
    },
  });
  typeSeg.classList.add('ses-type');

  // Nota opcional de la serie
  const noteInp = h('input.input.ses-note-input', { type: 'text', value: set.note || '', placeholder: 'Nota de la serie', maxlength: 200, 'aria-label': 'Nota de la serie', hidden: !set.note });
  noteInp.addEventListener('input', () => { set.note = noteInp.value; changed(); });
  const noteBtn = h('button.btn.btn-ghost.btn-sm.ses-note-btn', {
    type: 'button',
    onClick: () => { noteInp.hidden = false; noteInp.focus(); noteBtn.hidden = true; },
    hidden: !!set.note,
  }, icon('note', 18), 'Nota');
  const delBtn = h('button.btn.btn-danger-ghost.btn-sm.ses-del-set', {
    type: 'button',
    onClick: () => deleteSet(ctx, se, set, pending ? 'Serie quitada' : 'Serie borrada'),
  }, icon('trash', 18), pending ? 'Quitar' : 'Borrar');

  submit.addEventListener('click', () => {
    // Un doble toque accidental no debe registrar también la serie siguiente.
    if (performance.now() < (ctx.guardUntil.get(se.id) || 0)) return;
    if (pending) registerSet(ctx, se, set, ex, logType);
    else closeEditor(ctx, se);
  });

  return h(`div.ses-editor${pending ? '' : '.ses-editor-edit'}`, { dataset: { set: set.id, state: pending ? 'editing' : 'editing-done' } },
    h('div.ses-editor-head',
      headNum,
      pending ? null : h('span.badge.badge-ok', 'Hecha · editando')),
    fields,
    typeSeg,
    noteInp,
    submit,
    h('div.ses-editor-links', noteBtn, h('span.grow'), delBtn));
}

/** Confirma una serie pendiente (1 toque con los valores prellenados). */
function registerSet(ctx, se, set, ex, logType) {
  const err = validateSet(set, logType);
  if (err) { toast(err, { kind: 'error' }); return; }
  const i = se.sets.indexOf(set);
  set.done = true;
  set.doneAt = Date.now();
  if (set.type === 'failure' && set.rir == null) set.rir = 'F';
  if (ctx.origWeights.has(set.id)) {
    inheritWeight(se.sets, i, ctx.origWeights.get(set.id), set.weight ?? null);
    ctx.origWeights.delete(set.id);
  }
  ctx.editing.delete(se.id);
  ctx.guardUntil.set(se.id, performance.now() + 300);
  ctx.touch(se);
  ctx.save();
  haptic(15);
  const prs = set.type !== 'warmup' ? ctx.prsFor(se.exerciseId).get(set.id) : null;
  if (prs) toast(prMessage(prs, ex), { kind: 'pr', duration: 5000 });
  ctx.rerenderCard(se);
  if (!se.sets.some((s) => !s.done)) ctx.scrollToNext(se);
}

function closeEditor(ctx, se) {
  ctx.editing.delete(se.id);
  ctx.save();
  ctx.rerenderCard(se);
}

function deleteSet(ctx, se, set, msg) {
  const i = se.sets.indexOf(set);
  if (i < 0) return;
  se.sets.splice(i, 1);
  ctx.editing.delete(se.id);
  ctx.origWeights.delete(set.id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
  undoToast(msg, () => {
    se.sets.splice(Math.min(i, se.sets.length), 0, set);
    ctx.save();
    ctx.rerenderCard(se);
  });
}

function addSet(ctx, se, logType) {
  const set = extraSet(se, ctx.lastFor(se.exerciseId), logType);
  se.sets.push(set);
  if (!se.sets.some((s) => !s.done && s !== set)) ctx.editing.set(se.id, set.id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
}

function addWarmup(ctx, se, logType) {
  const { set, index } = warmupSet(se, ctx.lastFor(se.exerciseId), logType);
  se.sets.splice(index, 0, set);
  ctx.editing.set(se.id, set.id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
}

/** Elegir otra alternativa del ítem (si ya hay series hechas, se pide confirmación). */
async function chooseAlternative(ctx, se, id, altChips) {
  if (!id || id === se.exerciseId) { altChips.setValue(se.exerciseId); return; }
  const done = se.sets.filter((s) => s.done).length;
  const from = ctx.exercise(se.exerciseId)?.name || se.exName;
  const to = ctx.exercise(id)?.name || id;
  if (done) {
    const ok = await confirmDialog({
      title: `¿Cambiar a «${to}»?`,
      message: `Ya has registrado ${done === 1 ? '1 serie' : `${done} series`} de «${from}». Si cambias, pasarán a contar como «${to}».\n\nSi has hecho los dos ejercicios, deja este como está y añade «${to}» con «+ Añadir ejercicio».`,
      confirmText: `Cambiar a ${to}`,
    });
    if (!ok) { altChips.setValue(se.exerciseId); return; }
  }
  switchExercise(se, id, ctx.session);
  ctx.editing.delete(se.id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
}

// ---------------------------------------------------------------------------
// Ítems de cardio: se registran como actividad enlazada
// ---------------------------------------------------------------------------
function renderCardio(ctx, se, ex, card) {
  const sport = ex?.sport || 'run';
  const acts = ctx.linked(se.id);
  if (acts.length) {
    card.appendChild(h('div.ses-acts', acts.map((a) => {
      const km = a.distanceKm;
      const sec = a.movingSec ?? (sessionDurationMin(a) != null ? sessionDurationMin(a) * 60 : null);
      let rate = '';
      if (a.kind === 'run') rate = fmtPace(pace(sec, km));
      else if (a.kind === 'bike') rate = fmtSpeed(speed(sec, km));
      else if (a.kind === 'swim') rate = fmtPace(pace100(sec, km), '/100 m');
      const parts = [km ? fmtKm(km) : null, sec ? fmtDuration(sec) : null, rate && rate !== '—' ? rate : null].filter(Boolean);
      return h('button.ses-act', { type: 'button', dataset: { activity: a.id }, onClick: () => navigate(`#/activity/${a.id}`) },
        h('span.ses-act-emoji', { 'aria-hidden': 'true' }, ACTIVITY_EMOJI[a.kind] || '⚡'),
        h('span.ses-act-main.tnum', parts.join(' · ') || 'Actividad registrada'),
        h('span.ses-act-edit', 'Editar', icon('chevron-right', 18)));
    })));
  }
  const [firstTxt, againTxt] = SPORT_BTN[sport] || ['Registrar actividad', 'Añadir otra actividad'];
  card.appendChild(h(`button.btn.btn-lg.btn-block.ses-cardio-btn${acts.length ? '.btn-secondary' : '.btn-primary'}`, {
    type: 'button',
    onClick: () => {
      ctx.touch(se);
      ctx.save();
      const q = new URLSearchParams({ kind: sport, date: ctx.session.date, parent: ctx.session.id, item: se.id });
      navigate(`#/activity/new?${q.toString()}`);
    },
  }, h('span', { 'aria-hidden': 'true' }, ACTIVITY_EMOJI[sport] || '⚡'), acts.length ? againTxt : firstTxt));
}
