// activity.js — registro rápido de carrera, bici, natación y otras actividades (estilo Strava).
// Obligatorios: tipo, fecha y duración. La actividad se crea en cuanto es válida y desde ahí
// cada cambio se guarda al instante; antes se conserva un borrador en localStorage.
import * as store from '../store.js';
import { back, navigate, refresh, parseHash } from '../router.js';
import {
  h, icon, header, segmented, chips, rpePicker, durationInput, field, textInput, numInput,
  confirmDialog, undoToast, toast, emptyState,
} from '../ui.js';
import { todayStr, fmtDate, uid, fmtDuration, debounce } from '../util.js';
import { SWIM_STROKES } from '../seed.js';
import * as L from '../activity-logic.js';
import { isDateStr } from '../activity-logic.js';

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

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

/**
 * #/activity/new?kind=&date=&planDate=&parent=&item=  → actividad nueva
 * #/activity/:id                                      → editar (fuerza → #/session/:id)
 */
export function mountActivity(root, params = {}) {
  const id = routeId(params);
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
    return mountForm(root, { record: rec, form: L.formFromRecord(rec), showKindPicker: true });
  }
  return mountForm(root, newContext(params));
}

/**
 * Id de la ruta #/activity/:id. Solución local: el router del núcleo no rellena hoy los
 * parámetros de ruta (defineRoutes pierde `keys`), así que se lee también del hash.
 */
function routeId(params) {
  if (params.id) return params.id;
  const m = /^\/activity\/([^/]+)$/.exec(parseHash().path);
  return m && m[1] !== 'new' ? decodeURIComponent(m[1]) : null;
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
  }
  const base = { ...form };

  // ¿Hay un borrador de esta misma pantalla? (con tipo fijo, solo el de ese tipo)
  let restored = false;
  let best = null;
  for (const k of kind ? [kind] : L.ACTIVITY_KINDS) {
    const d = readDraft(k);
    if (d && sameCtx(d.ctx, draftCtx) && (!best || d.savedAt > best.savedAt)) best = d;
  }
  if (best && L.hasContent(best.form)) {
    form = { ...base, ...best.form, kind: best.form.kind };
    if (parent) Object.assign(form, { date: base.date, planDate: base.planDate, planFollows: base.planFollows, parentId: base.parentId, parentItemId: base.parentItemId, templateItemId: base.templateItemId });
    restored = true;
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
  const parent = ctx.parent || (form.parentId ? store.get('sessions', form.parentId) : null);
  const parentSe = ctx.se || (parent && form.parentItemId ? (parent.exercises || []).find((x) => x.id === form.parentItemId) : null);
  const backFallback = form.parentId ? `#/session/${form.parentId}` : '#/today';
  const refs = {};

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

  const body = h('div.act-body');
  const deleteBtn = h('button.btn.btn-danger-ghost.btn-block.act-delete', { type: 'button', hidden: !record, onClick: () => removeActivity() }, icon('trash', 20), 'Borrar actividad');
  const discardBtn = h('button.btn.btn-ghost.btn-block.act-discard', { type: 'button', hidden: true, onClick: () => discardDraft() }, 'Descartar borrador');
  const statusEl = h('div.act-status', { role: 'status', 'aria-live': 'polite' });
  const doneBtn = h('button.btn.btn-primary.btn-lg.act-done', { type: 'button', onClick: () => done() }, icon('check', 22), 'Listo');
  const footer = h('div.act-footer', statusEl, doneBtn);
  content.append(...[kindSeg, linkBanner, body, deleteBtn, discardBtn, footer].filter(Boolean));

  const saveDraftSoon = debounce(() => {
    if (!record && L.hasContent(form)) writeDraft(form, ctx.draftCtx);
  }, 300);

  buildBody();
  paintTitle();
  updateLive();
  updateStatus();
  let draftToast = ctx.restored
    ? toast('Borrador recuperado', { actionLabel: 'Descartar', onAction: () => discardDraft(), duration: 5000 })
    : null;

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
        type: 'date', value: form.date || '', 'aria-label': 'Fecha', required: true,
      });
      const onDate = () => {
        const v = dateInp.value;
        if (v === form.date) return; // 'input' y 'change' llegan juntos en algunos navegadores
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

    // Tipo de sesión / estilo
    if (k === 'run' || k === 'bike') {
      parts.push(h('div.card.act-card',
        h('div.field-label', 'Tipo de sesión'),
        chips({ options: L.SUBTYPE_OPTIONS[k].map((o) => ({ value: o.id, label: o.label })), value: form.subtype, allowNone: true, onChange: (v) => change({ subtype: v }, true) })));
    } else if (k === 'swim') {
      parts.push(swimCard());
    } else {
      parts.push(otherTypeCard());
    }

    // Datos opcionales (tipo Strava)
    if (k === 'run' || k === 'bike') parts.push(detailsCard(k));

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
    const grid = h('div.grid-2.act-grid',
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

  function persist(immediate) {
    if (removed) return;
    if (!record) {
      if (L.isValid(form)) create();
      else saveDraftSoon();
    } else {
      Object.assign(record, L.buildRecord(form, record));
      pendingSoon = !immediate;
      if (immediate) store.save('sessions', record);
      else store.saveSoon('sessions', record);
    }
    updateStatus();
  }

  function create() {
    saveDraftSoon.cancel();
    record = L.buildRecord(form, null, { id: uid('a_') });
    store.save('sessions', record);
    clearDraft(form.kind);
    // Cambia la URL sin volver a montar la vista (se conserva el foco y el scroll).
    try { history.replaceState(history.state, '', `#/activity/${record.id}`); } catch { /* sin history */ }
    trashBtn.hidden = false;
    deleteBtn.hidden = false;
    if (draftToast) { draftToast.close(); draftToast = null; }
  }

  function switchKind(k) {
    if (k === form.kind) return;
    const old = form.kind;
    form.kind = k;
    form.subtype = null; // los tipos de sesión son distintos en cada deporte
    if (!record) clearDraft(old);
    buildBody();
    paintTitle();
    updateLive();
    persist(true);
  }

  function discardDraft() {
    saveDraftSoon.cancel();
    clearDraft(form.kind);
    if (record) return;
    const keepKind = form.kind;
    Object.keys(form).forEach((key) => delete form[key]);
    Object.assign(form, { ...ctx.base, kind: keepKind });
    if (form.parentId && parentSe) form.subtype = L.subtypeFromNotes(keepKind, parentSe.notes);
    buildBody();
    updateLive();
    updateStatus();
  }

  // ---------- partes que se actualizan en vivo ----------
  function paintTitle() {
    const ui = L.KIND_UI[form.kind];
    titleEl.textContent = ctx.record ? ui.label : ui.newTitle;
    subEl.textContent = isDateStr(form.date) ? fmtDate(form.date, 'long') : '';
  }

  function updateLive() {
    const metric = L.primaryMetric(form);
    if (metric && refs.metricVal) {
      refs.metricVal.textContent = metric.text;
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
    refs.durHint.textContent = bits.join(' · ');
    refs.durHint.hidden = !bits.length;
    if (refs.elapsedHint) {
      const bad = form.elapsedSec > 0 && form.movingSec > 0 && form.elapsedSec < form.movingSec;
      refs.elapsedHint.textContent = bad ? 'El tiempo total suele ser mayor o igual que el tiempo en movimiento.' : 'Incluye paradas (opcional).';
      refs.elapsedHint.classList.toggle('warn', bad);
    }
  }

  function updateStatus() {
    statusEl.classList.remove('act-status-error');
    if (record) {
      statusEl.replaceChildren(icon('check', 18), h('span', 'Guardado'));
      statusEl.className = 'act-status act-status-ok';
      discardBtn.hidden = true;
      return;
    }
    const errs = L.validate(form);
    statusEl.className = 'act-status act-status-draft';
    statusEl.replaceChildren(h('span', L.hasContent(form) ? `Borrador: ${L.missingText(errs).toLowerCase()}` : 'Se guarda al poner la duración'));
    discardBtn.hidden = !L.hasContent(form);
  }

  // ---------- acciones ----------
  function done() {
    if (!record) {
      if (!L.hasContent(form)) { back(backFallback); return; }
      statusEl.replaceChildren(h('span', `${L.missingText(L.validate(form))} para guardar`));
      statusEl.className = 'act-status act-status-error';
      const first = refs.dur?.querySelector('input[aria-label$=": min"]');
      if (first) first.focus();
      return;
    }
    flushRecord();
    back(backFallback);
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
    back(backFallback);
    undoToast('Actividad borrada', async () => {
      if (!obj) return;
      await store.restore('sessions', obj);
      refresh();
    });
  }

  // Limpieza al salir: guarda ya lo pendiente (o el borrador).
  return () => {
    if (removed) return;
    if (record) {
      flushRecord();
    } else {
      saveDraftSoon.cancel();
      if (L.hasContent(form)) writeDraft(form, ctx.draftCtx);
    }
  };
}
