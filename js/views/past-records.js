// past-records.js — marcas históricas (ronda 6, fase B; docs/MEJORAS6.md): tus mejores marcas de antes de usar Entreno
// (o hechas fuera de la app), separadas de los récords que Entreno calcula con lo registrado.
//   #/records/past        lista por ejercicio, con «Rendimiento actual ≈ N % de tu mejor marca histórica»
//   #/records/past/new    nueva (?exercise=id para elegir ya el ejercicio)
//   #/records/past/:id    editar / borrar (con deshacer)
// pastRecoveryCard(exercise, ctx) → la tarjeta de la ficha de progreso (#/progress/exercise/:id).
// La lógica (validación, 1RM estimado, porcentaje) está en ../past-records-logic.js.
import * as store from '../store.js';
import { navigate, back } from '../router.js';
import { h, icon, screen, segmented, chips, textInput, numInput, confirmDialog, undoToast, emptyState, whyBox } from '../ui.js';
import { uid, todayStr, fmtNum, plural } from '../util.js';
import { approxInput } from '../approx-input.js';
import * as P from '../past-records-logic.js';
import { exerciseHistory } from '../stats.js';
import { formatSet } from '../session-logic.js';
import { pickExercise } from '../pickers.js';
import { dataFromStore } from '../progress-ui.js';

const LIST = '#/records/past';
const kg1 = (v) => `${fmtNum(v, 1)} kg`;

/** Lo que necesita la comparación, leído una vez por pantalla (`data`: el de la pantalla que la pinta, si ya lo tiene). */
function recoveryCtx(today = todayStr(), data = dataFromStore(today)) {
  return {
    data,
    today,
    marks: P.normalizePastRecords(store.all('pastRecords')),
    env: { bodyweight: data.bodyweight, context: store.all('context'), fallbackKg: data.settings?.bodyweightDefault ?? 75 },
  };
}

function recoveryOf(exercise, ctx) {
  return P.exerciseRecovery({
    exercise,
    marks: ctx.marks,
    history: exerciseHistory(ctx.data, exercise.id, { labels: false }),
    today: ctx.today,
    env: ctx.env,
  });
}

/** «¿Cómo se calcula?»: los datos concretos (ahora, referencia, cálculo) y las notas (estimación, RIR, peso, fecha). */
function recoveryWhyBox(r, exercise, today) {
  const why = P.recoveryWhy(r, exercise, { setLabel: (e) => formatSet(e.e1rmSet, exercise.logType, { kg: true }), today });
  return whyBox(h('div.wk-why.pr-why',
    h('ul.wk-why-data.wk-why-stacked', why.rows.map((d) => h('li.wk-why-row', { dataset: { row: d.label } },
      h('span.wk-why-label', d.label),
      h('span.wk-why-value', d.value),
      d.sub ? h('span.pr-why-sub', d.sub) : null))),
    h('ul.pr-why-notes', why.notes.map((n) => h('li', n)))), '¿Cómo se calcula?');
}

/** Línea de recuperación con su «¿Cómo se calcula?» (null si no hay nada que decir). */
function recoveryBlock(r, exercise, today) {
  const line = P.recoveryLine(r);
  if (!line) return null;
  return h('div.pr-recovery', { dataset: { status: r.status, pct: r.pct ?? '' } },
    h('p.pr-recovery-line', line),
    r.status === 'ok' || r.reference ? recoveryWhyBox(r, exercise, today) : null);
}

function markRow(rec, est, exercise) {
  const bits = [P.markWhen(rec), rec.beforeApp ? 'antes de Entreno' : 'fuera de Entreno'];
  const e1 = est?.e1rm != null ? `1RM est. ≈ ${kg1(est.e1rm)}` : est?.reason === 'reps' ? 'sin 1RM (más de 12 reps)' : null;
  return h('button.list-item.pr-row', { type: 'button', dataset: { id: rec.id }, onClick: () => navigate(`${LIST}/${encodeURIComponent(rec.id)}`) },
    h('span.list-item-main',
      h('span.list-item-title.pr-row-mark', P.markLabel(rec, exercise?.logType)),
      h('span.list-item-sub.pr-row-meta', [...bits, e1].filter(Boolean).join(' · ')),
      rec.note ? h('span.list-item-sub.wrap.pr-row-note', rec.note) : null),
    icon('chevron-right', 20, 'chev'));
}

// ===========================================================================
// #/records/past
// ===========================================================================

export function mountPastRecords(root) {
  const c = screen(root, {
    title: 'Marcas históricas',
    subtitle: 'De antes de Entreno o fuera de la app',
    back: '#/records',
    actions: [{ icon: 'plus', label: 'Añadir marca', onClick: () => navigate(`${LIST}/new`) }],
  });
  c.classList.add('pr');
  const intro = h('p.pr-intro', 'Tus mejores marcas de antes de usar Entreno (o hechas fuera de la app). Se guardan aparte de los récords de Entreno y sirven para ver cuánto rendimiento has recuperado. Solo están en este iPhone.');
  render();
  // Tras deshacer un borrado (o cualquier cambio en lo que usa la comparación) se vuelve a pintar, una vez.
  let queued = false;
  const off = store.on('change', (e) => {
    if (!RECOVERY_STORES.has(e.store) || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  });
  return off;

  function render() {
    c.replaceChildren(intro, ...listBlocks());
  }
}

/** Lo que cambia la lista: las marcas y lo que usa la comparación. */
const RECOVERY_STORES = new Set(['pastRecords', 'sessions', 'bodyweight', 'context', 'exercises']);

function listBlocks() {
  const ctx = recoveryCtx();
  const groups = P.groupByExercise(ctx.marks);
  if (!groups.length) {
    return [h('section.card.pr-empty', emptyState({
      emoji: '🏅',
      title: 'Aún no hay marcas históricas',
      text: 'Por ejemplo: «Press banca 100 kg × 5, verano 2025». Vale con fecha aproximada (mes, estación o año) o sin fecha.',
      action: { label: 'Añadir marca', onClick: () => navigate(`${LIST}/new`) },
    }))];
  }
  return groups.map((g) => {
    const ex = ctx.data.exercises.get(g.exerciseId);
    const r = ex ? recoveryOf(ex, ctx) : null;
    const byId = new Map((r?.marks || []).map((m) => [m.record.id, m]));
    return h('section.card.pr-group', { dataset: { ex: g.exerciseId } },
      h('button.pr-group-head', {
        type: 'button', 'aria-label': `${ex?.name || 'Ejercicio borrado'}: ver progreso`, disabled: !ex,
        onClick: () => navigate(`#/progress/exercise/${encodeURIComponent(g.exerciseId)}`),
      },
      h('span.pr-group-name', ex?.name || 'Ejercicio borrado'),
      ex ? h('span.pr-group-go', 'Progreso', icon('chevron-right', 16)) : null),
      r ? recoveryBlock(r, ex, ctx.today) : null,
      h('div.list.pr-list', g.records.map((rec) => markRow(rec, byId.get(rec.id), ex))),
      ex ? h('button.btn.btn-ghost.btn-sm.pr-add-more', { type: 'button', onClick: () => navigate(`${LIST}/new?exercise=${encodeURIComponent(g.exerciseId)}`) },
        icon('plus', 18), 'Otra marca de este ejercicio') : null);
  });
}

// ===========================================================================
// Tarjeta en la ficha de progreso de un ejercicio
// ===========================================================================

/**
 * «Marca histórica» en #/progress/exercise/:id: la recuperación y la mejor marca, o (sin marcas) una fila discreta para
 * añadirla. null si el ejercicio no admite marcas (tiempo, saltos, sprint, cardio). `data`: progress-ui.dataFromStore de la
 * ficha (así no se recalcula el índice de estadísticas).
 */
export function pastRecoveryCard(exercise, data = null) {
  if (!P.markable(exercise)) return null;
  const ctx = data ? recoveryCtx(data.today, data) : recoveryCtx();
  const own = ctx.marks.filter((m) => m.exerciseId === exercise.id);
  if (!own.length) {
    return h('button.list-item.prg-link-row.pr-link-add', { type: 'button', dataset: { link: 'past-add' }, onClick: () => navigate(`${LIST}/new?exercise=${encodeURIComponent(exercise.id)}`) },
      icon('trophy', 22),
      h('span.list-item-main', h('span.list-item-title', 'Añadir marca histórica'), h('span.list-item-sub.wrap', 'Tu mejor marca de antes de Entreno, para ver cuánto has recuperado')),
      icon('chevron-right', 20, 'chev'));
  }
  const r = recoveryOf(exercise, ctx);
  const best = r.bestMark?.record || own[0];
  return h('section.card.pr-card', { dataset: { block: 'past' } },
    h('div.row-between.pr-card-head',
      h('h2.card-title', 'Marca histórica'),
      h('button.btn.btn-ghost.btn-sm.pr-card-all', { type: 'button', onClick: () => navigate(LIST) }, plural(own.length, 'marca', 'marcas'), icon('chevron-right', 16))),
    h('p.pr-card-best', h('b', P.markLabel(best, exercise.logType)), ` · ${P.markWhen(best)}${best.beforeApp ? ' · antes de Entreno' : ''}`),
    recoveryBlock(r, exercise, ctx.today));
}

/** Fila de Récords › Fuerza que lleva a las marcas históricas (con cuántas hay). */
export function pastRecordsLink() {
  const n = P.normalizePastRecords(store.all('pastRecords')).length;
  return h('button.list-item.prg-link-row.pr-link', { type: 'button', dataset: { link: 'past' }, onClick: () => navigate(LIST) },
    icon('history', 22),
    h('span.list-item-main',
      h('span.list-item-title', 'Marcas históricas'),
      h('span.list-item-sub.wrap', n ? `${plural(n, 'marca', 'marcas')} de antes de Entreno o fuera de la app` : 'Añade tus mejores marcas de antes de Entreno')),
    icon('chevron-right', 20, 'chev'));
}

// ===========================================================================
// #/records/past/new · #/records/past/:id
// ===========================================================================

export function mountPastRecordEdit(root, params = {}) {
  const today = todayStr();
  const editing = params.id ? P.normalizePastRecord(store.get('pastRecords', params.id)) : null;
  if (params.id && !editing) {
    const c = screen(root, { title: 'Marca histórica', back: LIST });
    c.appendChild(emptyState({ emoji: '🔍', title: 'No encontrada', text: 'Puede que se haya borrado.', action: { label: 'Ver marcas históricas', onClick: () => navigate(LIST, { replace: true }) } }));
    return undefined;
  }
  const exOf = (id) => (id ? store.get('exercises', id) : null);
  const preset = exOf(params.exercise);
  const draft = editing ? { ...editing } : {
    exerciseId: P.markable(preset) ? preset.id : null, weight: null, reps: null, rir: null, date: null, beforeApp: true, bodyweightKg: null, note: '',
  };
  // Peso corporal: el signo (lastre / asistencia) va en un segmentado; el campo siempre es positivo.
  let sign = draft.weight != null && draft.weight < 0 ? -1 : 1;
  let absWeight = draft.weight != null ? Math.abs(draft.weight) : null;
  let hasDate = !!draft.date;
  let lastDate = draft.date || { date: `${today.slice(0, 4)}-01-01`, precision: 'year' };

  const c = screen(root, { title: editing ? 'Editar marca' : 'Añadir marca', back: LIST });
  c.classList.add('pr', 'pr-edit');
  const form = h('div.pr-form');
  c.appendChild(form);
  const errEls = {};
  const errEl = (key) => (errEls[key] = h('p.form-error', { hidden: true, role: 'alert', dataset: { err: key } }));
  const preview = h('p.pr-preview', { 'aria-live': 'polite' });
  const env = recoveryCtx(today).env; // pesajes y contexto, para el peso corporal de una marca de peso corporal

  function syncWeight() {
    const ex = exOf(draft.exerciseId);
    draft.weight = ex?.logType === 'bodyweight' ? (absWeight != null ? sign * absWeight : null) : absWeight;
  }

  function paintPreview() {
    const ex = exOf(draft.exerciseId);
    syncWeight();
    if (!ex || !Number.isInteger(draft.reps) || (ex.logType !== 'bodyweight' && !(draft.weight > 0))) { preview.textContent = ''; return; }
    const est = P.markEstimate({ ...draft, weight: draft.weight ?? 0, date: hasDate ? draft.date : null }, ex, { ...env, today });
    if (est.reason === 'type') preview.textContent = 'Sin 1RM estimado en este ejercicio (core): se guarda la marca, pero no se compara.';
    else if (est.reason === 'reps') preview.textContent = 'Con más de 12 repeticiones no se estima el 1RM: se guarda, pero no se compara.';
    else preview.textContent = `1RM estimado ≈ ${kg1(est.e1rm)} (estimación${est.bw ? `, con ${kg1(est.bw.kg)} de peso corporal` : ''}).`;
  }

  function paint() {
    Object.keys(errEls).forEach((k) => delete errEls[k]);
    const ex = exOf(draft.exerciseId);
    const lt = ex?.logType;
    const isBw = lt === 'bodyweight';
    const uni = lt === 'unilateral';
    const blocks = [];

    blocks.push(h('section.card.pr-block', { dataset: { block: 'exercise' } },
      h('h2.card-title', 'Ejercicio'),
      h('button.list-item.pr-pick', { type: 'button', onClick: onPick },
        icon('dumbbell', 22),
        h('span.list-item-main', h('span.list-item-title', ex ? ex.name : 'Elegir ejercicio'), ex ? null : h('span.list-item-sub', 'Con peso y repeticiones')),
        icon('chevron-right', 20, 'chev')),
      errEl('exercise')));

    const weightField = isBw
      ? h('div.field.pr-field', { dataset: { field: 'weight' } },
        h('span.field-label', 'Lastre o asistencia (opcional)'),
        segmented({
          options: [{ value: 1, label: 'Lastre' }, { value: -1, label: 'Asistencia' }], value: sign, size: 'sm', ariaLabel: 'Lastre o asistencia',
          onChange: (v) => { sign = v; paintPreview(); },
        }),
        numInput({ value: absWeight, decimals: 2, suffix: 'kg', ariaLabel: 'Kilos de lastre o asistencia', placeholder: '0', onInput: (v) => { absWeight = v; paintPreview(); } }),
        h('span.field-hint', 'Vacío = sin lastre.'))
      : h('div.field.pr-field', { dataset: { field: 'weight' } },
        h('span.field-label', uni ? 'Peso por lado' : 'Peso'),
        numInput({ value: absWeight, decimals: 2, suffix: 'kg', ariaLabel: uni ? 'Peso por lado' : 'Peso', onInput: (v) => { absWeight = v; paintPreview(); } }));
    const repsField = h('div.field.pr-field', { dataset: { field: 'reps' } },
      h('span.field-label', uni ? 'Repeticiones por lado' : 'Repeticiones'),
      numInput({ value: draft.reps, decimals: 0, inputmode: 'numeric', ariaLabel: 'Repeticiones', onInput: (v) => { draft.reps = v; paintPreview(); } }));
    blocks.push(h('section.card.pr-block', { dataset: { block: 'mark' } },
      h('h2.card-title', 'Marca'),
      // Peso corporal: el segmentado «Lastre · Asistencia» necesita el ancho entero; los demás, peso y reps en dos columnas.
      isBw ? h('div.pr-stack', weightField, repsField) : h('div.grid-2.pr-grid', weightField, repsField),
      errEl('weight'), errEl('reps'),
      h('div.field.pr-field', { dataset: { field: 'rir' } },
        h('span.field-label', 'RIR (opcional)'),
        chips({
          options: Array.from({ length: P.RIR_MAX + 1 }, (_, i) => ({ value: i, label: String(i), className: 'chip-num' })),
          value: draft.rir, allowNone: true, className: 'pr-rir', onChange: (v) => { draft.rir = v; paintPreview(); },
        }),
        h('span.field-hint', 'Repeticiones que te quedaban. Sin apuntar se cuenta como serie al fallo.')),
      errEl('rir'),
      isBw ? h('div.field.pr-field', { dataset: { field: 'bodyweight' } },
        h('span.field-label', 'Tu peso corporal entonces (opcional)'),
        numInput({ value: draft.bodyweightKg, decimals: 1, suffix: 'kg', ariaLabel: 'Peso corporal entonces', onInput: (v) => { draft.bodyweightKg = v; paintPreview(); } }),
        h('span.field-hint', 'Si no lo pones, se usa tu pesaje más cercano a esa fecha, tu contexto o tu peso actual.')) : null,
      isBw ? errEl('bodyweightKg') : null,
      preview));

    blocks.push(h('section.card.pr-block', { dataset: { block: 'when' } },
      h('h2.card-title', 'Cuándo'),
      h('label.switch-row.pr-switch', { dataset: { switch: 'date' } },
        h('span.cfg-switch-texts', h('span.cfg-switch-title', 'Sé cuándo fue'), h('span.cfg-switch-sub', 'Aproximado vale: mes, estación o año')),
        h('span.switch', h('input', {
          type: 'checkbox', checked: hasDate, 'aria-label': 'Sé cuándo fue',
          onChange: (ev) => { hasDate = ev.target.checked; draft.date = hasDate ? lastDate : null; paint(); },
        }), h('span'))),
      hasDate ? approxInput({ label: 'Fecha', value: draft.date, today, key: 'date', onChange: (v) => { draft.date = v; if (v) lastDate = v; paintPreview(); } }) : null,
      errEl('date'),
      h('label.switch-row.pr-switch', { dataset: { switch: 'before' } },
        h('span.cfg-switch-texts', h('span.cfg-switch-title', 'Anterior a Entreno'), h('span.cfg-switch-sub', 'Apágalo si la hiciste fuera de la app mientras ya la usabas')),
        h('span.switch', h('input', {
          type: 'checkbox', checked: draft.beforeApp !== false, 'aria-label': 'Anterior a Entreno',
          onChange: (ev) => { draft.beforeApp = ev.target.checked; },
        }), h('span')))));

    blocks.push(h('section.card.pr-block', { dataset: { block: 'note' } },
      h('label.field', h('span.field-label', 'Nota (opcional)'),
        textInput({ value: draft.note, multiline: true, rows: 2, maxlength: P.NOTE_MAX, placeholder: 'p. ej. en mi antiguo gimnasio, con cinturón', ariaLabel: 'Nota', onInput: (v) => { draft.note = v; } }))));

    blocks.push(h('div.pr-actions',
      h('button.btn.btn-primary.btn-lg.btn-block.pr-save', { type: 'button', onClick: onSave }, editing ? 'Guardar cambios' : 'Guardar'),
      editing ? h('button.btn.btn-danger-ghost.btn-block.pr-delete', { type: 'button', onClick: onDelete }, icon('trash', 20), 'Borrar') : null));
    form.replaceChildren(...blocks);
    paintPreview();
  }

  async function onPick() {
    const id = await pickExercise({ title: 'Ejercicio de la marca', filter: P.markable, allowCreate: false, preferIds: draft.exerciseId ? [draft.exerciseId] : [] });
    if (!id || id === draft.exerciseId) return;
    const prev = exOf(draft.exerciseId);
    draft.exerciseId = id;
    if ((prev?.logType === 'bodyweight') !== (exOf(id)?.logType === 'bodyweight')) { sign = 1; absWeight = null; }
    paint();
  }

  async function onSave() {
    syncWeight();
    if (!hasDate) draft.date = null;
    const ex = exOf(draft.exerciseId);
    const err = P.validatePastRecord(draft, ex, today);
    if (hasDate && !draft.date && !err.date) err.date = 'Completa la fecha o apaga «Sé cuándo fue».';
    for (const [k, el] of Object.entries(errEls)) {
      el.hidden = !err[k];
      el.textContent = err[k] || '';
    }
    if (Object.keys(err).length) {
      form.querySelector('.form-error:not([hidden])')?.scrollIntoView({ block: 'center' });
      return;
    }
    const rec = P.pastRecordFrom(draft, ex, { id: editing?.id || uid('pr_'), createdAt: editing?.createdAt ?? null });
    await store.save('pastRecords', rec);
    back(LIST);
  }

  async function onDelete() {
    const ex = exOf(editing.exerciseId);
    const ok = await confirmDialog({
      title: '¿Borrar esta marca?', message: `${ex?.name || 'Ejercicio'}: ${P.markLabel(editing, ex?.logType)} (${P.markWhen(editing)}).`, confirmText: 'Borrar', danger: true,
    });
    if (!ok) return;
    const removed = await store.remove('pastRecords', editing.id);
    back(LIST);
    undoToast('Marca borrada', () => { if (removed) store.restore('pastRecords', removed); });
  }

  paint();
  return undefined;
}
