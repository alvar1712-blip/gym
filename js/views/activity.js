// activity.js — registro rápido de carrera, bici, natación, senderismo y otras actividades (estilo Strava).
// Obligatorios: tipo, fecha y duración. La actividad se crea en cuanto es válida y desde ahí
// cada cambio se guarda al instante; antes se conserva un borrador en localStorage.
import * as store from '../store.js';
import { back, navigate, refresh, replaceUrl } from '../router.js';
import {
  h, icon, header, segmented, chips, rpePicker, durationInput, field, textInput, numInput,
  confirmDialog, undoToast, emptyState, toast, confirmRare,
} from '../ui.js';
import { todayStr, fmtDate, uid, fmtDuration, fmtMinutes, debounce, isDateStr, hhmm, relDay, deepClone, dateFromTs } from '../util.js';
import { SWIM_STROKES } from '../seed.js';
import * as L from '../activity-logic.js';
import { syncLinkedDuration } from '../session-logic.js';
import { checkActivity, split } from '../sanity.js';

const DRAFT_PREFIX = 'draft:activity:';
const DRAFT_TTL = 48 * 3600 * 1000; // un borrador de hace más de 2 días ya no se ofrece

// ---------------------------------------------------------------------------
// Borradores (antes de que la actividad sea válida)
// ---------------------------------------------------------------------------
function readDraft(kind) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + kind);
    const d = raw ? JSON.parse(raw) : null;
    if (!d || !d.form || Date.now() - (d.savedAt || 0) > DRAFT_TTL) return null;
    return d;
  } catch { return null; }
}
function writeDraft(form, ctx) {
  try { localStorage.setItem(DRAFT_PREFIX + form.kind, JSON.stringify({ form, ctx, savedAt: Date.now() })); } catch { /* sin almacenamiento */ }
}
function clearDraft(kind) {
  try { localStorage.removeItem(DRAFT_PREFIX + kind); } catch { /* sin almacenamiento */ }
}
const sameCtx = (a, b) => !!a && a.parent === b.parent && a.item === b.item && (!b.qdate || a.qdate === b.qdate);
/** Borra el borrador de ese tipo solo si es de esta misma pantalla (no el de otra actividad). */
function clearOwnDraft(kind, ctx) {
  if (sameCtx(readDraft(kind)?.ctx, ctx)) clearDraft(kind);
}

/**
 * Formulario prellenado de partida para un tipo (lo que no ha escrito el usuario): en una actividad
 * enlazada, el tipo de sesión sale de las notas del ítem de la plantilla («Zona 2» → z2).
 */
function baseForKind(base, se, kind) {
  if (!base) return null;
  if (kind === base.kind) return base;
  return { ...base, kind, subtype: se ? L.subtypeFromNotes(kind, se.notes) : null };
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

/**
 * #/activity/new?kind=&date=&planDate=&parent=&item=  → actividad nueva
 * #/activity/:id                                      → editar (fuerza → #/session/:id)
 */
export function mountActivity(root, params = {}) {
  const id = params.id;
  if (id) {
    const rec = store.get('sessions', id);
    if (!rec) {
      root.replaceChildren(header({ title: 'Actividad', back: '#/today' }), h('div.content',
        emptyState({ emoji: '🔎', title: 'No se encontró la actividad', text: 'Puede que se haya borrado.', action: { label: 'Ir a Hoy', onClick: () => navigate('#/today', { replace: true }) } })));
      return;
    }
    if (rec.kind === 'strength') {
      navigate(`#/session/${rec.id}`, { replace: true });
      return;
    }
    // Una actividad enlazada es la del ítem de la sesión de fuerza («Correr»): no cambia de deporte.
    return mountForm(root, { record: rec, form: L.formFromRecord(rec), showKindPicker: !rec.parentId });
  }
  return mountForm(root, newContext(params));
}

/** Contexto de una actividad nueva a partir de la query (incluye enlace a sesión de fuerza). */
function newContext(params) {
  let kind = L.isActivityKind(params.kind) ? params.kind : null;
  let date = isDateStr(params.date) ? params.date : todayStr();
  let planDate = isDateStr(params.planDate) ? params.planDate : undefined;
  let parent = params.parent ? store.get('sessions', params.parent) : null;
  if (parent && parent.kind !== 'strength') parent = null;
  const se = parent && params.item ? (parent.exercises || []).find((x) => x.id === params.item) || null : null;
  if (parent) {
    // Hereda fecha y fecha de plan de la sesión padre.
    date = parent.date;
    planDate = parent.planDate ?? null;
    if (!kind && se) {
      const sport = store.exercise(se.exerciseId)?.sport;
      if (L.isActivityKind(sport)) kind = sport;
    }
  }
  const showKindPicker = !kind;
  const draftCtx = { parent: parent ? parent.id : null, item: parent ? params.item || null : null, qdate: params.date || null };

  let form = L.emptyForm(kind || 'run', { date, planDate });
  if (parent) {
    form.parentId = parent.id;
    form.parentItemId = se ? se.id : params.item || null;
    form.templateItemId = se?.templateItemId ?? null;
    if (se) form.subtype = L.subtypeFromNotes(form.kind, se.notes);
  } else if (kind && params.subtype && (L.SUBTYPE_OPTIONS[kind] || []).some((o) => o.id === params.subtype)) {
    // Es parte de lo prellenado (base): no cuenta como algo escrito para el borrador.
    form.subtype = params.subtype;
  }
  const base = { ...form };

  // ¿Hay un borrador de esta misma pantalla? (con tipo fijo, solo el de ese tipo)
  let restored = false;
  let best = null;
  for (const k of kind ? [kind] : L.ACTIVITY_KINDS) {
    const d = readDraft(k);
    if (d && sameCtx(d.ctx, draftCtx) && (!best || d.savedAt > best.savedAt)) best = d;
  }
  if (best && L.hasContent(best.form, baseForKind(base, se, best.form.kind))) {
    form = { ...base, ...best.form, kind: best.form.kind };
    if (parent) Object.assign(form, { date: base.date, planDate: base.planDate, planFollows: base.planFollows, parentId: base.parentId, parentItemId: base.parentItemId, templateItemId: base.templateItemId });
    restored = best.savedAt;
  }
  return { record: null, form, base, showKindPicker, parent, se, draftCtx, restored };
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------
function mountForm(root, ctx) {
  const form = ctx.form;
  let record = ctx.record; // objeto del store; null hasta que la actividad es válida
  let removed = false;
  let pendingSoon = false; // hay un saveSoon sin escribir aún en disco
  let unsaved = false; // el último cambio no se escribió por un dato imposible
  const parent = ctx.parent || (form.parentId ? store.get('sessions', form.parentId) : null);
  const parentSe = ctx.se || (parent && form.parentItemId ? (parent.exercises || []).find((x) => x.id === form.parentItemId) : null);
  const backFallback = form.parentId ? `#/session/${form.parentId}` : '#/today';
  const refs = {};
  let alive = true;
  // Duración de la fuerza de la sesión padre al abrir (para avisar si se recalcula al guardar esta actividad).
  const parentMinAtOpen = parent ? parent.durationMin ?? null : null;
  /** Recalcula la duración automática de la fuerza de la sesión padre ya terminada (no cuenta dos veces). */
  const syncParent = () => { if (form.parentId) syncLinkedDuration(form.parentId); };
  // Tipo de sesión elegido en cada deporte, para no perderlo al cambiar de tipo e ir y volver.
  const subtypeMemo = {};
  const resetMemo = () => { Object.keys(subtypeMemo).forEach((key) => delete subtypeMemo[key]); subtypeMemo[form.kind] = form.subtype; };
  resetMemo();
  const baseFor = (kind) => baseForKind(ctx.base, parentSe, kind);
  /** ¿Hay algo escrito por el usuario (no solo lo prellenado)? */
  const userContent = () => L.hasContent(form, baseFor(form.kind));

  // ---------- cabecera ----------
  const trashBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Borrar actividad', title: 'Borrar actividad', hidden: !record, onClick: () => removeActivity() }, icon('trash', 22));
  const hdr = header({ title: '', subtitle: '', back: backFallback, actions: [trashBtn] });
  const titleEl = hdr.querySelector('h1');
  const subEl = hdr.querySelector('.topbar-sub') || h('div.topbar-sub');
  if (!subEl.parentNode) hdr.querySelector('.topbar-titles').appendChild(subEl);

  const content = h('div.content.act-screen');
  root.replaceChildren(hdr, content);

  // ---------- selector de tipo ----------
  const kindSeg = ctx.showKindPicker
    ? segmented({
        options: L.ACTIVITY_KINDS.map((k) => ({ value: k, label: L.KIND_UI[k].seg })),
        value: form.kind,
        ariaLabel: 'Tipo de actividad',
        onChange: (k) => switchKind(k),
      })
    : null;
  if (kindSeg) kindSeg.classList.add('act-kinds');
  // Actividad nueva y suelta: se puede traer desde un archivo del reloj o de Strava/Garmin.
  const importLink = !record && !form.parentId
    ? h('button.cal-link-btn.act-import-link', { type: 'button', onClick: () => navigate('#/import') },
      'Importar desde archivo (GPX, TCX, FIT)', icon('chevron-right', 18))
    : null;

  // ---------- enlace con la sesión de fuerza ----------
  let linkBanner = null;
  if (form.parentId) {
    const tgt = parentSe ? L.targetText(parentSe.target) : '';
    const bits = [parent ? fmtDate(parent.date, 'short') : null, tgt ? `Objetivo ${tgt}` : null, parentSe?.notes || null].filter(Boolean);
    linkBanner = h('div.banner.banner-info.act-link',
      icon('link', 22),
      h('div.banner-main',
        h('div.banner-title', parent ? `Parte de «${parent.templateName || 'Sesión de fuerza'}»` : 'Enlazada a una sesión de fuerza'),
        bits.length ? h('div.banner-text', bits.join(' · ')) : null));
  }

  // Aviso de borrador recuperado (dentro del formulario, lejos de «Listo»).
  let restoredBanner = null;
  if (ctx.restored) {
    const when = ctx.restored;
    restoredBanner = h('div.banner.banner-info.act-restored',
      h('div.banner-main',
        h('div.banner-title', 'Borrador recuperado'),
        typeof when === 'number' ? h('div.banner-text', `Guardado ${relDay(dateFromTs(when))} a las ${hhmm(when)}.`) : null),
      h('button.btn.btn-secondary.act-restored-discard', { type: 'button', onClick: () => discardDraft() }, 'Descartar'));
  }

  const body = h('div.act-body');
  const deleteBtn = h('button.btn.btn-danger-ghost.btn-block.act-delete', { type: 'button', hidden: !record, onClick: () => removeActivity() }, icon('trash', 20), 'Borrar actividad');
  const discardBtn = h('button.btn.btn-ghost.btn-block.act-discard', { type: 'button', hidden: true, onClick: () => discardDraft() }, 'Descartar borrador');
  const statusEl = h('div.act-status', { role: 'status', 'aria-live': 'polite' });
  const doneBtn = h('button.btn.btn-primary.btn-lg.act-done', { type: 'button', onClick: () => done() }, icon('check', 22), 'Listo');
  const footer = h('div.act-footer', statusEl, doneBtn);
  content.append(...[kindSeg, importLink, restoredBanner, linkBanner, body, deleteBtn, discardBtn, footer].filter(Boolean));

  const saveDraftSoon = debounce(() => storeDraft(), 300);
  /** Borrador en localStorage (síncrono): lo escrito, o nada si no queda nada escrito. */
  function storeDraft() {
    if (record || removed) return;
    if (userContent()) writeDraft(form, ctx.draftCtx);
    else clearOwnDraft(form.kind, ctx.draftCtx);
  }

  buildBody();
  paintTitle();
  updateLive();
  updateStatus();

  // Al pasar a segundo plano o cerrar la app se guarda ya (sin esperar al retardo del borrador).
  const saveNow = () => {
    if (removed) return;
    saveDraftSoon.cancel();
    if (record) flushRecord();
    else storeDraft();
  };
  const onVisibility = () => { if (document.visibilityState === 'hidden') saveNow(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', saveNow);

  // ---------- construcción de la parte dependiente del tipo ----------
  function buildBody() {
    const k = form.kind;
    const ui = L.KIND_UI[k];
    Object.keys(refs).forEach((key) => delete refs[key]);

    // Lo esencial: fecha, duración, distancia
    const essentials = h('div.card.act-card');
    // En una actividad enlazada la fecha es la de la sesión (se ve en la cabecera y el aviso).
    if (!form.parentId) {
      const dateInp = h('input.input.act-date', {
        type: 'date', value: form.date || '', max: todayStr(), 'aria-label': 'Fecha', required: true,
      });
      const onDate = () => {
        const v = dateInp.value;
        if (v === form.date) return; // 'input' y 'change' llegan juntos en algunos navegadores
        if (isDateStr(v) && v > todayStr()) {
          dateInp.value = form.date || '';
          toast('La fecha no puede ser futura.', { kind: 'error' });
          return;
        }
        if (isDateStr(v)) { form.date = v; change({}, true); paintTitle(); } else { updateStatus(); }
      };
      dateInp.addEventListener('change', onDate);
      dateInp.addEventListener('input', onDate);
      essentials.appendChild(field('Fecha', dateInp));
    }

    const durCtl = durationInput({ seconds: form.movingSec, ariaLabel: ui.durLabel, onChange: (sec) => change({ movingSec: sec }) });
    refs.dur = durCtl;
    refs.durHint = h('span.field-hint.act-dur-hint');
    essentials.appendChild(h('div.field', h('span.field-label', ui.durLabel, h('span.act-req', ' · obligatorio')), durCtl, refs.durHint));

    if (k === 'swim') {
      const m = form.distanceKm != null ? Math.round(form.distanceKm * 1000) : null;
      essentials.appendChild(field('Distancia', numInput({ value: m, decimals: 0, inputmode: 'numeric', suffix: 'm', ariaLabel: 'Distancia (m)', placeholder: 'p. ej. 1500', onInput: (v) => change({ distanceKm: v != null && v > 0 ? v / 1000 : null }) })));
    } else if (k !== 'other') {
      essentials.appendChild(field('Distancia', numInput({ value: form.distanceKm, decimals: 2, inputmode: 'decimal', suffix: 'km', ariaLabel: 'Distancia (km)', placeholder: 'p. ej. 10,5', onInput: (v) => change({ distanceKm: v }) })));
    }

    // Métricas en vivo: ritmo / velocidad / ritmo 100 m + carga
    refs.metricVal = h('div.act-live-value');
    refs.metricSub = h('div.act-live-sub');
    refs.loadVal = h('div.act-live-value.act-load');
    refs.loadSub = h('div.act-live-sub');
    const metric = L.primaryMetric(form);
    const live = h(`div.act-live${metric ? '' : '.act-live-single'}`,
      metric ? h('div.act-live-item', h('div.act-live-label', metric.label), refs.metricVal, refs.metricSub) : null,
      h('div.act-live-item', h('div.act-live-label', 'Carga'), refs.loadVal, refs.loadSub));

    // Esfuerzo percibido
    const rpe = h('div.card.act-card',
      h('div.field-label', 'Esfuerzo percibido (1–10)'),
      rpePicker({ value: form.rpe, onChange: (v) => change({ rpe: v }, true) }));

    const parts = [essentials, live, rpe];

    // Tipo de sesión / estilo (el senderismo no tiene)
    if (k === 'run' || k === 'bike') {
      parts.push(h('div.card.act-card',
        h('div.field-label', 'Tipo de sesión'),
        chips({ options: L.SUBTYPE_OPTIONS[k].map((o) => ({ value: o.id, label: o.label })), value: form.subtype, allowNone: true, onChange: (v) => change({ subtype: v }, true) })));
    } else if (k === 'swim') {
      parts.push(swimCard());
    } else if (k === 'other') {
      parts.push(otherTypeCard());
    }

    // Datos opcionales (tipo Strava)
    if (k === 'run' || k === 'bike' || k === 'hike') parts.push(detailsCard(k));

    // Sensaciones y notas
    const texts = h('div.card.act-card');
    if (k === 'run') {
      texts.appendChild(field('Zona o sensaciones', textInput({ value: form.feel, placeholder: 'p. ej. Z2 cómoda, piernas cargadas', ariaLabel: 'Zona o sensaciones', onInput: (v) => change({ feel: v }) })));
    }
    texts.appendChild(field('Notas', textInput({ value: form.notes, multiline: true, rows: 3, placeholder: 'Opcional', ariaLabel: 'Notas', onInput: (v) => change({ notes: v }) })));
    parts.push(texts);

    body.replaceChildren(...parts);
  }

  function num(label, key, { unit, aria, decimals = 0, inputmode = 'numeric', placeholder = '' }) {
    return field(label, numInput({ value: form[key], decimals, inputmode, suffix: unit, ariaLabel: aria || label, placeholder, onInput: (v) => change({ [key]: v }) }));
  }

  function detailsCard(k) {
    const elapsed = durationInput({ seconds: form.elapsedSec, ariaLabel: 'Tiempo total', onChange: (sec) => change({ elapsedSec: sec }) });
    refs.elapsedHint = h('span.field-hint', 'Incluye paradas (opcional).');
    const grid = k === 'hike' ? hikeGrid() : h('div.grid-2.act-grid',
      num('Desnivel', 'elevationM', { unit: 'm', aria: 'Desnivel (m)' }),
      num('Cadencia', 'cadence', { unit: k === 'run' ? 'ppm' : 'rpm', aria: `Cadencia (${k === 'run' ? 'ppm' : 'rpm'})` }),
      num('FC media', 'hrAvg', { unit: 'lpm', aria: 'FC media (lpm)' }),
      num('FC máxima', 'hrMax', { unit: 'lpm', aria: 'FC máxima (lpm)' }),
      k === 'bike' ? num('Potencia media', 'powerAvg', { unit: 'W', aria: 'Potencia media (W)' }) : null,
      k === 'bike' ? num('Potencia norm.', 'powerNp', { unit: 'W', aria: 'Potencia normalizada (W)' }) : null);
    return h('div.card.act-card',
      h('div.act-card-title', 'Más datos', h('span.muted', ' · opcional')),
      h('div.field', h('span.field-label', 'Tiempo total'), elapsed, refs.elapsedHint),
      grid);
  }

  /** Senderismo: desnivel positivo y negativo, altitud máxima, mochila y pulso. */
  function hikeGrid() {
    return h('div.grid-2.act-grid.act-hike-grid',
      num('Desnivel positivo', 'elevationM', { unit: 'm', aria: 'Desnivel positivo (m)', placeholder: 'p. ej. 850' }),
      num('Desnivel negativo', 'elevationLossM', { unit: 'm', aria: 'Desnivel negativo (m)' }),
      num('Altitud máxima', 'altMaxM', { unit: 'm', aria: 'Altitud máxima (m)' }),
      num('Peso de la mochila', 'packKg', { unit: 'kg', aria: 'Peso de la mochila (kg)', decimals: 1, inputmode: 'decimal' }),
      num('FC media', 'hrAvg', { unit: 'lpm', aria: 'FC media (lpm)' }),
      num('FC máxima', 'hrMax', { unit: 'lpm', aria: 'FC máxima (lpm)' }));
  }

  function swimCard() {
    const lenWrap = h('div.field', { hidden: form.poolType !== 'pool' },
      h('span.field-label', 'Longitud de piscina'),
      chips({ options: L.POOL_LENGTHS.map((m) => ({ value: m, label: `${m} m` })), value: form.poolLengthM, allowNone: true, onChange: (v) => change({ poolLengthM: v }, true) }));
    return h('div.card.act-card',
      h('div.field',
        h('span.field-label', 'Dónde'),
        segmented({
          options: [{ value: 'pool', label: 'Piscina' }, { value: 'open', label: 'Aguas abiertas' }],
          value: form.poolType,
          ariaLabel: 'Piscina o aguas abiertas',
          onChange: (v) => { lenWrap.hidden = v !== 'pool'; change({ poolType: v }, true); },
        })),
      lenWrap,
      h('div.field',
        h('span.field-label', 'Estilo principal'),
        chips({ options: SWIM_STROKES.map((s) => ({ value: s.id, label: s.label })), value: form.stroke, allowNone: true, onChange: (v) => change({ stroke: v }, true) })));
  }

  function otherTypeCard() {
    const CUSTOM = '__custom';
    const known = L.SUBTYPE_OPTIONS.other.some((o) => o.id === form.subtype);
    const isCustom = !!form.subtype && !known;
    const custom = textInput({ value: isCustom ? form.subtype : '', placeholder: 'p. ej. Pádel, escalada…', ariaLabel: 'Otro tipo de actividad', maxlength: 60, onInput: (v) => change({ subtype: v }) });
    const customWrap = h('div.act-custom', { hidden: !isCustom }, custom);
    const c = chips({
      options: [...L.SUBTYPE_OPTIONS.other.map((o) => ({ value: o.id, label: o.label })), { value: CUSTOM, label: 'Otro…' }],
      value: isCustom ? CUSTOM : form.subtype,
      allowNone: true,
      onChange: (v) => {
        customWrap.hidden = v !== CUSTOM;
        if (v === CUSTOM) {
          change({ subtype: custom.value }, true);
          setTimeout(() => custom.focus(), 0);
        } else {
          change({ subtype: v }, true);
        }
      },
    });
    return h('div.card.act-card', h('div.field-label', 'Tipo'), c, customWrap);
  }

  // ---------- cambios y guardado ----------
  function change(patch, immediate = false) {
    Object.assign(form, patch);
    updateLive();
    persist(immediate);
  }

  /** Valores imposibles o muy raros (js/sanity.js, docs/PULIDO.md §14). Declaración de función (se usa al montar). */
  function sanity() { return split(checkActivity(form)); }

  function persist(immediate, { force = false } = {}) {
    if (removed) return;
    // Un valor imposible (10 km en 2 min, FC 600) no se escribe: se queda lo último válido y el estado lo dice.
    // Excepción (force): un cambio de tipo confirmado se guarda siempre (tiene deshacer); el estado pide revisar.
    unsaved = !force && sanity().impossible.length > 0;
    if (unsaved) { updateStatus(); return; }
    if (!record) {
      if (L.isValid(form)) create();
      else saveDraftSoon();
    } else {
      Object.assign(record, L.buildRecord(form, record));
      pendingSoon = !immediate;
      if (immediate) store.save('sessions', record);
      else store.saveSoon('sessions', record);
      syncParent();
    }
    updateStatus();
  }

  function create() {
    saveDraftSoon.cancel();
    record = L.buildRecord(form, null, { id: uid('a_') });
    store.save('sessions', record);
    syncParent();
    clearOwnDraft(form.kind, ctx.draftCtx);
    // Cambia la URL sin volver a montar la vista (se conserva el foco y el scroll).
    replaceUrl(`#/activity/${record.id}`);
    trashBtn.hidden = false;
    deleteBtn.hidden = false;
    if (restoredBanner) { restoredBanner.remove(); restoredBanner = null; }
    paintTitle();
  }

  /** Vuelve a pintar todo el formulario (tras cambiar de tipo, deshacer…). */
  function repaintAll() {
    if (kindSeg) kindSeg.setValue(form.kind);
    buildBody();
    paintTitle();
    updateLive();
    updateStatus();
  }

  async function switchKind(k) {
    if (k === form.kind) return;
    // En una actividad guardada, cambiar de tipo quita los datos que no aplican al tipo nuevo:
    // se pide confirmación y se ofrece deshacer.
    const lost = record ? L.fieldsLostOnKindChange(record, k) : [];
    let prev = null;
    if (lost.length) {
      const name = L.KIND_UI[k].label.toLowerCase();
      const ok = await confirmDialog({
        title: `¿Cambiar a ${name}?`,
        message: `Se quitarán de esta actividad los datos que no aplican a ${name}: ${L.joinList(lost)}.\n\nPodrás deshacerlo justo después.`,
        confirmText: 'Cambiar',
        danger: true,
      });
      if (!ok || !alive || removed) { if (kindSeg) kindSeg.setValue(form.kind); return; }
      prev = deepClone(record);
    }
    const old = form.kind;
    subtypeMemo[old] = form.subtype;
    form.kind = k;
    // Los tipos de sesión son distintos en cada deporte: se recupera el que tenía este, si lo hubo.
    form.subtype = k in subtypeMemo ? subtypeMemo[k] : baseFor(k)?.subtype ?? null;
    if (!record) clearOwnDraft(old, ctx.draftCtx);
    buildBody();
    paintTitle();
    updateLive();
    persist(true, { force: true });
    if (prev) undoToast(`Tipo cambiado a ${L.KIND_UI[k].label.toLowerCase()}`, () => undoKindSwitch(prev));
  }

  /** Deshace un cambio de tipo: vuelve a dejar el registro exactamente como estaba. */
  function undoKindSwitch(prev) {
    const cur = store.get('sessions', prev.id);
    if (!cur) return; // se borró entretanto
    Object.keys(cur).forEach((key) => delete cur[key]);
    Object.assign(cur, prev);
    pendingSoon = false;
    store.restore('sessions', cur); // tal cual (sin sellar updatedAt de nuevo)
    if (!alive || cur !== record) return;
    Object.keys(form).forEach((key) => delete form[key]);
    Object.assign(form, L.formFromRecord(record));
    resetMemo();
    repaintAll();
  }

  /** Descarta el borrador (con deshacer: se puede recuperar justo después). */
  function discardDraft() {
    if (record) return;
    saveDraftSoon.cancel();
    const snapshot = deepClone(form);
    clearOwnDraft(form.kind, ctx.draftCtx);
    const keepKind = form.kind;
    Object.keys(form).forEach((key) => delete form[key]);
    Object.assign(form, deepClone(baseFor(keepKind)));
    resetMemo();
    if (restoredBanner) { restoredBanner.remove(); restoredBanner = null; }
    repaintAll();
    if (L.hasContent(snapshot, baseFor(snapshot.kind))) {
      undoToast('Borrador descartado', () => {
        if (record) return; // ya se creó la actividad: el borrador viejo no vuelve
        if (!alive) { writeDraft(snapshot, ctx.draftCtx); return; }
        Object.keys(form).forEach((key) => delete form[key]);
        Object.assign(form, snapshot);
        resetMemo();
        writeDraft(form, ctx.draftCtx);
        repaintAll();
      });
    }
  }

  // ---------- partes que se actualizan en vivo ----------
  function paintTitle() {
    const ui = L.KIND_UI[form.kind];
    titleEl.textContent = record ? ui.label : ui.newTitle;
    subEl.textContent = isDateStr(form.date) ? fmtDate(form.date, 'long') : '';
  }

  function updateLive() {
    const metric = L.primaryMetric(form);
    if (metric && refs.metricVal) {
      refs.metricVal.replaceChildren(metric.num, metric.unit ? h('span.act-live-unit', ` ${metric.unit}`) : '');
      refs.metricSub.textContent = metric.sub;
    }
    const load = L.loadInfo(form);
    refs.loadVal.textContent = load.text;
    refs.loadSub.textContent = load.sub;
    refs.loadVal.classList.toggle('act-muted-val', load.value == null);
    if (refs.metricVal) refs.metricVal.classList.toggle('act-muted-val', !(metric && metric.value));
    // Pistas bajo la duración: objetivo del ítem enlazado y aviso si se vacía una ya guardada.
    const bits = [];
    if (parentSe && L.targetText(parentSe.target)) bits.push(`Objetivo: ${L.targetText(parentSe.target)}`);
    if (record && !(form.movingSec > 0)) bits.push(`Sin duración se mantiene la guardada (${fmtDuration(record.movingSec)}).`);
    const paceWarn = L.paceWarning(form);
    if (paceWarn) bits.push(paceWarn);
    // Imposibles y muy raros (sin repetir el aviso de ritmo de la carrera, que ya lo dice)
    const odd = checkActivity(form).filter((i) => !(paceWarn && (i.field === 'pace' || i.level === 'rare')));
    for (const i of odd) bits.push(i.level === 'impossible' ? i.message : `${i.message} Si es correcto, no tienes que hacer nada.`);
    refs.durHint.textContent = bits.join(' · ');
    refs.durHint.hidden = !bits.length;
    refs.durHint.classList.toggle('warn', !!paceWarn || odd.length > 0);
    if (refs.elapsedHint) {
      const bad = form.elapsedSec > 0 && form.movingSec > 0 && form.elapsedSec < form.movingSec;
      refs.elapsedHint.textContent = bad ? 'El tiempo total suele ser mayor o igual que el tiempo en movimiento.' : 'Incluye paradas (opcional).';
      refs.elapsedHint.classList.toggle('warn', bad);
    }
  }

  function updateStatus() {
    statusEl.classList.remove('act-status-error');
    if (sanity().impossible.length) {
      statusEl.replaceChildren(icon('alert', 18), h('span', unsaved || !record ? 'Sin guardar: revisa los datos' : 'Guardado: revisa los datos'));
      statusEl.className = 'act-status act-status-error';
      return;
    }
    if (record) {
      statusEl.replaceChildren(icon('check', 18), h('span', 'Guardado'));
      statusEl.className = 'act-status act-status-ok';
      discardBtn.hidden = true;
      return;
    }
    const errs = L.validate(form);
    statusEl.className = 'act-status act-status-draft';
    const typed = userContent();
    statusEl.replaceChildren(h('span', typed ? `Borrador: ${L.missingText(errs).toLowerCase()}` : 'Se guarda al poner la duración'));
    discardBtn.hidden = !typed;
  }

  // ---------- acciones ----------
  async function done() {
    const { impossible, rare } = sanity();
    if (impossible.length) { toast(impossible[0].message, { kind: 'error' }); return; }
    if (rare.length && !(await confirmRare(rare, { confirmText: 'Sí, es correcto' }))) return;
    if (!alive || removed) return;
    if (!record) {
      if (!userContent()) { back(backFallback); return; }
      statusEl.replaceChildren(h('span', `${L.missingText(L.validate(form))} para guardar`));
      statusEl.className = 'act-status act-status-error';
      const first = refs.dur?.querySelector('input[aria-label$=": min"]');
      if (first) first.focus();
      return;
    }
    flushRecord();
    back(backFallback);
    const p = form.parentId ? store.get('sessions', form.parentId) : null;
    if (p && p.status === 'done' && p.durationMin != null && parentMinAtOpen != null && p.durationMin !== parentMinAtOpen) {
      toast(`Duración de la fuerza recalculada: ${fmtMinutes(parentMinAtOpen)} → ${fmtMinutes(p.durationMin)} (sin el cardio enlazado).`);
    }
  }

  function flushRecord() {
    if (record && pendingSoon && !removed) store.save('sessions', record);
    pendingSoon = false;
  }

  async function removeActivity() {
    if (!record) return;
    const ok = await confirmDialog({
      title: '¿Borrar esta actividad?',
      message: `${L.activityTitle(record)} · ${fmtDate(record.date, 'full')}.\n\nPodrás deshacerlo justo después.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    removed = true;
    const obj = await store.remove('sessions', record.id);
    // La duración automática de la sesión de fuerza se recalcula sin esta actividad; «Deshacer» la deja como estaba
    // (recalcular no basta: con la actividad de vuelta puede no haber propuesta y quedaría la de sin ella).
    const parent = obj?.parentId ? store.get('sessions', obj.parentId) : null;
    const parentBefore = parent ? { durationMin: parent.durationMin, durationAuto: parent.durationAuto } : null;
    const changed = parent ? syncLinkedDuration(obj.parentId) : null;
    const parentAfter = parent ? parent.durationMin : null;
    back(backFallback);
    undoToast('Actividad borrada', async () => {
      if (!obj) return;
      await store.restore('sessions', obj);
      const p = obj.parentId ? store.get('sessions', obj.parentId) : null;
      if (p && changed && p.durationMin === parentAfter) {
        Object.assign(p, parentBefore);
        store.save('sessions', p).catch(() => {});
      } else if (p) syncLinkedDuration(obj.parentId);
      refresh();
    });
  }

  // Limpieza al salir: guarda ya lo pendiente (o el borrador).
  return () => {
    alive = false;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', saveNow);
    saveNow();
  };
}
