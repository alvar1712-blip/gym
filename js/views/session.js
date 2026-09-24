// session — registro de sesiones de fuerza (activa o edición de una pasada) y resumen al terminar.
// PROPIETARIO: módulo de sesión. Tarjetas y editor de series en ../session-view-card.js;
// resumen en ../session-view-summary.js; lógica pura en ../session-logic.js.
import * as store from '../store.js';
import {
  h, icon, header, sheet, confirmDialog, promptDialog, actionSheet, toast, undoToast,
  rpePicker, field, textInput, numInput, emptyState,
} from '../ui.js';
import { fmtDate, fmtDuration, fmtMinutes, hhmm, tsFromDate, isDateStr, deepClone, parseNum, plural, todayStr } from '../util.js';
import { orderKeyOf, bestsForExercise, addToBests, detectPRs, isWorkSet, makeBodyweightFn } from '../calc.js';
import { navigate, back, refresh } from '../router.js';
import { pickExercise } from '../pickers.js';
import {
  lastFor, newSessionExercise, switchExercise, linkedActivities, orphanActivities, proposedDuration, finishSession,
  pendingCount, doneCount, templateDiff, applyTemplateDiff, autoDuration, syncAutoDuration,
} from '../session-logic.js';
import { renderCard, activityRow, activitySummaryText } from '../session-view-card.js';
import { renderSummary } from '../session-view-summary.js';

// ===========================================================================
// Registro de la sesión
// ===========================================================================
export function mountSession(root, params = {}) {
  const id = params.id;
  root.classList.add('ses-view');
  const session = store.get('sessions', id);
  if (!session) {
    const hd = header({ title: 'Sesión', back: '#/today' });
    root.replaceChildren(hd, h('div.content', emptyState({
      emoji: '🤷', title: 'Esta sesión no existe', text: 'Puede que se haya borrado.',
      action: { label: 'Volver', onClick: () => back('#/today') },
    })));
    return undefined;
  }
  if (session.kind !== 'strength') {
    navigate(`#/activity/${id}`, { replace: true });
    return undefined;
  }

  let unmounted = false;
  let timer = null;
  let headerEl = null;
  const clockEl = h('span.ses-clock.tnum');
  const listEl = h('div.ses-list');
  const orphansEl = h('div.ses-orphans');
  const content = h('div.content.ses-content');

  // --- datos de historial (instantánea al montar; esta sesión se lee siempre en vivo) ---
  let snap;
  function buildSnapshot() {
    const key = orderKeyOf(session);
    const sessions = store.all('sessions');
    const earlier = sessions.filter((s) => s.kind === 'strength' && s.id !== session.id && orderKeyOf(s) < key);
    snap = {
      sessions,
      earlier,
      bwFn: makeBodyweightFn(store.bodyweightList(), store.settings()?.bodyweightDefault ?? 75),
      last: new Map(),
      bests: new Map(),
    };
  }
  buildSnapshot();

  const ctx = {
    session,
    labels: new Map(), // seId → 'A1'…
    editing: new Map(), // seId → setId abierto en el editor (si no, la primera pendiente)
    guardUntil: new Map(), // seId → instante hasta el que se ignora «Registrar» (doble toque)
    exercise: (eid) => store.exercise(eid),
    /** «Última vez» de ESTE ejercicio de la sesión (un ejercicio repetido tiene la suya). */
    lastFor(se) {
      const key = `${se.id}|${se.exerciseId}`;
      if (!snap.last.has(key)) snap.last.set(key, lastFor(se, session, snap.sessions));
      return snap.last.get(key);
    },
    /** Récords de las series hechas de ese ejercicio en esta sesión: Map(setId → récords). */
    prsFor(eid) {
      const ex = store.exercise(eid);
      const out = new Map();
      if (!ex) return out;
      if (!snap.bests.has(eid)) snap.bests.set(eid, bestsForExercise(snap.earlier, eid, ex, { bwFn: snap.bwFn }));
      const bests = deepClone(snap.bests.get(eid));
      const bw = snap.bwFn(session.date);
      for (const se of session.exercises) {
        if (se.exerciseId !== eid) continue;
        for (const set of se.sets) {
          if (!isWorkSet(set)) continue;
          const prs = detectPRs(set, ex, bests, bw);
          if (prs.length) out.set(set.id, prs);
          addToBests(bests, set, ex, bw);
        }
      }
      return out;
    },
    linked: (seId) => linkedActivities(session, store.all('sessions'), seId),
    touch(se) {
      const i = session.exercises.indexOf(se);
      if (i >= 0) session.cursor = i;
    },
    save: () => store.save('sessions', session).catch(() => {}), // el error ya lo avisa app.js
    saveSoon: () => store.saveSoon('sessions', session),
    rerenderCard(se) {
      const old = listEl.querySelector(`[data-se="${CSS.escape(se.id)}"]`);
      if (old) old.replaceWith(renderCard(ctx, se));
      else renderList();
      updateFinishHint();
    },
    rerenderList: () => renderList(),
    exerciseMenu: (se) => exerciseMenu(se),
    cardEl: (se) => cardEl(se),
    /** Tras registrar/añadir una serie: que el botón «Registrar» del editor quede a la vista. */
    revealEditor(se) {
      const btn = cardEl(se)?.querySelector('.ses-editor .ses-register');
      if (btn) ensureVisible(btn);
    },
    scrollToNext(se) {
      if (session.status !== 'active') return;
      const next = session.exercises[session.exercises.indexOf(se) + 1];
      const el = next && cardEl(next);
      if (!el) return;
      setTimeout(() => {
        if (unmounted || !el.isConnected) return;
        // La tarjeta siguiente arriba; si así su «Registrar» quedara bajo las pestañas, un poco más.
        let top = el.getBoundingClientRect().top + window.scrollY - headerBottom() - 8;
        const btn = el.querySelector('.ses-editor .ses-register');
        if (btn) {
          const over = btn.getBoundingClientRect().bottom + window.scrollY - top - visibleBottom();
          if (over > 0) top += over;
        }
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }, 350);
    },
    /**
     * Antes de quitar o cambiar un ítem de cardio con actividades enlazadas: pide confirmación para
     * borrarlas (si no, quedarían huérfanas). → [] si no hay nada que borrar, la lista si se confirma, null si no.
     */
    async confirmLinked(se, newExerciseId = null) {
      const acts = linkedActivities(session, store.all('sessions'), se.id);
      if (!acts.length) return [];
      const cur = store.exercise(se.exerciseId);
      const nx = newExerciseId ? store.exercise(newExerciseId) : null;
      // Otra variante del mismo deporte (p. ej. otra carrera): la actividad sigue valiendo para el ítem.
      if (nx && nx.logType === 'cardio' && cur?.logType === 'cardio' && (nx.sport || 'run') === (cur.sport || 'run')) return [];
      const name = cur?.name || se.exName;
      const what = acts.length === 1
        ? `la actividad registrada (${activitySummaryText(acts[0]) || 'sin datos'})`
        : `${acts.length} actividades registradas`;
      const ok = await confirmDialog({
        title: nx ? `¿Cambiar «${name}» por «${nx.name}»?` : `¿Quitar «${name}»?`,
        message: `En «${name}» está ${what}. Si ${nx ? 'lo cambias' : 'lo quitas'}, se borrará también, para que no quede suelta dentro de la sesión.\n\nPodrás deshacerlo justo después.`,
        confirmText: acts.length === 1 ? 'Sí, borrar también la actividad' : 'Sí, borrar también las actividades',
        danger: true,
      });
      return ok ? acts : null;
    },
    /** Borra las actividades confirmadas con confirmLinked y ofrece deshacer (restaura `se` y las actividades). */
    async afterDropLinked(se, before, acts, msg) {
      const removed = await dropActivities(acts);
      syncDuration();
      undoToast(`${msg} · ${plural(removed.length, 'actividad borrada', 'actividades borradas')}`, async () => {
        if (before) { for (const k of Object.keys(se)) delete se[k]; Object.assign(se, before); }
        const writes = removed.map((o) => store.restore('sessions', o)); // en memoria al instante
        syncDuration();
        ctx.save();
        if (!unmounted) renderList();
        await Promise.allSettled(writes);
      });
    },
  };

  async function dropActivities(acts) {
    const removed = [];
    for (const a of acts) {
      const o = await store.remove('sessions', a.id).catch(() => null);
      if (o) removed.push(o);
    }
    return removed;
  }

  /**
   * Sesión terminada con la duración automática: si cambian sus actividades enlazadas (se registra la bici
   * olvidada, se edita o se borra la carrera), la duración de la fuerza se recalcula para no contar dos
   * veces el cardio. Devuelve {from, to} si ha cambiado.
   */
  function syncDuration() {
    const ch = syncAutoDuration(session, linkedActivities(session, store.all('sessions')));
    if (ch) {
      ctx.save();
      if (!unmounted && headerEl) renderHeader();
    }
    return ch;
  }

  // --- visibilidad del botón «Registrar» (una mano: sin desplazar a mano entre series) ---
  function headerBottom() {
    return headerEl ? Math.max(0, headerEl.getBoundingClientRect().bottom) : 0;
  }
  /** Límite inferior útil: encima de la barra de pestañas (y del teclado, si está abierto). */
  function visibleBottom() {
    let bottom = window.innerHeight;
    const vv = window.visualViewport;
    if (vv) bottom = Math.min(bottom, vv.offsetTop + vv.height);
    const tab = document.getElementById('tabbar');
    if (tab) {
      const r = tab.getBoundingClientRect();
      if (r.height > 0 && r.top < bottom) bottom = r.top;
    }
    return bottom - 12;
  }
  function ensureVisible(el) {
    const r = el.getBoundingClientRect();
    const limit = visibleBottom();
    const top = headerBottom() + 8;
    let d = 0;
    if (r.bottom > limit) d = Math.min(r.bottom - limit, r.top - top); // sin esconderlo bajo la cabecera
    else if (r.top < top) d = r.top - top;
    if (d) window.scrollBy({ top: d, behavior: 'smooth' });
  }

  // --- cabecera con cronómetro ---
  function renderHeader() {
    const active = session.status === 'active';
    const sub = h('span.ses-subtitle', fmtDate(session.date, 'short'));
    if (active && session.startedAt) sub.append(' · ', clockEl);
    else if (active) sub.append(' · a posteriori');
    else sub.append(` · ${session.durationMin != null ? fmtMinutes(session.durationMin) : 'terminada'}`);
    const actions = [];
    if (active) actions.push({ text: 'Terminar', label: 'Terminar sesión', onClick: openFinish, className: 'ses-finish-top' });
    actions.push({ icon: 'more', label: 'Opciones de la sesión', onClick: sessionMenu, className: 'ses-menu-btn' });
    const hd = header({ title: session.templateName || 'Sesión de fuerza', subtitle: sub, back: '#/today', actions });
    if (headerEl) headerEl.replaceWith(hd);
    else root.prepend(hd);
    headerEl = hd;
    tick();
  }
  function tick() {
    if (session.status === 'active' && session.startedAt) {
      clockEl.textContent = fmtDuration(Math.max(0, (Date.now() - session.startedAt) / 1000));
    }
  }
  function startTimer() {
    clearInterval(timer);
    if (session.status === 'active' && session.startedAt) timer = setInterval(tick, 1000);
  }
  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', onVisible);

  // --- lista de ejercicios (secciones y superseries/circuitos) ---
  function renderList() {
    const exs = session.exercises;
    const out = [];
    ctx.labels.clear();
    let letter = 0;
    let i = 0;
    while (i < exs.length) {
      const se = exs[i];
      if (se.section && se.section !== exs[i - 1]?.section) out.push(h('h2.section-title.ses-section', se.section));
      let j = i + 1;
      if (se.groupId) while (j < exs.length && exs[j].groupId === se.groupId) j++;
      if (se.groupId && j - i >= 2) {
        const L = String.fromCharCode(65 + (letter++ % 26));
        const kind = se.groupType === 'circuit' ? 'Circuito' : 'Superserie';
        for (let k = i; k < j; k++) ctx.labels.set(exs[k].id, `${L}${k - i + 1}`);
        out.push(h('div.ses-group', { dataset: { group: se.groupId } },
          h('div.ses-group-head', h('span.ses-group-kind', kind), ` ${L} · ${j - i} ejercicios seguidos`),
          exs.slice(i, j).map((x) => renderCard(ctx, x))));
        i = j;
      } else {
        out.push(renderCard(ctx, se));
        i++;
      }
    }
    if (!exs.length) {
      out.push(emptyState({ emoji: '🏋️', title: 'Sin ejercicios', text: 'Añade el primero con «Añadir ejercicio».' }));
    }
    listEl.replaceChildren(...out);
    renderOrphans();
    updateFinishHint();
  }

  /** Actividades enlazadas a la sesión cuyo ítem ya no está (no se ven en ninguna tarjeta). */
  function renderOrphans() {
    const acts = orphanActivities(session, store.all('sessions'));
    orphansEl.hidden = !acts.length;
    orphansEl.replaceChildren(...(acts.length ? [
      h('h2.section-title', 'Otras actividades de esta sesión'),
      h('div.ses-acts', acts.map(activityRow)),
      h('p.field-hint', 'Registradas desde un ejercicio que ya no está en la sesión. Cuentan para la sesión (y se descuentan de su duración de fuerza); ábrelas para editarlas o borrarlas.'),
    ] : []));
  }

  const cardEl = (se) => listEl.querySelector(`[data-se="${CSS.escape(se.id)}"]`);
  function scrollToEl(el, smooth) {
    const top = el.getBoundingClientRect().top + window.scrollY - (headerEl?.offsetHeight || 0) - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  // --- pie: añadir ejercicio, nota general, terminar ---
  const notesEl = textInput({
    value: session.notes, multiline: true, rows: 3, maxlength: 2000,
    placeholder: 'Sensaciones, molestias, contexto…', ariaLabel: 'Nota de la sesión',
    onInput: (v) => { session.notes = v; store.saveSoon('sessions', session); },
  });
  notesEl.classList.add('ses-notes');
  const finishHint = h('p.field-hint.ses-finish-hint');
  function updateFinishHint() {
    const n = pendingCount(session);
    finishHint.textContent = n ? `${plural(n, 'serie pendiente', 'series pendientes')} sin confirmar.` : '';
    finishHint.hidden = !n || session.status !== 'active';
  }

  function renderFooter() {
    const active = session.status === 'active';
    return h('div.ses-footer',
      h('button.btn.btn-secondary.btn-lg.btn-block.ses-add-ex', { type: 'button', onClick: addExercise }, icon('plus', 22), 'Añadir ejercicio'),
      field('Nota de la sesión', notesEl),
      active
        ? h('div.stack-sm',
          h('button.btn.btn-primary.btn-lg.btn-block.ses-finish', { type: 'button', onClick: openFinish }, icon('flag', 22), 'Terminar sesión'),
          finishHint)
        : h('button.btn.btn-secondary.btn-lg.btn-block.ses-to-summary', { type: 'button', onClick: () => navigate(`#/session/${session.id}/summary`) }, icon('chart', 22), 'Ver resumen'));
  }

  function renderAll() {
    renderHeader();
    const intro = session.status === 'active' && !session.startedAt
      ? h('div.banner.banner-info.ses-past-banner', h('div.banner-main',
        h('div.banner-text', `Sesión del ${fmtDate(session.date, 'long')} registrada a posteriori: sin cronómetro; la duración se indica al terminar.`)))
      : null;
    content.replaceChildren(...[intro, listEl, orphansEl, renderFooter()].filter(Boolean));
    renderList();
    startTimer();
  }

  /** Cambios que afectan al historial (fecha): se recalcula todo conservando el scroll. */
  function rebuild() {
    const y = window.scrollY;
    buildSnapshot();
    renderAll();
    window.scrollTo(0, y);
  }

  // =========================================================================
  // Ejercicios: añadir, cambiar, nota, mover, quitar
  // =========================================================================
  async function addExercise() {
    const eid = await pickExercise({ title: 'Añadir ejercicio' });
    if (!eid || unmounted) return;
    const prev = session.exercises[session.exercises.length - 1];
    const se = newSessionExercise(eid, session, { section: prev?.section || '' });
    session.exercises.push(se);
    session.cursor = session.exercises.length - 1;
    ctx.save();
    renderList();
    const el = cardEl(se);
    if (el) requestAnimationFrame(() => scrollToEl(el, true));
  }

  function exerciseMenu(se) {
    const idx = session.exercises.indexOf(se);
    const ex = store.exercise(se.exerciseId);
    const name = ex?.name || se.exName;
    actionSheet({
      title: name,
      actions: [
        { label: 'Cambiar por otro ejercicio', icon: 'swap', onClick: () => replaceExercise(se) },
        ex ? { label: 'Ver ficha del ejercicio', icon: 'info', onClick: () => navigate(`#/exercise/${ex.id}`) } : null,
        { label: se.note ? 'Editar nota del ejercicio' : 'Nota del ejercicio', icon: 'note', onClick: () => editExerciseNote(se) },
        { label: 'Mover arriba', icon: 'arrow-up', disabled: idx <= 0, onClick: () => moveExercise(se, -1) },
        { label: 'Mover abajo', icon: 'arrow-down', disabled: idx >= session.exercises.length - 1, onClick: () => moveExercise(se, 1) },
        { label: 'Quitar de esta sesión', icon: 'trash', danger: true, onClick: () => removeExercise(se) },
      ],
    });
  }

  async function replaceExercise(se) {
    const eid = await pickExercise({ title: 'Cambiar por…', excludeIds: [se.exerciseId], preferIds: se.alternatives || [] });
    if (!eid || unmounted) return;
    const done = se.sets.filter((s) => s.done).length;
    if (done) {
      const from = store.exercise(se.exerciseId)?.name || se.exName;
      const to = store.exercise(eid)?.name || eid;
      const ok = await confirmDialog({
        title: `¿Cambiar a «${to}»?`,
        message: `Ya has registrado ${plural(done, 'serie', 'series')} de «${from}». Si cambias, pasarán a contar como «${to}».\n\nSi has hecho los dos ejercicios, deja este y añade «${to}» con «Añadir ejercicio».`,
        confirmText: `Cambiar a ${to}`,
      });
      if (!ok) return;
    }
    const dropped = await ctx.confirmLinked(se, eid);
    if (dropped == null || unmounted) return;
    const before = dropped.length ? deepClone(se) : null;
    switchExercise(se, eid, session);
    ctx.editing.delete(se.id);
    ctx.touch(se);
    ctx.save();
    ctx.rerenderCard(se);
    if (dropped.length) ctx.afterDropLinked(se, before, dropped, `Cambiado a «${store.exercise(eid)?.name || eid}»`);
  }

  async function editExerciseNote(se) {
    const v = await promptDialog({ title: 'Nota del ejercicio', label: 'Solo para esta sesión', value: se.note || '', multiline: true, confirmText: 'Guardar nota' });
    if (v == null) return;
    se.note = v.trim();
    ctx.touch(se);
    ctx.save();
    ctx.rerenderCard(se);
  }

  function moveExercise(se, dir) {
    const i = session.exercises.indexOf(se);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= session.exercises.length) return;
    [session.exercises[i], session.exercises[j]] = [session.exercises[j], session.exercises[i]];
    session.cursor = j;
    ctx.save();
    renderList();
    const el = cardEl(se);
    if (el) requestAnimationFrame(() => scrollToEl(el, true));
  }

  async function removeExercise(se) {
    // Un ítem de cardio con carrera/bici registrada: se borra con él (con deshacer), no queda huérfana.
    const dropped = await ctx.confirmLinked(se);
    if (dropped == null || unmounted) return;
    const i = session.exercises.indexOf(se);
    if (i < 0) return;
    const name = store.exercise(se.exerciseId)?.name || se.exName;
    session.exercises.splice(i, 1);
    session.cursor = Math.max(0, Math.min(session.cursor || 0, session.exercises.length - 1));
    ctx.save();
    renderList();
    const removed = dropped.length ? await dropActivities(dropped) : [];
    if (removed.length) syncDuration();
    undoToast(removed.length ? `«${name}» y ${plural(removed.length, 'su actividad', 'sus actividades')} quitados de la sesión` : `«${name}» quitado de la sesión`, async () => {
      session.exercises.splice(Math.min(i, session.exercises.length), 0, se);
      session.cursor = i;
      const writes = removed.map((o) => store.restore('sessions', o)); // en memoria al instante
      if (removed.length) syncDuration();
      ctx.save();
      if (!unmounted) renderList();
      await Promise.allSettled(writes);
    });
  }

  // =========================================================================
  // Menú de la sesión: fecha, duración/RPE/notas, descartar, borrar
  // =========================================================================
  function sessionMenu() {
    const active = session.status === 'active';
    const acts = linkedActivities(session, store.all('sessions'));
    const empty = doneCount(session) === 0 && acts.length === 0;
    actionSheet({
      title: session.templateName || 'Sesión',
      actions: [
        { label: 'Cambiar fecha', icon: 'calendar', hint: fmtDate(session.date, 'day'), onClick: changeDate },
        { label: 'Duración, esfuerzo y notas', icon: 'clock', onClick: editMeta },
        active ? null : { label: 'Ver resumen', icon: 'chart', onClick: () => navigate(`#/session/${session.id}/summary`) },
        active && empty
          ? { label: 'Descartar sesión', icon: 'x', danger: true, onClick: discardSession }
          : { label: 'Borrar sesión', icon: 'trash', danger: true, onClick: deleteSession },
      ],
    });
  }

  function changeDate() {
    const inp = h('input.input.ses-date-input', { type: 'date', value: session.date, max: todayStr(), 'aria-label': 'Fecha de la sesión' });
    inp.addEventListener('change', () => {
      const v = inp.value;
      if (!isDateStr(v) || v === session.date) return;
      // Como en el calendario y el peso corporal: no se registran días que aún no han llegado.
      if (v > todayStr()) {
        inp.value = session.date;
        toast('La fecha no puede ser posterior a hoy.', { kind: 'error' });
        return;
      }
      const old = session.date;
      session.date = v;
      if (session.planDate === old) session.planDate = v;
      for (const a of linkedActivities(session, store.all('sessions'))) {
        a.date = v;
        if (a.planDate === old) a.planDate = v;
        store.save('sessions', a).catch(() => {});
      }
      ctx.save();
      rebuild();
      toast(`Fecha cambiada a ${fmtDate(v, 'long')}`, { kind: 'success' });
    });
    sheet({
      title: 'Cambiar fecha',
      body: h('div.stack',
        field('Fecha de la sesión', inp, 'Las actividades enlazadas (carrera, bici…) se mueven con ella.')),
      actions: [{ label: 'Listo', kind: 'primary' }],
    });
  }

  function editMeta() {
    const active = session.status === 'active';
    const rows = [];
    if (active && session.startedAt) {
      const err = h('p.form-error', { hidden: true });
      const t = h('input.input.ses-time-input', { type: 'time', value: hhmm(session.startedAt), 'aria-label': 'Hora de inicio' });
      t.addEventListener('change', () => {
        const [hh, mm] = String(t.value).split(':').map(Number);
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;
        const ts = tsFromDate(session.date, hh, mm);
        if (ts > Date.now()) { err.textContent = 'La hora de inicio no puede ser futura.'; err.hidden = false; return; }
        err.hidden = true;
        session.startedAt = ts;
        ctx.save();
        tick();
      });
      rows.push(field('Hora de inicio', t, 'La duración se calcula desde esta hora; al terminar podrás ajustarla.'), err);
    } else {
      const auto = autoDuration(session, linkedActivities(session, store.all('sessions')));
      const d = numInput({
        value: session.durationMin, decimals: 0, inputmode: 'numeric', suffix: 'min', placeholder: auto.value != null ? String(auto.value) : 'Minutos', ariaLabel: 'Duración en minutos',
        onInput: (v) => {
          if (v != null && v >= 0) {
            session.durationMin = Math.round(v);
            session.durationAuto = false;
          } else if (auto.value != null) {
            // Vacío = la automática (transcurrido − actividades enlazadas), no el transcurrido entero.
            session.durationMin = auto.value;
            session.durationAuto = true;
          } else {
            session.durationMin = null;
          }
          store.saveSoon('sessions', session);
        },
      });
      let hint = null;
      if (active) hint = 'Sesión registrada a posteriori: indícala a mano, sin el cardio que registres aparte.';
      else if (auto.value != null) {
        hint = auto.activitiesMin > 0
          ? `Vacío = automática: ${auto.elapsedMin} min de sesión − ${auto.activitiesMin} min de actividades enlazadas = ${auto.value} min.`
          : `Vacío = automática: ${auto.value} min de sesión.`;
      } else if (!session.startedAt) hint = 'Sin el cardio registrado aparte (carrera, bici…): ya cuenta por su lado.';
      rows.push(field('Duración de la fuerza', d, hint));
    }
    rows.push(h('div.field', h('span.field-label', 'Esfuerzo percibido de la sesión (1–10)'),
      rpePicker({ value: session.rpe, onChange: (v) => { session.rpe = v; ctx.save(); } })));
    rows.push(field('Nota de la sesión', textInput({
      value: session.notes, multiline: true, rows: 3, maxlength: 2000, ariaLabel: 'Nota de la sesión',
      onInput: (v) => { session.notes = v; notesEl.value = v; store.saveSoon('sessions', session); },
    })));
    sheet({
      title: 'Duración, esfuerzo y notas',
      body: h('div.stack', rows),
      actions: [{ label: 'Listo', kind: 'primary' }],
      onClose: () => { if (!unmounted) renderHeader(); },
    });
  }

  /** Sesión activa sin nada registrado: se descarta (con deshacer). */
  async function discardSession() {
    const obj = await store.remove('sessions', session.id).catch(() => null);
    if (!obj) return;
    navigate('#/today', { replace: true });
    undoToast('Sesión descartada', async () => {
      await store.restore('sessions', obj);
      navigate(`#/session/${obj.id}`);
    });
  }

  /** Borrar: confirmación y luego deshacer desde el toast en la pantalla a la que se vuelve. */
  async function deleteSession() {
    const acts = linkedActivities(session, store.all('sessions'));
    const n = doneCount(session);
    const extra = acts.length ? ` y ${plural(acts.length, 'actividad enlazada', 'actividades enlazadas')}` : '';
    const ok = await confirmDialog({
      title: '¿Borrar esta sesión?',
      message: `Se borrará la sesión del ${fmtDate(session.date, 'long')} con ${plural(n, 'serie', 'series')}${extra}.\n\nPodrás deshacerlo justo después.`,
      confirmText: 'Borrar sesión',
      danger: true,
    });
    if (!ok) return;
    const removed = [];
    try {
      for (const a of acts) removed.push(await store.remove('sessions', a.id));
      removed.unshift(await store.remove('sessions', session.id));
    } catch {
      return; // app.js ya avisa del error de guardado
    }
    const wasActive = session.status === 'active';
    if (wasActive) navigate('#/today', { replace: true });
    else back('#/today');
    undoToast('Sesión borrada', async () => {
      for (const o of removed) if (o) await store.restore('sessions', o);
      refresh();
    });
  }

  // =========================================================================
  // Terminar
  // =========================================================================
  function openFinish() {
    const acts = linkedActivities(session, store.all('sessions'));
    const pd = proposedDuration(session, acts);
    const live = pd.elapsedMin != null;
    // Lo escrito en esta hoja se guarda al momento: si la app se cierra antes de confirmar, sigue ahí.
    // Con cronómetro, la duración escrita es un borrador (durationDraft) hasta terminar.
    const draft = live ? (session.durationDraft ?? null) : (session.durationMin ?? null);
    let dur = draft ?? pd.proposed ?? null;
    let touched = draft != null;
    let rpe = session.rpe ?? null;
    const pending = pendingCount(session);
    const nothing = doneCount(session) === 0 && acts.length === 0;

    let explain;
    if (!live) {
      explain = 'Sesión registrada a posteriori: indica cuánto duró la fuerza (sin el cardio que registres aparte).';
    } else if (acts.length && pd.activitiesMin > 0) {
      explain = `${pd.elapsedMin} min desde el inicio − ${pd.activitiesMin} min de ${acts.length === 1 ? 'la actividad enlazada' : 'las actividades enlazadas'} (se cuentan aparte) = ${pd.proposed} min.`;
    } else {
      explain = `${pd.elapsedMin} min desde que empezaste (${hhmm(session.startedAt)}). Puedes ajustarlo.`;
    }
    const durErr = h('p.form-error.ses-dur-error', { hidden: true, role: 'alert' });
    const durInp = numInput({
      value: dur, decimals: 0, inputmode: 'numeric', suffix: 'min', placeholder: live ? String(pd.proposed) : 'Minutos', ariaLabel: 'Duración en minutos',
      onInput: (v) => {
        dur = v;
        touched = true;
        durErr.hidden = true;
        if (live) session.durationDraft = v != null && v >= 0 ? Math.round(v) : null;
        else session.durationMin = v != null && v >= 0 ? Math.round(v) : null;
        store.saveSoon('sessions', session);
      },
    });
    durInp.classList.add('ses-dur');
    const notesInp = textInput({
      value: session.notes, multiline: true, rows: 3, maxlength: 2000, ariaLabel: 'Nota de la sesión', placeholder: 'Opcional',
      onInput: (v) => { session.notes = v; notesEl.value = v; store.saveSoon('sessions', session); },
    });

    sheet({
      title: 'Terminar sesión',
      tall: false,
      className: 'ses-finish-sheet',
      body: h('div.stack',
        nothing ? h('div.banner.banner-warn', h('div.banner-main', h('div.banner-title', 'No has registrado ninguna serie'),
          h('div.banner-text', 'Si no llegaste a entrenar, puedes descartar la sesión desde el menú ⋯.'))) : null,
        field('Duración de la fuerza (min)', durInp, explain),
        durErr,
        h('div.field', h('span.field-label', 'Esfuerzo percibido de la sesión (1–10)'), rpePicker({ value: rpe, onChange: (v) => { rpe = v; session.rpe = v; ctx.save(); } })),
        field('Nota de la sesión', notesInp),
        pending ? h('div.banner.banner-warn.ses-pending-warn', h('div.banner-main',
          h('div.banner-text', `${plural(pending, 'serie pendiente', 'series pendientes')} sin confirmar: se descartarán al terminar.`))) : null),
      actions: [{
        label: 'Terminar sesión',
        kind: 'primary',
        onClick: async (close) => {
          if (session.status !== 'active') return; // doble toque
          const now = Date.now();
          // Propuesta al instante de terminar (misma `now` que endedAt: así se puede recalcular después).
          const fresh = proposedDuration(session, linkedActivities(session, store.all('sessions')), now);
          let minutes = typeof dur === 'number' ? dur : parseNum(dur);
          let auto = false;
          if (minutes == null || !Number.isFinite(minutes)) {
            if (fresh.proposed == null) {
              // Sin duración no hay carga (min × esfuerzo): en una sesión a posteriori hay que indicarla.
              durErr.textContent = 'Indica la duración: sin ella no se puede calcular la carga de la sesión.';
              durErr.hidden = false;
              (durInp.input || durInp).focus();
              return;
            }
            // Campo vacío = la propuesta (nunca el transcurrido entero, que incluye el cardio enlazado).
            minutes = fresh.proposed;
            auto = true;
          } else if (!touched && fresh.proposed != null) {
            minutes = fresh.proposed;
            auto = true;
          } else {
            auto = fresh.proposed != null && Math.round(minutes) === fresh.proposed;
          }
          finishSession(session, { durationMin: minutes, rpe, notes: session.notes, now, auto });
          clearInterval(timer);
          await store.save('sessions', session).catch(() => {});
          close();
          await askTemplateChanges();
          navigate(`#/session/${session.id}/summary`, { replace: true });
        },
      }],
    });
  }

  /** Si la sesión difiere de su plantilla, pregunta qué cambios aplicar. */
  function askTemplateChanges() {
    const tpl = session.templateId ? store.get('templates', session.templateId) : null;
    if (!tpl) return Promise.resolve(false);
    const changes = templateDiff(tpl, session, { nameOf: (eid) => store.exercise(eid)?.name });
    if (!changes.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      const checks = changes.map((c) => {
        const box = h('input.ses-check-input', { type: 'checkbox', checked: true, dataset: { change: c.id } });
        return { c, box, row: h('label.ses-check', box, h('span', c.label)) };
      });
      let applied = false;
      sheet({
        title: '¿Aplicar estos cambios a la plantilla?',
        className: 'ses-diff-sheet',
        onClose: () => resolve(applied),
        body: h('div.stack',
          h('p.sheet-msg', `Esta sesión es distinta de «${tpl.name}». Marca lo que quieras guardar en la plantilla para las próximas veces:`),
          h('div.ses-checks', checks.map((x) => x.row))),
        actions: [
          {
            label: 'Aplicar a la plantilla',
            kind: 'primary',
            onClick: async (close) => {
              const sel = checks.filter((x) => x.box.checked).map((x) => x.c.id);
              if (sel.length) {
                const next = applyTemplateDiff(tpl, session, sel, { logTypeOf: (eid) => store.exercise(eid)?.logType || null });
                tpl.items = next.items;
                await store.save('templates', tpl).catch(() => {});
                applied = true;
                toast(`Plantilla «${tpl.name}» actualizada`, { kind: 'success' });
              }
              close();
            },
          },
          { label: 'Solo esta vez', kind: 'secondary' },
        ],
      });
    });
  }

  // --- montaje ---
  // Sesión terminada: si sus actividades enlazadas cambiaron desde que se terminó, recalcular la duración.
  const synced = syncDuration();
  root.replaceChildren(content);
  renderAll();
  if (synced) toast(`Duración de la fuerza recalculada: ${fmtMinutes(synced.to)} (se descuentan las actividades enlazadas).`, { kind: 'success' });

  // Volver a donde se dejó: tras el scroll a 0 que hace el router, ir a la tarjeta del cursor.
  const cur = Math.min(session.cursor || 0, session.exercises.length - 1);
  if (cur > 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (unmounted || window.scrollY > 0) return;
      const el = cardEl(session.exercises[cur]);
      if (el) scrollToEl(el, false);
    }));
  }

  return () => {
    unmounted = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    // Sesión ya terminada: las series añadidas y no confirmadas no se quedan como pendientes.
    if (session.status === 'done' && pendingCount(session) && store.get('sessions', session.id) === session) {
      for (const se of session.exercises) se.sets = se.sets.filter((x) => x.done);
      ctx.save();
    }
    store.flush();
  };
}

// ===========================================================================
// Resumen
// ===========================================================================
export function mountSessionSummary(root, params = {}) {
  root.classList.add('ses-view');
  return renderSummary(root, params.id);
}
