// session-view-card.js — tarjeta de un ejercicio de la sesión de fuerza y editor de series.
// PROPIETARIO: módulo de sesión. La vista (views/session.js) crea el contexto `ctx` y monta las tarjetas.
// Cada tarjeta se vuelve a pintar sola (ctx.rerenderCard) al confirmar/editar series: nunca toda la vista.
import { h, icon, stepper, chips, segmented, toast, undoToast, confirmDialog, haptic } from './ui.js';
import { fmtDate, fmtKm, fmtDuration, fmtPace, fmtSpeed, fmtNum, plural, uniq } from './util.js';
import { pace, speed, pace100, sessionDurationMin } from './calc.js';
import { ACTIVITY_EMOJI } from './seed.js';
import { navigate } from './router.js';
import {
  LOAD_REP_TYPES, formatSet, targetText, prMessage, inheritWeight, validateSet, missingField,
  extraSet, warmupSet, switchExercise, suggestedWarmup, warmupSetsFromPlan,
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

  // Última vez (de ESTE ejercicio de la sesión: distingue los repetidos, p. ej. Sprint 20 m / 30 m)
  const last = ctx.lastFor(se);
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
  const editSet = se.sets.find((s) => s.id === editId) || null;
  // Mientras no hay ninguna serie de trabajo hecha, «+ Calent.» va en la cabecera del editor (a mano,
  // junto a «Serie 1»); después, abajo con «+ Serie».
  const warmInHead = !!editSet && !editSet.done && editSet.type !== 'warmup'
    && !se.sets.some((s) => s.done && s.type !== 'warmup');
  const list = h('div.ses-sets');
  let workN = 0;
  se.sets.forEach((set) => {
    const num = set.type === 'warmup' ? 'C' : String(++workN);
    if (set.id === editId) list.appendChild(renderEditor(ctx, se, set, ex, logType, num, { warmInHead }));
    else list.appendChild(renderRow(ctx, se, set, logType, num, prs.get(set.id)));
  });
  if (list.childNodes.length) card.appendChild(list);

  // Calentamiento sugerido: línea discreta y plegada en la fila de «+ Serie» (no suma altura ni mueve el
  // editor: «Registrar serie 1» sigue donde estaba); al abrirla, el panel va debajo, al final de la tarjeta.
  // Solo en sesión activa, con carga y mientras el ejercicio no tiene calentamientos ni series hechas.
  const warm = ctx.session.status === 'active' && LOAD_REP_TYPES.includes(logType)
    ? suggestedWarmup(se, ex, ctx.settings?.(), last) : null;
  const [warmToggle, warmPanel] = warm?.plan.length ? warmupBlock(ctx, se, logType, warm) : [];

  const hasPending = se.sets.some((s) => !s.done);
  const btnCls = hasPending ? 'btn.btn-ghost.btn-sm' : 'btn.btn-secondary';
  card.appendChild(h('div.btn-row.ses-card-actions',
    h(`button.${btnCls}.ses-add-set`, { type: 'button', onClick: () => addSet(ctx, se, logType) }, icon('plus', 18), 'Serie'),
    warmInHead ? null : h(`button.${btnCls}.ses-add-warm`, { type: 'button', onClick: () => addWarmup(ctx, se, logType) }, icon('plus', 18), 'Calentamiento'),
    warmToggle || null));
  if (warmPanel) card.appendChild(warmPanel);
  return card;
}

// ---------------------------------------------------------------------------
// Calentamiento sugerido (plegado; al abrirlo, los pasos y «Añadir estas series»)
// ---------------------------------------------------------------------------

// Plegado/desplegado por ejercicio de la sesión: sobrevive a volver a pintar la tarjeta o la vista y a
// recargar la app a mitad de sesión. Una sola clave (la de la sesión en curso); si no hay almacenamiento, en memoria.
const WARM_KEY = 'entreno:calentamiento-abierto';
let warmState = null; // { sessionId, open:Set<seId> }
function warmOpenIds(sessionId) {
  if (warmState?.sessionId === sessionId) return warmState.open;
  let ids = [];
  try {
    const o = JSON.parse(localStorage.getItem(WARM_KEY) || 'null');
    if (o && o.sessionId === sessionId && Array.isArray(o.open)) ids = o.open;
  } catch { /* sin almacenamiento (privado, bloqueado): solo en memoria */ }
  warmState = { sessionId, open: new Set(ids) };
  return warmState.open;
}
function setWarmOpen(sessionId, seId, open) {
  const ids = warmOpenIds(sessionId);
  if (open) ids.add(seId);
  else ids.delete(seId);
  try { localStorage.setItem(WARM_KEY, JSON.stringify({ sessionId, open: [...ids] })); } catch { /* en memoria */ }
}

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Entrada del panel al desplegarlo: solo opacidad y desplazamiento (sin animar la altura). */
function revealWarm(panel) {
  if (reducedMotion() || typeof panel.animate !== 'function') return;
  panel.animate(
    [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
    { duration: 220, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  );
}

const kgTxt = (w) => fmtNum(w, 2);

/**
 * Línea «Calentamiento sugerido ▸» y su panel (oculto mientras está plegado: no ocupa nada).
 * → [toggle, panel], en ese orden en la tarjeta.
 */
function warmupBlock(ctx, se, logType, { plan, ref }) {
  const sid = ctx.session.id;
  const panelId = `ses-warm-${se.id}`;
  let open = warmOpenIds(sid).has(se.id);
  const per = logType === 'unilateral' ? '/lado' : '';
  const toggle = h('button.ses-warm-toggle', {
    type: 'button',
    'aria-expanded': String(open),
    'aria-controls': panelId,
    onClick: () => setOpen(!open),
  }, h('span', 'Calentamiento sugerido'), h('span.ses-warm-chev', { 'aria-hidden': 'true' }, '▸'));
  const panel = h('div.ses-warmup', { id: panelId, role: 'group', 'aria-label': 'Calentamiento sugerido', hidden: !open },
    h('p.ses-warm-for.tnum', `Antes de ${kgTxt(ref.weight)} kg${ref.reps ? ` × ${ref.reps}${per}` : ''}:`),
    h('ol.ses-warm-steps', plan.map((p) => h('li.ses-warm-step.tnum',
      h('span.ses-warm-pct', `${p.pct}\u00a0%`), ` · ${kgTxt(p.weight)} kg × ${p.reps}${per}`))),
    h('button.btn.btn-secondary.btn-sm.btn-block.ses-warm-add', { type: 'button', onClick: () => addWarmupPlan(ctx, se, plan, logType) },
      icon('plus', 18), 'Añadir estas series'));

  function setOpen(v) {
    open = v;
    setWarmOpen(sid, se.id, v);
    toggle.setAttribute('aria-expanded', String(v));
    panel.hidden = !v;
    if (v) revealWarm(panel);
  }
  return [toggle, panel];
}

/** «Añadir estas series»: calentamientos pendientes al principio del ejercicio (con deshacer). */
function addWarmupPlan(ctx, se, plan, logType) {
  const { sets, index } = warmupSetsFromPlan(plan, se, logType);
  if (!sets.length) return;
  se.sets.splice(index, 0, ...sets);
  setWarmOpen(ctx.session.id, se.id, false);
  ctx.editing.set(se.id, sets[0].id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
  // La línea ya no está (hay calentamientos): el foco pasa a «Registrar calentamiento».
  ctx.cardEl?.(se)?.querySelector('.ses-editor .ses-register')?.focus({ preventScroll: true });
  ctx.revealEditor?.(se);
  const ids = new Set(sets.map((x) => x.id));
  undoToast(plural(sets.length, 'serie de calentamiento añadida', 'series de calentamiento añadidas'), () => {
    se.sets = se.sets.filter((x) => x.done || !ids.has(x.id));
    ctx.editing.delete(se.id);
    ctx.save();
    ctx.rerenderCard(se);
  });
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
function renderEditor(ctx, se, set, ex, logType, num, { warmInHead = false } = {}) {
  const pending = !set.done;

  // Toques (botones, chips) se guardan al instante; lo que se teclea, con un pequeño retardo.
  const changed = (final = true) => { ctx.touch(se); if (final) ctx.save(); else ctx.saveSoon(); };
  const isFinal = (o) => !o || o.final !== false;
  const bind = (key) => (v, o) => { set[key] = v; changed(isFinal(o)); };
  // Herencia de peso: el peso prellenado se guarda EN la serie (origWeight) al primer cambio, así que
  // confirmar tras cerrar y volver a abrir la app da el mismo resultado que sin cerrar.
  const setWeight = (v) => {
    if (pending && !('origWeight' in set)) set.origWeight = set.weight ?? null;
    set.weight = v;
  };
  const fields = [];
  const field = (lbl, ctl, extra = null) => h('div.ses-field', h('span.ses-field-label', lbl), h('div.ses-field-ctl', ctl, extra));
  const tag = (st, key) => { st.input.dataset.field = key; return st; };
  const weightStep = (lbl, opts = {}) => tag(stepper({
    value: set.weight, step: 2.5, decimals: 2, inputmode: 'decimal', suffix: 'kg', showStep: true, min: 0, max: 999,
    ariaLabel: lbl, onChange: (v, o) => { setWeight(v); changed(isFinal(o)); }, ...opts,
  }), 'weight');
  const repsStep = (key, lbl) => tag(stepper({
    value: set[key], step: 1, decimals: 0, inputmode: 'numeric', min: 0, max: 999, ariaLabel: lbl, onChange: bind(key),
  }), key);

  switch (logType) {
    case 'bodyweight': {
      // Lastre (+) o asistencia (−): el teclado decimal del iPhone no tiene signo menos, así que el signo
      // se elige con el segmentado y el campo es siempre positivo (se guarda weight < 0 = asistencia).
      let sign = set.weight < 0 ? -1 : 1;
      const lblEl = h('span.ses-field-label');
      const paintLbl = () => { lblEl.textContent = sign < 0 ? 'Asist.' : 'Lastre'; };
      const st = weightStep('Lastre', {
        value: set.weight == null ? null : Math.abs(set.weight),
        min: 0, max: 300,
        onChange: (v, o) => { setWeight(v == null ? null : v === 0 ? 0 : sign * v); changed(isFinal(o)); },
      });
      st.input.placeholder = 'sin lastre';
      const signSeg = segmented({
        options: [{ value: 1, label: 'Lastre' }, { value: -1, label: 'Asistencia' }],
        value: sign,
        ariaLabel: 'Lastre o asistencia',
        onChange: (v) => {
          sign = v;
          const abs = st.getValue();
          if (abs != null && abs !== 0) setWeight(sign * Math.abs(abs));
          st.input.setAttribute('aria-label', sign < 0 ? 'Asistencia' : 'Lastre');
          st.input.placeholder = sign < 0 ? 'kg' : 'sin lastre';
          paintLbl();
          changed();
        },
      });
      signSeg.classList.add('ses-sign');
      if (sign < 0) { st.input.setAttribute('aria-label', 'Asistencia'); st.input.placeholder = 'kg'; }
      paintLbl();
      fields.push(h('div.ses-field', lblEl, h('div.ses-field-ctl', st, signSeg)));
      fields.push(field('Reps', repsStep('reps', 'Repeticiones')));
      break;
    }
    case 'unilateral':
      fields.push(field('Peso', weightStep('Peso')));
      fields.push(field('Reps izq.', repsStep('reps', 'Repeticiones lado izquierdo')));
      fields.push(field('Reps der.', repsStep('repsR', 'Repeticiones lado derecho')));
      break;
    case 'time':
      fields.push(field('Tiempo', tag(stepper({ value: set.timeSec, step: 5, decimals: 0, inputmode: 'numeric', suffix: 's', min: 0, max: 36000, showStep: true, ariaLabel: 'Segundos', onChange: bind('timeSec') }), 'timeSec')));
      fields.push(field('Lastre', weightStep('Lastre (opcional)', { size: 'md', placeholder: 'opcional' })));
      break;
    case 'distance_time':
      fields.push(field('Metros', tag(stepper({ value: set.distanceM, step: 5, decimals: 1, inputmode: 'decimal', suffix: 'm', min: 0, max: 100000, showStep: true, ariaLabel: 'Metros', onChange: bind('distanceM') }), 'distanceM')));
      fields.push(field('Tiempo', tag(stepper({ value: set.timeSec, step: 0.1, decimals: 2, inputmode: 'decimal', suffix: 's', min: 0, max: 36000, showStep: true, ariaLabel: 'Segundos', onChange: bind('timeSec') }), 'timeSec')));
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
  // (no en calentamientos: no cuentan para nada y así «Registrar calentamiento» queda más a mano)
  let rirChips = null;
  let rirBlock = null;
  if (LOAD_REP_TYPES.includes(logType)) {
    rirChips = chips({ options: RIR_OPTS, value: set.rir ?? null, allowNone: true, className: 'ses-rir', onChange: (v) => { set.rir = v; changed(); } });
    rirBlock = h('div.ses-sub', { hidden: set.type === 'warmup' }, h('span.ses-sub-label', 'RIR · repeticiones en reserva'), rirChips);
    fields.push(rirBlock);
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
      typeSeg.dataset.type = v;
      if (rirBlock) rirBlock.hidden = v === 'warmup';
      editorEl.classList.toggle('ses-editor-warm', v === 'warmup');
      paintSubmit();
      changed();
    },
  });
  typeSeg.classList.add('ses-type');
  typeSeg.dataset.type = set.type;

  // Nota opcional de la serie
  const noteInp = h('input.input.ses-note-input', { type: 'text', value: set.note || '', placeholder: 'Nota de la serie', maxlength: 200, 'aria-label': 'Nota de la serie', hidden: !set.note });
  noteInp.addEventListener('input', () => { set.note = noteInp.value; changed(false); });
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

  // «Registrar» justo debajo de los datos (a mano del pulgar); el tipo de serie y los enlaces, debajo.
  const editorEl = h(`div.ses-editor${pending ? '' : '.ses-editor-edit'}${set.type === 'warmup' ? '.ses-editor-warm' : ''}`, { dataset: { set: set.id, state: pending ? 'editing' : 'editing-done' } },
    h('div.ses-editor-head',
      headNum,
      pending ? null : h('span.badge.badge-ok', 'Hecha · editando'),
      warmInHead ? h('button.btn.btn-ghost.btn-sm.ses-add-warm', {
        type: 'button', 'aria-label': 'Añadir calentamiento antes de esta serie', onClick: () => addWarmup(ctx, se, logType),
      }, icon('plus', 18), 'Calent.') : null),
    fields,
    noteInp,
    submit,
    typeSeg,
    h('div.ses-editor-links', noteBtn, h('span.grow'), delBtn));
  return editorEl;
}

/** Confirma una serie pendiente (1 toque con los valores prellenados). */
function registerSet(ctx, se, set, ex, logType) {
  const err = validateSet(set, logType);
  if (err) {
    toast(err, { kind: 'error' });
    // Lleva al campo que falta (abre el teclado: estamos dentro del toque).
    const key = missingField(set, logType);
    const inp = key && ctx.cardEl?.(se)?.querySelector(`.ses-editor [data-field="${key}"]`);
    if (inp) inp.focus();
    return;
  }
  const i = se.sets.indexOf(set);
  set.done = true;
  set.doneAt = Date.now();
  if (set.type === 'failure' && set.rir == null) set.rir = 'F';
  if ('origWeight' in set) {
    inheritWeight(se.sets, i, set.origWeight, set.weight ?? null);
    delete set.origWeight;
  }
  ctx.editing.delete(se.id);
  // 400 ms: cubre un doble toque accidental también en un móvil lento, sin estorbar al registrar la siguiente.
  ctx.guardUntil.set(se.id, performance.now() + 400);
  ctx.touch(se);
  ctx.save();
  haptic(15);
  const prs = set.type !== 'warmup' ? ctx.prsFor(se.exerciseId).get(set.id) : null;
  if (prs) toast(prMessage(prs, ex), { kind: 'pr', duration: 5000 });
  ctx.rerenderCard(se);
  // La fila hecha empuja el editor hacia abajo: que «Registrar» siga a la vista (no bajo las pestañas).
  if (!se.sets.some((s) => !s.done)) ctx.scrollToNext(se);
  else ctx.revealEditor?.(se);
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
  const set = extraSet(se, ctx.lastFor(se), logType);
  se.sets.push(set);
  if (!se.sets.some((s) => !s.done && s !== set)) ctx.editing.set(se.id, set.id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
  ctx.revealEditor?.(se);
}

function addWarmup(ctx, se, logType) {
  const { set, index } = warmupSet(se, ctx.lastFor(se), logType);
  se.sets.splice(index, 0, set);
  ctx.editing.set(se.id, set.id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
  ctx.revealEditor?.(se);
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
  // Un ítem de cardio con carrera/bici ya registrada: no dejarla huérfana.
  const dropped = ctx.confirmLinked ? await ctx.confirmLinked(se, id) : [];
  if (dropped == null) { altChips.setValue(se.exerciseId); return; }
  const before = dropped.length ? JSON.parse(JSON.stringify(se)) : null;
  switchExercise(se, id, ctx.session);
  ctx.editing.delete(se.id);
  ctx.touch(se);
  ctx.save();
  ctx.rerenderCard(se);
  if (dropped.length) ctx.afterDropLinked(se, before, dropped, `Cambiado a «${to}»`);
}

// ---------------------------------------------------------------------------
// Ítems de cardio: se registran como actividad enlazada
// ---------------------------------------------------------------------------

/** «6,2 km · 35:00 · 5:39 /km» de una actividad. */
export function activitySummaryText(a) {
  const km = a.distanceKm;
  const sec = a.movingSec ?? (sessionDurationMin(a) != null ? sessionDurationMin(a) * 60 : null);
  let rate = '';
  if (a.kind === 'run') rate = fmtPace(pace(sec, km));
  else if (a.kind === 'bike') rate = fmtSpeed(speed(sec, km));
  else if (a.kind === 'swim') rate = fmtPace(pace100(sec, km), '/100 m');
  return [km ? fmtKm(km) : null, sec ? fmtDuration(sec) : null, rate && rate !== '—' ? rate : null].filter(Boolean).join(' · ');
}

/** Fila de una actividad enlazada (abre su edición). */
export function activityRow(a) {
  return h('button.ses-act', { type: 'button', dataset: { activity: a.id }, onClick: () => navigate(`#/activity/${a.id}`) },
    h('span.ses-act-emoji', { 'aria-hidden': 'true' }, ACTIVITY_EMOJI[a.kind] || '⚡'),
    h('span.ses-act-main.tnum', activitySummaryText(a) || 'Actividad registrada'),
    h('span.ses-act-edit', 'Editar', icon('chevron-right', 18)));
}
function renderCardio(ctx, se, ex, card) {
  const sport = ex?.sport || 'run';
  const acts = ctx.linked(se.id);
  if (acts.length) card.appendChild(h('div.ses-acts', acts.map(activityRow)));
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
