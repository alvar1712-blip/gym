// exercises.js — pestaña Ejercicios (segmentado Rutinas | Biblioteca), ficha y editor de ejercicio.
// PROPIETARIO: módulo de biblioteca. La lógica pura (búsqueda, uso, historial…) está en library-logic.js.
import * as store from '../store.js';
import { navigate, replaceUrl, screenToken, navigateFrom } from '../router.js';
import { h, icon, screen, segmented, chips, textInput, field, confirmDialog, undoToast, discardDraftUndo, toast, emptyState, sheet } from '../ui.js';
import { fmtDate, fmtNum, uid, plural } from '../util.js';
import { MUSCLES, MUSCLE_LABEL, PATTERNS, PATTERN_LABEL, LOG_TYPES, LOG_TYPE_LABEL } from '../seed.js';
import { makeBodyweightFn } from '../calc.js';
import { formatSet } from '../session-logic.js';
import * as L from '../library-logic.js';
import { renderTemplatesList, createTemplate } from './templates.js';

const SEG_KEY = 'entreno.exercises.seg';
const DRAFT_KEY = 'entreno.exercise.draft';
const LIB_HREF = '#/exercises?seg=library';
const HISTORY_PAGE = 20;

// Filtros de la biblioteca: se conservan mientras la app está abierta (al volver de una ficha).
const lib = { q: '', muscle: null, pattern: null, archived: false };

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
}

/** Repinta `fn` (una vez por tanda) cuando cambian los ejercicios; se desuscribe al desmontarse `el`. */
function onExercisesChange(el, fn) {
  let queued = false;
  const off = store.on('change', (d) => {
    if (d.store !== 'exercises' || queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (!el.isConnected) { off(); return; }
      fn();
    }, 0);
  });
  return off;
}

const muscleNames = (ids) => (ids || []).map((m) => MUSCLE_LABEL[m] || m);

function notFound(root, title = 'Ejercicio') {
  const c = screen(root, { title, back: LIB_HREF });
  c.appendChild(emptyState({ emoji: '🤷', title: 'Ejercicio no encontrado', text: 'Puede que se haya borrado.', action: { label: 'Ir a la biblioteca', onClick: () => navigate(LIB_HREF, { replace: true }) } }));
}

// ===========================================================================
// Pestaña Ejercicios (#/exercises?seg=templates|library)
// ===========================================================================

export function mountExercises(root, params = {}) {
  const valid = (v) => v === 'templates' || v === 'library';
  let seg = valid(params.seg) ? params.seg : valid(lsGet(SEG_KEY)) ? lsGet(SEG_KEY) : 'templates';
  lsSet(SEG_KEY, seg);

  const addBtn = h('button.icon-btn', { type: 'button', onClick: () => (seg === 'library' ? navigate('#/exercise/new') : createTemplate()) }, icon('plus', 26));
  const content = screen(root, { title: 'Ejercicios', actions: [addBtn] });
  const segEl = segmented({
    options: [{ value: 'templates', label: 'Rutinas' }, { value: 'library', label: 'Biblioteca' }],
    value: seg,
    ariaLabel: 'Rutinas o biblioteca',
    onChange: (v) => {
      if (v === seg) return;
      seg = v;
      lsSet(SEG_KEY, v);
      // Se actualiza la URL sin volver a montar la vista (al volver atrás se abre el mismo segmento).
      replaceUrl(`#/exercises?seg=${v}`);
      paint();
      window.scrollTo(0, 0);
    },
  });
  segEl.classList.add('lib-seg');
  const body = h('div.lib-body');
  content.append(segEl, body);

  let cleanupSeg = null;
  function paint() {
    if (cleanupSeg) cleanupSeg();
    addBtn.setAttribute('aria-label', seg === 'library' ? 'Nuevo ejercicio' : 'Nueva rutina');
    addBtn.title = addBtn.getAttribute('aria-label');
    body.replaceChildren();
    cleanupSeg = seg === 'templates' ? renderTemplatesList(body).destroy : renderLibrary(body);
  }
  paint();
  return () => { if (cleanupSeg) cleanupSeg(); };
}

/** Biblioteca: buscador, filtros por músculo y patrón, lista. Devuelve la función de limpieza. */
function renderLibrary(body) {
  const search = h('input.input.lib-search', {
    type: 'search', value: lib.q, placeholder: 'Buscar por nombre o alias', autocomplete: 'off', autocorrect: 'off',
    autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Buscar ejercicio',
  });
  search.addEventListener('input', () => { lib.q = search.value; paintList(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') search.blur(); });

  const muscleChips = chips({
    options: [{ value: null, label: 'Todos' }, ...MUSCLES.map((m) => ({ value: m.id, label: m.label }))],
    value: lib.muscle, allowNone: true, className: 'chips-scroll lib-chips',
    onChange: (v) => { lib.muscle = v; paintList(); },
  });
  muscleChips.setAttribute('aria-label', 'Filtrar por músculo');
  const patternChips = chips({
    options: [{ value: null, label: 'Todos' }, ...PATTERNS.map((p) => ({ value: p.id, label: p.label }))],
    value: lib.pattern, allowNone: true, className: 'chips-scroll lib-chips',
    onChange: (v) => { lib.pattern = v; paintList(); },
  });
  patternChips.setAttribute('aria-label', 'Filtrar por patrón');

  const archInp = h('input', { type: 'checkbox', checked: lib.archived, onChange: (e) => { lib.archived = e.target.checked; paintList(); } });
  const countEl = h('span.muted.small.lib-count');
  const listEl = h('div.list.lib-ex-list');
  const emptyEl = h('div.lib-empty', { hidden: true });

  function row(e) {
    const prim = muscleNames(e.primary).join(', ');
    return h('button.list-item.lib-ex-row', { type: 'button', dataset: { id: e.id }, onClick: () => navigate(`#/exercise/${e.id}`) },
      h('span.list-item-main',
        h('span.lib-ex-name', h('span', e.name),
          e.custom ? h('span.badge.badge-info', 'Propio') : null,
          e.archived ? h('span.badge.badge-warn', 'Archivado') : null),
        h('span.lib-ex-muscles', prim || (e.logType === 'cardio' ? 'Actividad de resistencia' : 'Sin músculos asignados')),
        h('span.lib-ex-meta', [PATTERN_LABEL[e.pattern], L.LOG_SHORT[e.logType]].filter(Boolean).join(' · '))),
      icon('chevron-right', 20, 'chev'));
  }

  function paintList() {
    const res = L.searchExercises(store.exercisesList({ includeArchived: true }), lib);
    countEl.textContent = plural(res.length, 'ejercicio', 'ejercicios');
    listEl.hidden = !res.length;
    listEl.replaceChildren(...res.map(row));
    emptyEl.hidden = !!res.length;
    if (!res.length) {
      emptyEl.replaceChildren(emptyState({
        emoji: '🔎', title: 'Sin resultados',
        text: lib.q ? `No hay ejercicios que coincidan con «${lib.q.trim()}».` : 'Ningún ejercicio cumple los filtros.',
      }));
    }
  }

  body.append(
    search,
    h('div.lib-filter', h('span.lib-filter-label', 'Músculo'), muscleChips),
    h('div.lib-filter', h('span.lib-filter-label', 'Patrón'), patternChips),
    h('div.row-between.lib-count-row', countEl,
      h('label.lib-switch-row', h('span', 'Ver archivados'), h('span.switch', archInp, h('span')))),
    listEl,
    emptyEl,
    h('button.btn.btn-lg.btn-block.lib-add', { type: 'button', onClick: () => navigate('#/exercise/new') }, icon('plus', 22), 'Nuevo ejercicio'));
  paintList();
  // El chip activo, a la vista.
  requestAnimationFrame(() => body.querySelectorAll('.lib-chips .chip.active').forEach((c) => c.scrollIntoView && c.scrollIntoView({ block: 'nearest', inline: 'center' })));
  return onExercisesChange(body, paintList);
}

// ===========================================================================
// Ficha (#/exercise/:id)
// ===========================================================================

export function mountExerciseDetail(root, params = {}) {
  const ex = store.exercise(params.id);
  if (!ex) { notFound(root); return undefined; }
  const content = screen(root, {
    title: ex.name,
    back: LIB_HREF,
    actions: [{ icon: 'edit', label: 'Editar ejercicio', onClick: () => navigate(`#/exercise/${ex.id}/edit`) }],
  });
  content.classList.add('lib-detail');
  const settings = store.settings() || {};

  // Etiquetas
  const archBadge = h('span.badge.badge-warn', { hidden: !ex.archived }, 'Archivado');
  const badges = h('div.row.wrap.lib-badges', { hidden: !ex.custom && !ex.archived },
    ex.custom ? h('span.badge.badge-info', 'Propio') : null,
    archBadge);
  content.appendChild(badges);

  // Músculos y cómo cuentan
  const tags = (ids, cls) => (ids && ids.length
    ? h('div.lib-tags', muscleNames(ids).map((m) => h(`span.lib-tag${cls}`, m)))
    : h('span.muted', 'Ninguno'));
  const pf = settings.primaryFactor ?? 1;
  const sf = settings.secondaryFactor ?? 0.5;
  // En cardio sin músculos asignados solo se explica cómo cuenta.
  const showMuscles = ex.logType !== 'cardio' || (ex.primary || []).length + (ex.secondary || []).length > 0;
  content.appendChild(h('section.card.lib-muscles',
    h('h2.card-title', showMuscles ? 'Músculos' : 'Cómo cuenta'),
    showMuscles ? h('div.lib-kv-block', h('span.lib-k', 'Principales'), tags(ex.primary, '.lib-tag-primary')) : null,
    showMuscles ? h('div.lib-kv-block', h('span.lib-k', 'Secundarios'), tags(ex.secondary, '')) : null,
    ex.logType === 'cardio'
      ? h('p.small.muted', 'Se registra como actividad (carrera, bici o natación): cuenta para la carga y los kilómetros, no para las series por músculo.')
      : h('p.small.muted.lib-count-rule', `Cómo cuenta: 1 serie efectiva = ${fmtNum(pf, 2)} para cada principal y ${fmtNum(sf, 2)} para cada secundario. Los calentamientos no cuentan. Se cambia en Ajustes.`)));

  // Datos
  const kv = (k, v) => (v ? h('div.lib-kv', h('span.lib-k', k), h('span.lib-v', v)) : null);
  // Textos largos (alias, notas): etiqueta encima y texto normal debajo.
  const kvBlock = (k, v) => (v ? h('div.lib-kv.lib-kv-text', h('span.lib-k', k), h('span.lib-v', v)) : null);
  const tplUse = store.templatesList().filter((t) => (t.items || []).some((it) => it.exerciseId === ex.id || (it.alternatives || []).includes(ex.id)));
  content.appendChild(h('section.card.lib-data',
    kv('Patrón', PATTERN_LABEL[ex.pattern] || '—'),
    kv('Tipo de registro', LOG_TYPE_LABEL[ex.logType] || ex.logType),
    // Peso corporal: qué cuenta como carga (calc.setMetrics). En core, el peso corporal no es la carga que se mueve.
    ex.logType === 'bodyweight' ? kvBlock('Carga', ex.pattern === 'core'
      ? 'Solo el lastre: el peso corporal no cuenta. Sin 1RM estimado; sin lastre, se sigue por repeticiones.'
      : 'Tu peso corporal del día + el lastre (la asistencia resta). Cuenta para el 1RM estimado y el volumen.') : null,
    kv('Categoría', L.CATEGORY_LABEL[ex.category] || '—'),
    kv('Región', L.REGION_LABEL[ex.region] || '—'),
    ex.logType === 'cardio' ? kv('Deporte', L.SPORT_LABEL[ex.sport] || '—') : null,
    kvBlock('Alias', (ex.aliases || []).join(', ')),
    kvBlock('Notas', ex.notes),
    tplUse.length ? h('div.lib-kv-block', h('span.lib-k', 'En rutinas'),
      h('div.lib-tags', tplUse.map((t) => h('button.chip.lib-tpl-chip', { type: 'button', onClick: () => navigate(`#/template/${t.id}`) }, t.name)))) : null));

  content.appendChild(h('button.list-item.lib-link', { type: 'button', onClick: () => navigate(`#/progress/exercise/${ex.id}`) },
    icon('chart', 22), h('span.list-item-main', h('span.list-item-title', 'Ver progreso'), h('span.list-item-sub', 'Gráficas y récords')), icon('chevron-right', 20, 'chev')));

  // Historial
  const bwFn = makeBodyweightFn(store.bodyweightList(), settings.bodyweightDefault ?? 75);
  // Series con el mismo texto que «Última vez» en la sesión (asistencia, RIR, tiempo…).
  const hist = L.exerciseHistory(store.all('sessions'), ex, { bwFn, fmtSet: formatSet });
  content.appendChild(h('div.row-between.lib-hist-head', h('h2.section-title', 'Historial'), hist.length ? h('span.muted.small', plural(hist.length, 'sesión', 'sesiones')) : null));
  if (!hist.length) {
    content.appendChild(h('p.muted.lib-hist-empty', 'Todavía no hay sesiones con este ejercicio.'));
  } else {
    const listEl = h('div.list.lib-hist');
    const moreBtn = h('button.btn.btn-ghost.btn-block', { type: 'button' }, 'Ver más');
    let shown = 0;
    const histRow = (r) => h('button.list-item.lib-hist-row', { type: 'button', dataset: { session: r.sessionId }, onClick: () => navigate(`#/session/${r.sessionId}`) },
      h('span.list-item-main',
        h('span.list-item-title', fmtDate(r.date, 'full'), r.status === 'active' ? h('span.badge.badge-accent.lib-badge-inline', 'En curso') : null),
        r.templateName ? h('span.list-item-sub', r.templateName) : null,
        h('span.lib-hist-sets.tnum', r.setTexts.length
          ? r.setTexts.flatMap((t, i) => [i ? ' · ' : null, h('span.lib-hist-set', t)])
          : r.summary)),
      r.bestE1rm != null
        ? h('span.lib-e1rm', h('span.lib-e1rm-v.tnum', `${fmtNum(r.bestE1rm, 1)} kg`), h('span.lib-e1rm-l', '1RM est.'))
        : null,
      icon('chevron-right', 18, 'chev'));
    const more = () => {
      const next = hist.slice(shown, shown + HISTORY_PAGE);
      listEl.append(...next.map(histRow));
      shown += next.length;
      moreBtn.hidden = shown >= hist.length;
    };
    moreBtn.addEventListener('click', more);
    more();
    content.append(listEl, moreBtn);
    if (hist.some((r) => r.bestE1rm != null)) {
      content.appendChild(h('p.tiny.muted.lib-e1rm-note',
        `1RM est. = mejor 1RM estimado de la sesión (fórmula de Epley con reps + RIR, solo series de 1–12 reps${ex.logType === 'bodyweight' ? '; incluye tu peso corporal' : ''}). Es una estimación, no un peso levantado.`));
    }
  }

  // Acciones
  const archBtn = h('button.btn.btn-secondary', { type: 'button', onClick: () => toggleArchive() });
  const paintArch = () => {
    archBtn.textContent = ex.archived ? 'Desarchivar' : 'Archivar';
    archBadge.hidden = !ex.archived;
    badges.hidden = !ex.custom && !ex.archived;
  };
  paintArch();
  async function toggleArchive() {
    ex.archived = !ex.archived;
    paintArch();
    await store.save('exercises', ex);
    toast(ex.archived
      ? 'Archivado: ya no aparece en la biblioteca ni en los selectores. Su historial se conserva.'
      : 'Desarchivado: vuelve a aparecer en la biblioteca y en los selectores.', { kind: 'success', duration: 4500 });
  }
  async function onDelete() {
    const use = L.exerciseUsage(ex.id, { sessions: store.all('sessions'), templates: store.all('templates'), goals: store.all('goals'), pastRecords: store.all('pastRecords') });
    if (use.used) {
      const parts = [];
      if (use.sessions.length) parts.push(plural(use.sessions.length, 'sesión', 'sesiones'));
      if (use.templates.length) parts.push(`${use.templates.length === 1 ? 'la rutina' : 'las rutinas'} ${use.templates.map((t) => `«${t.name}»`).join(', ')}`);
      if (use.goals.length) parts.push(plural(use.goals.length, 'objetivo', 'objetivos'));
      if (use.marks.length) parts.push(plural(use.marks.length, 'marca histórica', 'marcas históricas'));
      const msg = `Se usa en ${parts.join(' y ')}. Borrarlo dejaría esos registros sin ejercicio.\n\n${ex.archived
        ? 'Ya está archivado: no aparece en la biblioteca ni en los selectores, y su historial se conserva.'
        : 'Archívalo: dejará de aparecer en la biblioteca y en los selectores, pero conservarás su historial.'}`;
      if (ex.archived) {
        sheet({ title: 'No se puede borrar', body: h('p.sheet-msg', msg), actions: [{ label: 'Entendido', kind: 'secondary' }] });
      } else if (await confirmDialog({ title: 'No se puede borrar', message: msg, confirmText: 'Archivar', cancelText: 'Cancelar' })) {
        await toggleArchive();
      }
      return;
    }
    const ok = await confirmDialog({
      title: `¿Borrar «${ex.name}»?`,
      message: 'No se usa en ninguna sesión, rutina, objetivo ni marca histórica. Podrás deshacerlo justo después.',
      confirmText: 'Borrar ejercicio', danger: true,
    });
    if (!ok) return;
    const tok = screenToken();
    const removed = await store.remove('exercises', ex.id);
    // A la biblioteca (la entrada anterior del historial podría ser el editor de este ejercicio).
    navigateFrom(tok, LIB_HREF, { replace: true });
    undoToast(`«${ex.name}» borrado`, () => { if (removed) store.restore('exercises', removed); });
  }
  content.appendChild(h('div.lib-actions',
    h('button.btn.btn-primary.btn-lg.btn-block', { type: 'button', onClick: () => navigate(`#/exercise/${ex.id}/edit`) }, icon('edit', 20), 'Editar'),
    h('div.btn-row', archBtn,
      h('button.btn.btn-danger-ghost', { type: 'button', onClick: onDelete }, icon('trash', 20), 'Borrar'))));
  return undefined;
}

// ===========================================================================
// Editor de ejercicio (#/exercise/new y #/exercise/:id/edit)
// ===========================================================================

function blankExercise(name = '') {
  return { name, aliases: [], primary: [], secondary: [], pattern: null, logType: 'weight_reps', category: 'isolation', region: 'upper', sport: null, notes: '' };
}
function loadDraft() {
  try {
    const d = JSON.parse(lsGet(DRAFT_KEY) || 'null');
    return d && typeof d === 'object' ? { ...blankExercise(), ...d } : null;
  } catch { return null; }
}
const saveDraft = (d) => lsSet(DRAFT_KEY, JSON.stringify(d));
const clearDraft = () => lsSet(DRAFT_KEY, null);
const isBlank = (d) => !d.name.trim() && !d.aliases.length && !d.primary.length && !d.secondary.length && !d.notes.trim();

/** Nº de sesiones con series hechas de este ejercicio. */
function loggedSessions(exId) {
  return store.all('sessions').filter((s) => s.kind === 'strength' && (s.exercises || []).some((se) => se.exerciseId === exId && (se.sets || []).some((x) => x.done))).length;
}

export function mountExerciseEdit(root, params = {}) {
  const editId = params.id || null;
  const isNew = !editId;
  let ex;
  let restored = false;
  if (isNew) {
    const d = loadDraft();
    restored = !!d && !isBlank(d);
    ex = restored ? d : blankExercise(params.name || '');
  } else {
    ex = store.exercise(editId);
    if (!ex) { notFound(root, 'Editar ejercicio'); return undefined; }
  }

  const content = screen(root, {
    title: isNew ? 'Nuevo ejercicio' : 'Editar ejercicio',
    subtitle: isNew ? null : 'Los cambios se guardan solos',
    back: isNew ? LIB_HREF : `#/exercise/${ex.id}`,
    actions: isNew ? [{ text: 'Crear', label: 'Crear ejercicio', onClick: () => create() }] : [],
  });
  content.classList.add('lib-form');

  /** Guarda: el ejercicio (existente) o el borrador (nuevo). */
  const persist = (soon = false) => {
    if (isNew) saveDraft(ex);
    else if (soon) store.saveSoon('exercises', ex);
    else store.save('exercises', ex);
  };

  if (restored) {
    content.appendChild(h('div.banner.banner-info.lib-draft',
      h('div.banner-main', h('div.banner-title', 'Borrador recuperado'), h('div.banner-text', 'Tenías un ejercicio a medias.')),
      h('button.btn.btn-ghost', { type: 'button', onClick: () => discardDraftUndo(DRAFT_KEY, '#/exercise/new') }, 'Vaciar')));
  }

  // --- nombre y alias ---
  const nameErr = h('p.form-error', { hidden: true, role: 'alert' });
  const showErr = (msg) => { nameErr.textContent = msg || ''; nameErr.hidden = !msg; };
  const nameInp = textInput({
    value: ex.name, placeholder: 'p. ej. Remo en máquina agarre neutro', ariaLabel: 'Nombre del ejercicio', maxlength: 80,
    onInput: (v) => {
      if (isNew) { ex.name = v; showErr(null); persist(); return; }
      const err = L.validateExerciseName(v, store.exercisesList({ includeArchived: true }), ex.id);
      showErr(err);
      if (err) return;
      ex.name = v.trim();
      persist(true);
    },
  });
  if (!isNew) {
    nameInp.addEventListener('change', () => {
      if (L.validateExerciseName(nameInp.value, store.exercisesList({ includeArchived: true }), ex.id)) {
        nameInp.value = ex.name;
        showErr(null);
        toast(`Nombre no válido: se mantiene «${ex.name}».`, { kind: 'error' });
      }
    });
  }
  const aliasInp = textInput({
    value: (ex.aliases || []).join(', '), placeholder: 'p. ej. remo hammer, remo neutro', ariaLabel: 'Alias',
    onInput: (v) => { ex.aliases = L.parseAliases(v); persist(true); },
  });
  content.appendChild(h('section.card',
    h('div.field', field('Nombre', nameInp), nameErr),
    field('Alias', aliasInp, 'Separados por comas. También sirven para buscar.')));

  // --- tipo de registro ---
  const sportSeg = segmented({
    options: L.SPORT_OPTIONS,
    value: ex.sport || null,
    ariaLabel: 'Deporte',
    onChange: (v) => { ex.sport = v; persist(); },
  });
  const sportField = h('div.field', { hidden: ex.logType !== 'cardio' }, h('span.field-label', 'Deporte'), sportSeg,
    h('span.field-hint', 'En una sesión abre el formulario de esa actividad.'));
  const typeChips = chips({
    options: LOG_TYPES.map((t) => ({ value: t.id, label: t.label })),
    value: ex.logType,
    className: 'lib-type-chips',
    onChange: async (v) => {
      const prev = ex.logType;
      if (v === prev) return;
      const n = isNew ? 0 : loggedSessions(ex.id);
      if (n > 0) {
        const ok = await confirmDialog({
          title: '¿Cambiar el tipo de registro?',
          message: `Este ejercicio tiene ${plural(n, 'sesión registrada', 'sesiones registradas')} como «${LOG_TYPE_LABEL[prev]}». Esas series no se convierten: con «${LOG_TYPE_LABEL[v]}» pueden verse incompletas y dejar de contar para el 1RM, el volumen o los récords.\n\nSi en realidad es otro ejercicio, mejor crea uno nuevo.`,
          confirmText: 'Cambiar igualmente',
        });
        if (!ok || !typeChips.isConnected) { typeChips.setValue(prev); return; }
      }
      ex.logType = v;
      if (v === 'cardio') {
        if (!ex.sport) { ex.sport = 'run'; sportSeg.setValue('run'); }
        if (!ex.pattern) { ex.pattern = 'cardio'; patternChips.setValue('cardio'); }
      }
      sportField.hidden = v !== 'cardio';
      persist();
    },
  });
  content.appendChild(h('section.card',
    h('div.field', h('span.field-label', 'Tipo de registro'), typeChips,
      h('span.field-hint', 'Define qué se apunta en cada serie.')),
    sportField));

  // --- músculos ---
  const muscleOpts = MUSCLES.map((m) => ({ value: m.id, label: m.label }));
  let secChips = null;
  const primChips = chips({
    options: muscleOpts, value: ex.primary || [], multi: true, className: 'lib-muscle-chips',
    onChange: (v) => {
      const r = L.assignMuscles(ex.primary, ex.secondary, 'primary', v);
      ex.primary = r.primary;
      ex.secondary = r.secondary;
      secChips.setValue(r.secondary);
      persist();
    },
  });
  secChips = chips({
    options: muscleOpts, value: ex.secondary || [], multi: true, className: 'lib-muscle-chips lib-muscle-sec',
    onChange: (v) => {
      const r = L.assignMuscles(ex.primary, ex.secondary, 'secondary', v);
      ex.primary = r.primary;
      ex.secondary = r.secondary;
      primChips.setValue(r.primary);
      persist();
    },
  });
  primChips.dataset.group = 'primary';
  secChips.dataset.group = 'secondary';
  content.appendChild(h('section.card',
    h('div.field', h('span.field-label', 'Músculos principales'), primChips),
    h('div.field', h('span.field-label', 'Músculos secundarios'), secChips),
    h('p.field-hint', 'Un músculo no puede estar en los dos grupos: al elegirlo en uno sale del otro.')));

  // --- patrón, categoría, región ---
  const patternChips = chips({
    options: PATTERNS.map((p) => ({ value: p.id, label: p.label })),
    value: ex.pattern || null, allowNone: true, className: 'lib-pattern-chips',
    onChange: (v) => { ex.pattern = v; persist(); },
  });
  const catSeg = segmented({ options: L.CATEGORY_OPTIONS, value: ex.category || null, ariaLabel: 'Categoría', onChange: (v) => { ex.category = v; persist(); } });
  const regionChips = chips({ options: L.REGION_OPTIONS, value: ex.region || null, className: 'lib-region-chips', onChange: (v) => { ex.region = v; persist(); } });
  content.appendChild(h('section.card',
    h('div.field', h('span.field-label', 'Patrón de movimiento'), patternChips),
    h('div.field', h('span.field-label', 'Categoría'), catSeg,
      h('span.field-hint', 'Decide el incremento de peso sugerido (compuesto o aislamiento).')),
    h('div.field', h('span.field-label', 'Región'), regionChips)));

  // --- notas ---
  content.appendChild(h('section.card', field('Notas', textInput({
    multiline: true, rows: 3, value: ex.notes || '', placeholder: 'Técnica, ajustes de la máquina…', ariaLabel: 'Notas del ejercicio',
    onInput: (v) => { ex.notes = v; persist(true); },
  }))));

  // --- crear (solo nuevo) ---
  async function create() {
    const err = L.validateExerciseName(ex.name, store.exercisesList({ includeArchived: true }));
    if (err) {
      showErr(err);
      nameInp.scrollIntoView({ block: 'center' });
      nameInp.focus();
      return;
    }
    const obj = {
      id: uid('ex_'),
      name: ex.name.trim(),
      aliases: L.parseAliases((ex.aliases || []).join(',')),
      primary: [...(ex.primary || [])],
      secondary: (ex.secondary || []).filter((m) => !(ex.primary || []).includes(m)),
      pattern: ex.pattern || (ex.logType === 'cardio' ? 'cardio' : 'isolation'),
      logType: ex.logType || 'weight_reps',
      category: ex.category || 'isolation',
      region: ex.region || 'upper',
      notes: (ex.notes || '').trim(),
      custom: true,
      archived: false,
    };
    if (obj.logType === 'cardio') obj.sport = ex.sport || 'run';
    await store.save('exercises', obj);
    clearDraft();
    navigate(`#/exercise/${obj.id}`, { replace: true });
    toast(`Ejercicio «${obj.name}» creado`, { kind: 'success' });
  }
  if (isNew) {
    content.appendChild(h('button.btn.btn-primary.btn-lg.btn-block.lib-create', { type: 'button', onClick: create }, icon('check', 22), 'Crear ejercicio'));
    if (!restored) setTimeout(() => { try { nameInp.focus(); } catch { /* iOS */ } }, 300);
  }
  return undefined;
}
