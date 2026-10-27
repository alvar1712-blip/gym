// session — registro de sesiones de fuerza (activa o edición de una pasada) y resumen al terminar.
// PROPIETARIO: módulo de sesión. Tarjetas y editor de series en ../session-view-card.js;
// resumen en ../session-view-summary.js; lógica pura en ../session-logic.js.
import * as store from '../store.js';
import {
  h, icon, header, sheet, confirmDialog, promptDialog, actionSheet, toast, undoToast,
  rpePicker, field, textInput, numInput, emptyState, scrollPageTo, focusBar, chips,
} from '../ui.js';
import { fmtDate, fmtDuration, fmtMinutes, hhmm, tsFromDate, isDateStr, deepClone, parseNum, plural, todayStr } from '../util.js';
import { orderKeyOf, bestsForExercise, addToBests, detectPRs, isWorkSet, makeBodyweightFn, setProgress, setupKey, setupOptions, sessionPRs } from '../calc.js';
import { pickMessage, mainRecord } from '../celebrate-logic.js';
import { celebrate } from '../celebrate.js';

// Último mensaje de felicitación mostrado (para no repetirlo dos veces seguidas); si no se puede guardar, da igual.
const MSG_KEY = 'entreno.lastCongrats';
const lastMessage = () => { try { return localStorage.getItem(MSG_KEY); } catch { return null; } };
const rememberMessage = (m) => { try { localStorage.setItem(MSG_KEY, m); } catch { /* almacenamiento bloqueado */ } };
import { navigate, back, refresh, screenToken, backFrom, navigateFrom, replaceUrl } from '../router.js';
import { pickExercise } from '../pickers.js';
import { exerciseHistory } from '../stats.js';
import {
  lastFor, newSessionExercise, switchExercise, linkedActivities, orphanActivities, proposedDuration, lastActivityAt, finishSession,
  pendingCount, doneCount, templateDiff, applyTemplateDiff, autoDuration, syncAutoDuration, setSetup,
  listBlocks, itemStates, foldedKeys, nextPendingIndex, jumpTarget,
} from '../session-logic.js';
import {
  renderCard, activityRow, activitySummaryText, renderFoldedCard, renderFoldedGroup, renderGroupHead, reveal,
} from '../session-view-card.js';
import { renderSummary } from '../session-view-summary.js';
import { checkinCard, moveSessionCheckins } from '../checkin.js';

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
      hist: null, // datos para stats.exerciseHistory (al pedir el primero)
    };
  }
  buildSnapshot();

  const ctx = {
    session,
    labels: new Map(), // seId → 'A1'…
    editing: new Map(), // seId → setId abierto en el editor (si no, la primera pendiente)
    // Sesiones largas (ronda 8, H): bloques plegados a mano en esta pantalla (key → 'open' | 'folded'). Solo en
    // memoria: lo demás sale de los datos (hecho y cursor), así que el plegado sobrevive a una recarga sin guardar nada.
    override: new Map(),
    folded: new Set(), // última foldedKeys pintada
    /** Estado de cada ítem (session-logic.itemStates); las actividades enlazadas, solo si hay algún ítem de cardio. */
    states() {
      const lt = (eid) => store.exercise(eid)?.logType || null;
      const linkedBySe = new Map();
      if (session.exercises.some((se) => lt(se.exerciseId) === 'cardio')) {
        for (const a of linkedActivities(session, store.all('sessions'))) linkedBySe.set(a.parentItemId, (linkedBySe.get(a.parentItemId) || 0) + 1);
      }
      return itemStates(session, { logTypeOf: lt, linkedBySe });
    },
    /** Plegar/desplegar a mano un bloque; el foco vuelve a su botón (el bloque se ha vuelto a pintar). */
    toggleFold(key, open) {
      ctx.override.set(key, open ? 'open' : 'folded');
      applyFolds();
      const el = listEl.querySelector(`[data-block="${CSS.escape(key)}"]`);
      if (!el) return;
      if (open) reveal(el);
      const btn = el.querySelector('.ses-fold');
      try { btn?.focus({ preventScroll: true }); } catch { /* sin foco */ }
    },
    guardUntil: new Map(), // seId → instante hasta el que se ignora «Registrar» (doble toque)
    exercise: (eid) => store.exercise(eid),
    settings: () => store.settings(), // incrementos (redondeo del calentamiento sugerido)
    /** «Última vez» de ESTE ejercicio de la sesión (un ejercicio repetido tiene la suya). */
    lastFor(se) {
      const key = `${se.id}|${se.exerciseId}`;
      if (!snap.last.has(key)) snap.last.set(key, lastFor(se, session, snap.sessions));
      return snap.last.get(key);
    },
    /** Historial de un ejercicio (stats.exerciseHistory; solo sesiones terminadas): el «Siguiente paso» mira su progreso reciente. */
    historyFor(eid, setup = '') {
      if (!snap.hist) snap.hist = { sessions: snap.sessions, exercises: store.all('exercises'), settings: store.settings(), bodyweight: store.bodyweightList() };
      // Solo la misma configuración (máquina, polea, agarre…): el progreso no se mide entre condiciones distintas
      return exerciseHistory(snap.hist, eid, { labels: false, setup });
    },
    /** Récords de las series hechas de ese ejercicio con esa configuración en esta sesión: Map(setId → récords). */
    prsFor(eid, setup = '') {
      const ex = store.exercise(eid);
      const out = new Map();
      if (!ex) return out;
      const sk = setupKey(setup);
      const ck = `${eid}\u0000${sk}`;
      if (!snap.bests.has(ck)) snap.bests.set(ck, bestsForExercise(snap.earlier, eid, ex, { bwFn: snap.bwFn, setup: sk }));
      const bests = deepClone(snap.bests.get(ck));
      const bw = snap.bwFn(session.date);
      for (const se of session.exercises) {
        if (se.exerciseId !== eid || setupKey(se.setup) !== sk) continue;
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
      // Si el foco estaba en la tarjeta (VoiceOver, teclado), sigue en ella: si no, caería al principio de la página.
      const had = !!old && old.contains(document.activeElement);
      // Plegada (o dentro de un grupo plegado, sin tarjeta en la página): la lista entera, que recalcula el plegado
      if (old && old.dataset.folded !== '1') {
        old.replaceWith(renderCard(ctx, se));
        refreshGroupHead(se);
      } else renderList();
      updateFinishHint();
      if (had) focusInCard(se);
    },
    rerenderList: () => renderList(),
    exerciseMenu: (se) => exerciseMenu(se),
    editSetup: (se) => editSetup(se),
    cardEl: (se) => cardEl(se),
    /** Tras registrar/añadir una serie: que el botón «Registrar» del editor quede a la vista. */
    revealEditor(se) {
      const btn = cardEl(se)?.querySelector('.ses-editor .ses-register');
      if (btn) ensureVisible(btn);
    },
    /**
     * Al terminar un ejercicio: a los 350 ms (se ve antes el ✓ en la tarjeta abierta), el cursor pasa al siguiente
     * PENDIENTE (con vuelta al principio; no al índice + 1, que puede estar hecho), se pliega lo terminado y la
     * tarjeta de destino sube. Si no queda nada pendiente, nada se mueve: «Terminar» está en la barra.
     */
    scrollToNext(se) {
      if (session.status !== 'active') return;
      if (nextPendingIndex(ctx.states(), session.exercises.indexOf(se)) < 0) return;
      setTimeout(() => {
        if (unmounted || session.status !== 'active') return;
        const i = session.exercises.indexOf(se);
        const states = ctx.states();
        // Si en estos 350 ms ha vuelto a tocar la tarjeta («+ Serie», corregir una serie hecha), sigue en ella: ni se
        // pliega ni el cursor se va ni la pantalla salta (nada se mueve bajo el dedo)
        if (i < 0 || states[i] !== 'done' || ctx.editing.has(se.id)) return;
        const t = nextPendingIndex(states, i);
        if (t < 0) return;
        // El foco solo se mueve si seguía en la tarjeta recién terminada (o se había perdido): se mira ANTES de plegarla.
        const a = document.activeElement;
        const prev = cardEl(se);
        const moveFocus = !a || a === document.body || !a.isConnected || !!prev?.contains(a);
        session.cursor = t;
        ctx.saveSoon();
        applyFolds();
        revealCard(session.exercises[t], { focus: moveFocus });
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
    /**
     * Tras cambiar el ejercicio de un ítem: borra las actividades confirmadas con confirmLinked (si las hay) y
     * ofrece deshacer, que deja el ítem, el cursor y las actividades exactamente como estaban.
     */
    async afterDropLinked(se, before, acts, msg, prevCursor = null) {
      const removed = acts.length ? await dropActivities(acts) : [];
      if (removed.length) {
        syncDuration();
        if (!unmounted) ctx.rerenderCard(se); // la tarjeta ya no muestra la actividad borrada
      }
      undoToast(removed.length ? `${msg} · ${plural(removed.length, 'actividad borrada', 'actividades borradas')}` : msg, async () => {
        if (before) { for (const k of Object.keys(se)) delete se[k]; Object.assign(se, before); }
        if (prevCursor != null) session.cursor = prevCursor;
        ctx.editing.delete(se.id);
        const writes = removed.map((o) => store.restore('sessions', o)); // en memoria al instante
        if (removed.length) syncDuration();
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
  /** Límite inferior útil: encima de la barra de abajo (en una sesión en curso, la de la sesión: es la misma
   *  cápsula #tabbar en modo foco) y del teclado, si está abierto. */
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
    if (d) scrollPageTo(window.scrollY + d);
  }

  // --- cabecera con cronómetro ---
  function renderHeader() {
    const active = session.status === 'active';
    const sub = h('span.ses-subtitle', fmtDate(session.date, 'short'));
    if (active && session.startedAt) sub.append(' · ', clockEl);
    else if (active) sub.append(' · a posteriori');
    else sub.append(` · ${session.durationMin != null ? fmtMinutes(session.durationMin) : 'terminada'}`);
    // En curso, «Terminar» está en la barra de la sesión (abajo, a mano): la cabecera deja sitio al nombre.
    const actions = [];
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

  // --- lista de ejercicios (secciones y bloques: ejercicios sueltos y superseries/circuitos) ---
  function renderList() {
    const exs = session.exercises;
    const out = [];
    const blocks = listBlocks(exs);
    const states = ctx.states();
    ctx.folded = foldedKeys(session, states, { editing: ctx.editing, override: ctx.override });
    ctx.labels.clear();
    for (const b of blocks) {
      if (b.groupId) for (let k = b.start; k < b.end; k++) ctx.labels.set(exs[k].id, `${b.letter}${k - b.start + 1}`);
    }
    for (const b of blocks) {
      const se = exs[b.start];
      if (se.section && se.section !== exs[b.start - 1]?.section) out.push(h('h2.section-title.ses-section', se.section));
      out.push(renderBlock(b, states));
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

  /**
   * Un bloque: la tarjeta (o su línea plegada) de un ejercicio suelto, o el grupo (abierto o plegado). Lleva
   * data-block (su clave) y data-folded, para que applyFolds cambie solo los bloques que se pliegan o despliegan.
   */
  function renderBlock(b, states, folded = ctx.folded.has(b.key)) {
    const exs = session.exercises;
    if (!b.groupId) return folded ? renderFoldedCard(ctx, exs[b.start]) : renderCard(ctx, exs[b.start]);
    const members = exs.slice(b.start, b.end);
    if (folded) return renderFoldedGroup(ctx, b, members);
    return h('div.ses-group', { dataset: { group: b.groupId, block: b.key, folded: '0' } },
      renderGroupHead(ctx, b, members, groupFoldable(b, states)),
      members.map((x) => renderCard(ctx, x)));
  }
  /** ¿El grupo abierto lleva el botón de plegar? Sesión en curso y todos sus ejercicios hechos. */
  function groupFoldable(b, states) {
    if (session.status !== 'active') return false;
    for (let k = b.start; k < b.end; k++) if (states[k] !== 'done') return false;
    return true;
  }
  /** Tras volver a pintar una tarjeta de un grupo abierto: su cabecera (lleva el botón de plegar si ya está hecho). */
  function refreshGroupHead(se) {
    const groupEl = cardEl(se)?.closest('.ses-group[data-block]');
    if (!groupEl) return;
    const b = listBlocks(session.exercises).find((x) => x.key === groupEl.dataset.block);
    const head = groupEl.querySelector(':scope > .ses-group-head');
    if (!b || !head) return;
    head.replaceWith(renderGroupHead(ctx, b, session.exercises.slice(b.start, b.end), groupFoldable(b, ctx.states())));
  }
  /**
   * Recalcula el plegado y cambia SOLO los bloques que pasan de plegado a abierto o al revés (las demás tarjetas no
   * se vuelven a pintar: cada una consulta su historial).
   */
  function applyFolds() {
    const states = ctx.states();
    const next = foldedKeys(session, states, { editing: ctx.editing, override: ctx.override });
    for (const b of listBlocks(session.exercises)) {
      const now = next.has(b.key);
      const el = listEl.querySelector(`[data-block="${CSS.escape(b.key)}"]`);
      if (!el || (el.dataset.folded === '1') === now) continue;
      el.replaceWith(renderBlock(b, states, now));
    }
    ctx.folded = next;
    updateFinishHint();
  }
  /**
   * Sube la tarjeta del ejercicio bajo la cabecera; si así su «Registrar» quedara bajo la barra de abajo, un poco
   * más. Con `focus`, el foco pasa a la tarjeta (focusInCard). Sin animación con «reducir movimiento».
   */
  function revealCard(se, { focus = false } = {}) {
    const el = se && cardEl(se);
    if (!el) return;
    let top = el.getBoundingClientRect().top + window.scrollY - headerBottom() - 8;
    const btn = el.querySelector('.ses-editor .ses-register');
    if (btn) {
      const over = btn.getBoundingClientRect().bottom + window.scrollY - top - visibleBottom();
      if (over > 0) top += over;
    }
    scrollPageTo(top);
    if (focus) focusInCard(se);
  }
  /** ¿Se ve la tarjeta del ejercicio (su «Registrar», o la cabecera si no tiene editor) entre la cabecera y la barra? */
  function cardOnScreen(se) {
    const el = se && cardEl(se);
    if (!el) return false;
    const r = (el.querySelector('.ses-editor .ses-register') || el.querySelector('.ses-card-head') || el).getBoundingClientRect();
    return r.height > 0 && r.top >= headerBottom() - 1 && r.bottom <= visibleBottom() + 12;
  }
  const cursorIndex = () => {
    const c = session.cursor;
    return Number.isInteger(c) && c >= 0 && c < session.exercises.length ? c : 0;
  };
  /**
   * «Siguiente pendiente» (barra de la sesión): la tarjeta del cursor si no está hecha y no se ve; si no, el siguiente
   * ejercicio sin terminar (con vuelta). El cursor va con él: tocar otra vez lleva al siguiente.
   */
  function jumpToPending() {
    const states = ctx.states();
    const c = cursorIndex();
    const t = jumpTarget(states, c, cardOnScreen(session.exercises[c]));
    if (t < 0) return;
    session.cursor = t;
    ctx.saveSoon();
    applyFolds();
    revealCard(session.exercises[t], { focus: true });
  }

  const cardEl = (se) => listEl.querySelector(`[data-se="${CSS.escape(se.id)}"]`);
  /** Foco en la tarjeta: «Registrar» del editor, si no la primera serie, «+ Serie», el botón de desplegar o la propia tarjeta. */
  function focusInCard(se) {
    const card = cardEl(se);
    if (!card) return;
    const target = card.querySelector('.ses-editor .ses-register') || card.querySelector('.ses-row[data-set]')
      || card.querySelector('.ses-add-set, .ses-cardio-btn') || card.querySelector('.ses-fold') || card;
    try { target.focus({ preventScroll: true }); } catch { /* sin foco: no pasa nada */ }
  }
  function scrollToEl(el, smooth) {
    const top = el.getBoundingClientRect().top + window.scrollY - (headerEl?.offsetHeight || 0) - 8;
    if (smooth) scrollPageTo(top);
    else window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
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
    updateFocusBar();
  }

  // --- modo foco: en curso, la barra de pestañas pasa a ser la barra de la sesión ---
  // Dice que estás en una sesión y cuántas series llevas (la misma cuenta que Hoy), y lleva «Terminar». No
  // encierra: «Hoy» sale sin cerrar nada (la sesión sigue abierta y Hoy la muestra arriba, con «Continuar»);
  // fuera de esta pantalla vuelven las pestañas. Sin cronómetro de descanso (el de la sesión va en la cabecera).
  // Ronda 8 (H): el centro de la barra es además el salto al «Siguiente pendiente» (⌄ junto a «En sesión»: a 375 px
  // no cabe junto a «n/N series» sin partirlo; sin sitio nuevo).
  // Nodos fijos: updateFocusBar corre en cada fotograma de desplazamiento y antes sustituía la cuenta entera
  // (replaceChildren). Si eso caía entre pointerdown y pointerup de un toque en el botón —p. ej. con la cola de un
  // desplazamiento anterior—, el nodo bajo el dedo quedaba fuera del DOM y el navegador no lanzaba `click`: el toque
  // en «Siguiente pendiente» se perdía. Ahora solo cambia el texto, y solo si cambia.
  const fbCountNum = document.createTextNode('');
  const fbCountUnit = h('span.fb-count-unit', ' series');
  const fbCount = h('span.fb-count.tnum', { 'aria-hidden': 'true' }, fbCountNum);
  // Dos ⌄ y se ve uno: junto a «En sesión» (texto normal) o junto a «n/N» con texto grande (ahí «series» se oculta y
  // queda sitio; «En sesión ⌄» se partiría en dos líneas)
  const fbChev = h('span.fb-next-chev', { 'aria-hidden': 'true' }, icon('chevron-down', 16));
  const fbChevL = h('span.fb-next-chev.fb-next-chev-lg', { 'aria-hidden': 'true' }, icon('chevron-down', 16));
  const fbCountSr = h('span.sr-only');
  const fbNext = h('button.fb-status.fb-next', { type: 'button', onClick: jumpToPending },
    h('span.fb-line', h('span.fb-kicker', { 'aria-hidden': 'true' }, 'En sesión'), fbChev), h('span.fb-line', fbCount, fbChevL), fbCountSr);
  const focusEl = h('div.focusbar',
    h('button.fb-exit', {
      type: 'button',
      'aria-label': 'Ir a Hoy. La sesión sigue abierta',
      onClick: () => navigate('#/today', { transition: 'pop' }),
    }, icon('chevron-left', 22), h('span.fb-exit-label', 'Hoy')),
    fbNext,
    h('button.btn.btn-primary.fb-finish.ses-finish-bar', { type: 'button', 'aria-label': 'Terminar sesión', onClick: openFinish },
      icon('flag', 18), h('span', 'Terminar')));
  // ¿Se veía la tarjeta del cursor en la última medida? (la mide el fotograma siguiente; ver updateFocusBar)
  let fbCursorVisible = false;
  /**
   * Cuenta, estado y etiqueta de «Siguiente pendiente». Si `measure` no es true NO mide nada (usa la última
   * visibilidad conocida) y pide la medida para el fotograma siguiente: se llama al pintar la lista, y medir ahí
   * (getBoundingClientRect) forzaba un layout síncrono de la lista a medio montar — ~110 ms con la CPU ×4 al abrir
   * una sesión de 12 ejercicios. La etiqueta solo depende de esa medida en el nombre del destino.
   */
  function updateFocusBar(measure = false) {
    const { done, total } = setProgress(session);
    // Con texto grande la palabra «series» cede sitio (css: .fb-count-unit); VoiceOver lee fbCountSr.
    setText(fbCountNum, total ? `${done}/${total}` : 'Sin series');
    if (!total) fbCountUnit.remove();
    else if (fbCountUnit.parentNode !== fbCount) fbCount.append(fbCountUnit);
    if (session.status !== 'active') return; // sin barra (sesión terminada): no hace falta medir nada
    const count = total ? `${done} de ${total} series hechas.` : 'Sin series.';
    const c = cursorIndex();
    if (measure) fbCursorVisible = cardOnScreen(session.exercises[c]);
    else scheduleFocusBar();
    const t = jumpTarget(ctx.states(), c, fbCursorVisible);
    const target = t >= 0 ? session.exercises[t] : null;
    fbNext.disabled = !target;
    fbChev.hidden = !target;
    fbChevL.hidden = !target;
    if (target) {
      const name = store.exercise(target.exerciseId)?.name || target.exName || 'Ejercicio';
      setText(fbCountSr, `En sesión. Siguiente pendiente: ${name}. ${count}`);
      if (fbNext.title !== 'Ir al siguiente pendiente') fbNext.title = 'Ir al siguiente pendiente';
    } else {
      setText(fbCountSr, `En sesión. ${count} No queda ningún ejercicio pendiente.`);
      fbNext.removeAttribute('title');
    }
  }
  /** Cambia el texto de un nodo solo si cambia (sin rehacer nodos en cada fotograma de desplazamiento). */
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  // El destino puede depender de si se ve la tarjeta del cursor: la etiqueta se actualiza al desplazar y tras cada
  // cambio (una vez por fotograma como mucho, solo en curso), midiendo cuando el layout del fotograma ya toca.
  let fbRaf = 0;
  function scheduleFocusBar() {
    if (fbRaf || unmounted || session.status !== 'active') return;
    fbRaf = requestAnimationFrame(() => { fbRaf = 0; if (!unmounted) updateFocusBar(true); });
  }
  const onScroll = scheduleFocusBar;
  window.addEventListener('scroll', onScroll, { passive: true });

  function renderFooter() {
    const active = session.status === 'active';
    return h('div.ses-footer',
      h('button.btn.btn-secondary.btn-lg.btn-block.ses-add-ex', { type: 'button', onClick: addExercise }, icon('plus', 22), 'Añadir ejercicio'),
      field('Nota de la sesión', notesEl),
      active
        ? h('div.stack-sm',
          h('button.btn.btn-primary.btn-lg.btn-block.ses-finish', { type: 'button', onClick: openFinish }, icon('flag', 22), 'Terminar sesión'),
          finishHint)
        : h('button.btn.btn-secondary.btn-lg.btn-block.ses-to-summary', { type: 'button', onClick: () => navigate(`#/session/${session.id}/summary?from=session`) }, icon('chart', 22), 'Ver resumen'));
  }

  function renderAll() {
    renderHeader();
    const intro = session.status === 'active' && !session.startedAt
      ? h('div.banner.banner-info.ses-past-banner', h('div.banner-main',
        h('div.banner-text', `Sesión del ${fmtDate(session.date, 'long')} registrada a posteriori: sin cronómetro; la duración se indica al terminar.`)))
      : null;
    // Check-in opcional «¿Cómo llegas hoy?»: plegado (una franja), no añade ningún toque para registrar series.
    // Solo con cronómetro: en una sesión a posteriori ya está el aviso de arriba y la franja empujaría «Registrar
    // serie 1» bajo las pestañas en un iPhone SE; ahí «¿Cómo llegaste?» va en la hoja de terminar, con el «después».
    const checkin = session.status === 'active' && session.startedAt
      ? checkinCard({ date: session.date, timing: 'pre', sessionId: session.id }) : null;
    content.replaceChildren(...[intro, checkin, listEl, orphansEl, renderFooter()].filter(Boolean));
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
        ex && ex.logType !== 'cardio' ? { label: se.setup ? 'Cambiar material o configuración' : 'Material o configuración', icon: 'sliders', hint: se.setup || null, onClick: () => editSetup(se) } : null,
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
    const before = deepClone(se);
    const prevCursor = session.cursor;
    switchExercise(se, eid, session);
    ctx.editing.delete(se.id);
    ctx.touch(se);
    ctx.save();
    ctx.rerenderCard(se);
    ctx.afterDropLinked(se, before, dropped, `Cambiado a «${store.exercise(eid)?.name || eid}»`, prevCursor);
  }

  /** Material o configuración (máquina, polea, agarre, sistema de lastre…): récords y progreso solo se comparan con la misma. */
  function editSetup(se) {
    const options = setupOptions(store.all('sessions'), se.exerciseId, { excludeSessionId: session.id });
    const apply = (v) => {
      setSetup(se, v, session);
      ctx.touch(se);
      ctx.save();
      ctx.rerenderCard(se);
    };
    sheet({
      title: 'Material o configuración',
      body: (close) => {
        const input = textInput({ value: se.setup || '', placeholder: 'Máquina, polea, agarre, lastre…', maxlength: 40, ariaLabel: 'Material o configuración' });
        const go = (v) => { close(); apply(v); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(input.value); });
        const cur = options.find((o) => o.key === setupKey(se.setup));
        return h('div.stack.ses-setup-sheet',
          h('p.sheet-msg', 'Los récords y el progreso solo se comparan con la misma configuración. Lo que ya tienes sin configuración no cambia.'),
          options.length ? chips({ options: options.map((o) => ({ value: o.label, label: o.label })), value: cur ? cur.label : null, ariaLabel: 'Configuraciones usadas', className: 'ses-setup-chips', onChange: go }) : null,
          field(options.length ? 'Otra' : 'Configuración', input),
          h('div.sheet-actions.sheet-actions-inline',
            h('button.btn.btn-block.btn-primary.ses-setup-save', { type: 'button', onClick: () => go(input.value) }, 'Guardar'),
            se.setup ? h('button.btn.btn-block.btn-secondary.ses-setup-clear', { type: 'button', onClick: () => go('') }, 'Sin especificar') : null));
      },
    });
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
    const prevCursor = session.cursor;
    session.exercises.splice(i, 1);
    session.cursor = Math.max(0, Math.min(session.cursor || 0, session.exercises.length - 1));
    ctx.save();
    renderList();
    const removed = dropped.length ? await dropActivities(dropped) : [];
    if (removed.length) {
      syncDuration();
      if (!unmounted) renderList(); // sin la actividad ya borrada en «Otras actividades de esta sesión»
    }
    undoToast(removed.length ? `«${name}» y ${plural(removed.length, 'su actividad', 'sus actividades')} quitados de la sesión` : `«${name}» quitado de la sesión`, async () => {
      session.exercises.splice(Math.min(i, session.exercises.length), 0, se);
      session.cursor = prevCursor;
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
        active ? null : { label: 'Ver resumen', icon: 'chart', onClick: () => navigate(`#/session/${session.id}/summary?from=session`) },
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
      moveSessionCheckins(session.id, old, v); // su check-in (antes / después) va con ella
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
    const tok = screenToken();
    try {
      for (const a of acts) removed.push(await store.remove('sessions', a.id));
      removed.unshift(await store.remove('sessions', session.id));
    } catch {
      return; // app.js ya avisa del error de guardado
    }
    const wasActive = session.status === 'active';
    if (wasActive) navigateFrom(tok, '#/today', { replace: true });
    else backFrom(tok, '#/today');
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
    // Sesión olvidada abierta (más de una hora sin registrar nada): lo dice y propone hasta lo último registrado.
    const openFor = pd.elapsedMin >= 180 ? `${Math.floor(pd.elapsedMin / 60)} h` : fmtMinutes(pd.elapsedMin);
    if (!live) {
      explain = 'Sesión registrada a posteriori: indica cuánto duró la fuerza (sin el cardio que registres aparte).';
    } else if (pd.stale && pd.proposed == null) {
      explain = `La sesión lleva abierta ${openFor} y no hay ninguna serie registrada con hora: indica cuánto duró la fuerza (sin el cardio que registres aparte).`;
    } else if (pd.stale) {
      const what = lastActivityAt(session, []) === pd.lastAt ? 'tu última serie' : 'tu última actividad enlazada';
      const minus = pd.activitiesMin > 0 ? ` − ${pd.activitiesMin} min de ${acts.length === 1 ? 'la actividad enlazada' : 'las actividades enlazadas'} = ${pd.proposed} min` : '';
      explain = `La sesión lleva abierta ${openFor}: propuesta hasta ${what} (${hhmm(session.startedAt)}–${hhmm(pd.endAt)})${minus}. Revísala.`;
    } else if (acts.length && pd.activitiesMin > 0) {
      explain = `${pd.elapsedMin} min desde el inicio − ${pd.activitiesMin} min de ${acts.length === 1 ? 'la actividad enlazada' : 'las actividades enlazadas'} (se cuentan aparte) = ${pd.proposed} min.`;
    } else {
      explain = `${pd.elapsedMin} min desde que empezaste (${hhmm(session.startedAt)}). Puedes ajustarlo.`;
    }
    const durErr = h('p.form-error.ses-dur-error', { hidden: true, role: 'alert' });
    const durInp = numInput({
      value: dur, decimals: 0, inputmode: 'numeric', suffix: 'min', placeholder: pd.proposed != null ? String(pd.proposed) : 'Minutos', ariaLabel: 'Duración en minutos',
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
        // A posteriori (sin cronómetro), también «¿Cómo llegaste?» (el «antes» no se ofrece arriba de la sesión).
        session.startedAt ? null
          : checkinCard({ date: session.date, timing: 'pre', sessionId: session.id, compact: true, title: '¿Cómo llegaste?' }),
        checkinCard({ date: session.date, timing: 'post', sessionId: session.id, compact: true }), // «¿Cómo ha ido?», opcional
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
          // Olvidada abierta: termina donde acaba la propuesta (o lo indicado), no ahora; así la duración automática
          // no vuelve a «hasta ahora» si después cambia una actividad enlazada.
          const endedAt = !fresh.stale ? now
            : fresh.endAt ?? Math.min(now, session.startedAt + (Math.max(0, minutes) + fresh.activitiesMin) * 60000);
          // finishSession muta la sesión (descarta series pendientes y la marca terminada) y el guardado puede fallar:
          // con una copia previa se vuelve exactamente al estado anterior para poder reintentar sin perder nada.
          // Mientras se guarda, `status` ya no es 'active': un segundo toque cae en el guard de arriba (sin duplicar).
          const before = deepClone(session);
          finishSession(session, { durationMin: minutes, rpe, notes: session.notes, now, endedAt, auto });
          try {
            await store.save('sessions', session);
          } catch (err) {
            for (const k of Object.keys(session)) delete session[k];
            Object.assign(session, before);
            durErr.textContent = 'No se pudo guardar la sesión. No se ha perdido nada: vuelve a pulsar «Terminar sesión».';
            durErr.hidden = false;
            return; // la hoja sigue abierta; el aviso de error ya lo muestra app.js
          }
          clearInterval(timer);
          close();
          await askTemplateChanges();
          const message = pickMessage(Math.random, lastMessage());
          rememberMessage(message);
          const record = celebrationRecord(session);
          // La felicitación cubre la pantalla y el resumen se monta debajo: al terminar (o al omitirla) ya está listo.
          const shown = celebrate({ message, record });
          navigate(`#/session/${session.id}/summary`, { replace: true });
          await shown;
        },
      }],
    });
  }

  /** Texto de un récord en un ejercicio PRINCIPAL de esta sesión (celebrate-logic.MAIN_LIFTS), o null. Nunca rompe el cierre. */
  function celebrationRecord(s) {
    try {
      const exMap = new Map(store.all('exercises').map((e) => [e.id, e]));
      const bwFn = makeBodyweightFn(store.bodyweightList(), store.settings()?.bodyweightDefault ?? 75);
      return mainRecord(s, sessionPRs(s, store.all('sessions'), exMap, bwFn), (id) => exMap.get(id))?.text ?? null;
    } catch (err) {
      console.error('[celebrar] récord', err);
      return null;
    }
  }

  /** Si la sesión difiere de su plantilla, pregunta qué cambios aplicar. */
  function askTemplateChanges() {
    const tpl = session.templateId ? store.get('templates', session.templateId) : null;
    if (!tpl) return Promise.resolve(false);
    const changes = templateDiff(tpl, session, { nameOf: (eid) => store.exercise(eid)?.name });
    if (!changes.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      // Segura por defecto: cambiar y añadir vienen marcados; quitar y reordenar, no (saltarse hoy un ejercicio o
      // cambiar el orden un día no es querer cambiar la rutina).
      const checks = changes.map((c) => {
        const box = h('input.ses-check-input', { type: 'checkbox', checked: c.type === 'swap' || c.type === 'add', dataset: { change: c.id } });
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
  if (session.status === 'active') focusBar(focusEl);
  // «Terminar» desde Hoy (sesión olvidada abierta): directo a la hoja; la URL vuelve a la de la sesión.
  if (params.finish && session.status === 'active') {
    replaceUrl(`#/session/${session.id}`);
    openFinish();
  }
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
    focusBar(null);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('scroll', onScroll);
    if (fbRaf) cancelAnimationFrame(fbRaf);
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
