// goals.js — Fase 3: objetivos. #/goals (lista con progreso, rango de fechas y «¿Por qué?»), #/goal/new y #/goal/:id
// (crear, editar, archivar y borrar con deshacer) y goalsSummaryCard() para Hoy y Progreso.
// PROPIETARIO: módulo de objetivos. Los cálculos salen de js/goals-logic.js (puro); aquí solo DOM y store.
import * as store from '../store.js';
import { navigate, back } from '../router.js';
import { h, icon, screen, segmented, chips, stepper, durationInput, textInput, numInput, confirmDialog, undoToast, toast, emptyState, whyBox } from '../ui.js';
import { pickExercise } from '../pickers.js';
import { dataFromStore } from '../progress-ui.js';
import { exerciseHistory } from '../stats.js';
import { bwStats } from '../activity-logic.js';
import { e1rm } from '../calc.js';
import { uid, todayStr, fmtNum, numToInput, fmtPace, fmtSigned, round, diffDays } from '../util.js';
import * as G from '../goals-logic.js';

const DRAFT_KEY = 'entreno.goalDraft';
const KINDS = G.GOAL_KINDS.map((k) => k.value);
const SPORT_LABEL = Object.fromEntries(G.GOAL_SPORTS.map((s) => [s.value, s.label]));
const DEFAULT_DIST = { run: 10, bike: 40, swim: 1.5 };
const KIND_NAME = { strength: 'Fuerza', endurance: 'Resistencia', bodyweight: 'Peso corporal' };
const BADGE = { achieved: 'badge-ok', ready: 'badge-accent', estimate: 'badge-info', insufficient: '', no_trend: 'badge-warn' };
const WATCHED = new Set(['goals', 'sessions', 'bodyweight', 'exercises', 'meta']);
/** Secciones plegadas de #/goals (se conservan mientras la app está abierta). */
const fold = { achieved: false, archived: false };

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
}

const kg = (v) => `${fmtNum(v, 1)} kg`;
const NB = '\u00a0';
/** Evita cortes feos al partir líneas: «× 6», «16 sep», «120 kg» quedan juntos. */
const keep = (s) => String(s ?? '')
  .replace(/ × /g, `${NB}×${NB}`)
  .replace(/(\d) (kg|km|m|reps|min|s|h)(?=[\s.,)·]|$)/g, `$1${NB}$2`)
  .replace(/(\d{1,2}) (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/g, `$1${NB}$2`);
const statusKey = (p) => (p.ready ? 'ready' : p.status);

// ---------------------------------------------------------------------------
// Conseguido: achievedAt refleja lo que calcula goalProgress (fecha del registro que lo consiguió)
// ---------------------------------------------------------------------------
let syncing = 0;
function syncAchieved(goals, progress) {
  for (const g of goals) {
    const p = progress.get(g.id);
    if (!p || p.invalid) continue;
    const want = p.achievedOn || null;
    if ((g.achievedAt || null) === want) continue;
    g.achievedAt = want;
    syncing++;
    try { store.save('goals', g).catch(() => {}); } finally { syncing--; }
  }
}

function progressAll(data, goals) {
  return new Map(goals.map((g) => [g.id, G.goalProgress(data, g)]));
}

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

function kindLabel(goal, p) {
  if (goal.kind === 'strength') return p.metric === 'reps' ? 'Fuerza · repeticiones' : 'Fuerza · 1RM estimado';
  if (goal.kind === 'endurance') return `${SPORT_LABEL[goal.sport] || 'Resistencia'} · ${goal.timeSec > 0 ? 'predicción de Riegel' : 'distancia'}`;
  return 'Peso corporal · media de 7 días';
}

/** Línea corta del estado: rango de fechas, datos insuficientes (con recuentos), sin tendencia, conseguido. */
function etaLine(p, today) {
  if (p.invalid) return p.explanation;
  switch (statusKey(p)) {
    case 'achieved': return `Conseguido el ${G.fmtDay(p.achievedOn, today)}`;
    case 'ready': return 'Al alcance: tu nivel actual ya llega al objetivo';
    case 'estimate': return `Estimación: ${p.etaText}`;
    case 'no_trend': return p.stall
      ? `Sin tendencia: estancado desde el ${G.fmtDay(p.stall.since, today)} (${p.stall.bestLabel})`
      : 'Sin tendencia: con la tendencia actual no se acerca';
    default: {
      const c = p.counts;
      const parts = [];
      if (c && c.missingRecords) parts.push(`${c.records} de ${c.minRecords} registros`);
      if (c && c.missingWeeks) parts.push(`${c.weeks} de ${c.minWeeks} semanas`);
      else if (c && c.missingSpan) parts.push(`solo ${c.spanDays} de ${c.minSpanDays} días entre el primero y el último`);
      return parts.length ? `Datos insuficientes: ${parts.join(', ')}` : 'Datos insuficientes';
    }
  }
}

/** Contenido del «¿Por qué?»: explicación, método, regla y los datos usados. */
function whyContent(p) {
  const items = [h('p', p.explanation)];
  if (p.method) items.push(h('p', h('b', 'Método. '), p.method));
  if (p.warning) items.push(h('p.goal-why-warn', p.warning));
  if (p.rule) items.push(h('p', h('b', 'Regla. '), p.rule));
  if (p.dataUsed && p.dataUsed.length) {
    items.push(h('p', h('b', `Datos usados (${p.dataUsed.length}):`)));
    items.push(h('ul.goal-why-data', p.dataUsed.map((d) => h('li', h('span.goal-why-date', `${d.label}: `), d.value))));
  } else if (!p.invalid) {
    items.push(h('p', h('b', 'Datos usados: '), 'ningún registro en la ventana de la tendencia.'));
  }
  return h('div.goal-why', items);
}

/** Valores, barra de progreso, línea de estado y «¿Por qué?» de un objetivo (lista sin huecos: se usa con replaceChildren). */
function goalBody(goal, p, today) {
  const k = statusKey(p);
  const pct = p.progressPct;
  const w = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const pctTxt = pct == null ? '—' : `${fmtNum(Math.floor(pct), 0)} %`;
  const right = p.metric === 'distance' ? `de ${p.targetLabel}` : p.start != null ? `Inicio ${p.startLabel}` : '';
  return [
    h('div.goal-values',
      h('div.goal-val', h('span.goal-val-k', 'Actual'), h('span.goal-val-v', p.currentLabel), h('span.goal-val-n', keep(p.currentNote))),
      h('div.goal-val', h('span.goal-val-k', 'Objetivo'), h('span.goal-val-v', p.targetLabel), h('span.goal-val-n', keep(p.targetNote)))),
    h('div.goal-bar', {
      role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(w)),
      'aria-label': `Progreso hacia «${goal.title}»`,
    }, h('span.goal-bar-fill', { style: { width: `${w.toFixed(1)}%` } })),
    h('div.goal-bar-meta', h('span.goal-pct', pctTxt), right ? h('span', right) : null),
    h(`p.goal-eta.goal-eta-${k}`, keep(etaLine(p, today))),
    p.warning && k !== 'achieved'
      ? h('p.goal-warn', `Riegel está pensada para carrera: en ${goal.sport === 'bike' ? 'bici' : 'natación'} tómalo como una referencia aproximada.`)
      : null,
    whyBox(whyContent(p)),
  ].filter(Boolean);
}

function goalCard(goal, p, today) {
  const k = statusKey(p);
  return h('section.card.goal-card', { dataset: { goal: goal.id, status: k } },
    h('button.goal-head', { type: 'button', onClick: () => navigate(`#/goal/${goal.id}`) },
      h('span.goal-emoji', { 'aria-hidden': 'true' }, G.goalEmoji(goal)),
      h('span.goal-titles',
        h('span.goal-title', keep(goal.title || 'Objetivo')),
        h('span.goal-meta',
          h(`span.badge.goal-badge${BADGE[k] ? `.${BADGE[k]}` : ''}`, p.statusLabel),
          goal.archived ? h('span.badge.goal-badge-arch', 'Archivado') : null,
          h('span.goal-kind', kindLabel(goal, p)))),
      icon('chevron-right', 20, 'goal-chev')),
    goalBody(goal, p, today));
}

/** Sección plegable («Conseguidos (2)», «Archivados (1)»). */
function foldSection(key, label, goals, render) {
  if (!goals.length) return null;
  const body = h('div.goal-fold-body', { hidden: !fold[key] }, goals.map(render));
  let chev = icon(fold[key] ? 'chevron-up' : 'chevron-down', 20);
  const btn = h('button.goal-fold', {
    type: 'button',
    'aria-expanded': String(fold[key]),
    onClick: () => {
      fold[key] = !fold[key];
      body.hidden = !fold[key];
      btn.setAttribute('aria-expanded', String(fold[key]));
      const next = icon(fold[key] ? 'chevron-up' : 'chevron-down', 20);
      chev.replaceWith(next);
      chev = next;
    },
  }, h('span.goal-fold-label', `${label} (${goals.length})`), chev);
  return h('section.goal-fold-wrap', { dataset: { fold: key } }, btn, body);
}

// ===========================================================================
// #/goals
// ===========================================================================

export function mountGoals(root) {
  const c = screen(root, {
    title: 'Objetivos',
    back: '#/progress',
    actions: [{ icon: 'plus', label: 'Nuevo objetivo', onClick: () => navigate('#/goal/new') }],
  });
  c.classList.add('goal-screen');

  function paint() {
    // Conserva los «¿Por qué?» abiertos al repintar.
    const openWhy = new Set([...c.querySelectorAll('.goal-card')].filter((el) => el.querySelector('.why-btn.open')).map((el) => el.dataset.goal));
    const today = todayStr();
    const data = dataFromStore(today);
    const goals = store.all('goals');
    const prog = progressAll(data, goals);
    syncAchieved(goals, prog);
    const { active, achieved, archived } = G.splitGoals(goals);
    const card = (g) => goalCard(g, prog.get(g.id), today);
    const newBtn = h('button.btn.btn-primary.btn-lg.btn-block.goal-new', { type: 'button', onClick: () => navigate('#/goal/new') }, icon('plus', 22), 'Nuevo objetivo');
    const nodes = [];
    if (!goals.length) {
      nodes.push(emptyState({
        emoji: '🎯',
        title: 'Sin objetivos todavía',
        text: 'Crea un objetivo de fuerza («Remo 80 kg × 5»), de resistencia («10 km en menos de 45 min») o de peso corporal. Verás tu progreso y, con datos suficientes, un rango de fechas estimado.',
        action: { label: 'Nuevo objetivo', onClick: () => navigate('#/goal/new') },
      }));
    } else {
      nodes.push(h('p.goal-note', icon('info', 18), h('span', G.NONLINEAR_NOTE)));
      if (active.length) nodes.push(h('div.goal-list', active.map(card)));
      else nodes.push(h('p.goal-none.muted', 'No tienes objetivos activos.'));
      nodes.push(newBtn);
      nodes.push(foldSection('achieved', 'Conseguidos', achieved, card));
      nodes.push(foldSection('archived', 'Archivados', archived, card));
    }
    c.replaceChildren(...nodes.filter(Boolean));
    for (const id of openWhy) c.querySelector(`.goal-card[data-goal="${CSS.escape(id)}"] .why-btn`)?.click();
  }
  paint();

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paint(); });
  };
  const offChange = store.on('change', (d) => { if (!syncing && WATCHED.has(d.store)) schedule(); });
  const offReset = store.on('reset', schedule);
  return () => {
    offChange();
    offReset();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}

// ===========================================================================
// #/goal/new y #/goal/:id
// ===========================================================================

function blankDraft(params = {}) {
  return {
    kind: KINDS.includes(params.kind) ? params.kind : 'strength',
    exerciseId: params.exercise && store.exercise(params.exercise) ? params.exercise : null,
    weight: null,
    reps: 5,
    sport: 'run',
    distanceKm: DEFAULT_DIST.run,
    timeSec: null,
    targetKg: null,
    direction: null,
    title: '',
    titleAuto: true,
  };
}
function loadDraft() {
  try {
    const d = JSON.parse(lsGet(DRAFT_KEY) || 'null');
    // Solo cuenta como borrador si el usuario llegó a tocar algún dato (cambiar de tipo no basta).
    return d && typeof d === 'object' && KINDS.includes(d.kind) && d.dirty ? { ...blankDraft(), ...d } : null;
  } catch { return null; }
}
const saveDraft = (d) => lsSet(DRAFT_KEY, JSON.stringify(d));
const clearDraft = () => lsSet(DRAFT_KEY, null);

function notFound(root) {
  const c = screen(root, { title: 'Objetivo', back: '#/goals' });
  c.appendChild(emptyState({ emoji: '🔍', title: 'Objetivo no encontrado', text: 'Puede que se haya borrado.', action: { label: 'Ver objetivos', onClick: () => navigate('#/goals', { replace: true }) } }));
}

/** Peso sugerido al elegir el ejercicio: el más alto de tus series de trabajo + 2,5 kg (sin historial: vacío). */
function suggestWeight(data, ex) {
  const hist = exerciseHistory(data, ex.id, { labels: false });
  let max = null;
  for (const e of hist) if (e.maxWeight != null && (max == null || e.maxWeight > max)) max = e.maxWeight;
  if (ex.logType === 'bodyweight') return max != null && max > 0 ? round(max + 2.5, 1.25) : 0;
  return max != null ? round(max, 2.5) + 2.5 : null;
}

const presetLabel = (sport, km) => {
  if (sport === 'run' && Math.abs(km - 21.0975) < 0.01) return 'Media (21,1 km)';
  if (sport === 'run' && Math.abs(km - 42.195) < 0.01) return 'Maratón (42,2 km)';
  return G.fmtDistance(sport, km);
};

export function mountGoalEdit(root, params = {}) {
  const editId = params.id || null;
  const isNew = !editId;
  let saved = isNew ? null : store.get('goals', editId);
  if (!isNew && !saved) { notFound(root); return undefined; }
  const today = todayStr();
  const data = dataFromStore(today); // los registros no cambian mientras se edita el objetivo
  let restored = false;
  let form;
  if (isNew) {
    const d = loadDraft();
    restored = !!d;
    form = d || blankDraft(params);
  } else {
    form = { ...saved };
    if (form.titleAuto === undefined) form.titleAuto = !form.title || form.title === G.autoTitle(form, store.exercise(form.exerciseId));
  }
  const createdAt = isNew ? Date.now() : saved.createdAt;
  let dirManual = !!form.direction && !isNew;

  const content = screen(root, {
    title: isNew ? 'Nuevo objetivo' : 'Editar objetivo',
    subtitle: isNew ? null : `${KIND_NAME[form.kind] || 'Objetivo'} · los cambios se guardan solos`,
    back: '#/goals',
    actions: isNew ? [{ text: 'Crear', label: 'Crear objetivo', onClick: () => create() }] : [],
  });
  content.classList.add('goal-form');

  const exOf = () => (form.exerciseId ? store.exercise(form.exerciseId) : null);

  // ---------- errores por campo ----------
  const errEls = {};
  const errEl = (key) => (errEls[key] = errEls[key] || h('p.form-error', { hidden: true, role: 'alert', dataset: { err: key } }));
  let showErrs = !isNew; // en uno nuevo, los errores se enseñan al pulsar «Crear»
  function paintErrors(errs) {
    for (const [key, el] of Object.entries(errEls)) {
      const msg = showErrs ? errs[key] : null;
      el.textContent = msg || '';
      el.hidden = !msg;
    }
  }

  if (restored) {
    content.appendChild(h('div.banner.banner-info.goal-draft',
      h('div.banner-main', h('div.banner-title', 'Borrador recuperado'), h('div.banner-text', 'Tenías un objetivo a medias.')),
      h('button.btn.btn-ghost', { type: 'button', onClick: () => { clearDraft(); navigate('#/goal/new', { replace: true }); } }, 'Vaciar')));
  }

  // ---------- tipo ----------
  const kindBox = h('div.goal-kind-box');
  if (isNew) {
    content.appendChild(h('section.card',
      h('div.field', h('span.field-label', 'Tipo de objetivo'),
        segmented({ options: G.GOAL_KINDS, value: form.kind, ariaLabel: 'Tipo de objetivo', onChange: (v) => { if (v === form.kind) return; form.kind = v; paintKind(); changed({ dirty: false }); } }))));
  }
  content.appendChild(kindBox);

  // ---------- título ----------
  const autoT = () => G.autoTitle(form, exOf());
  const titleInp = textInput({
    value: form.titleAuto !== false ? autoT() : form.title,
    placeholder: 'Título del objetivo', maxlength: 80, ariaLabel: 'Título del objetivo',
    onInput: (v) => {
      form.title = v;
      form.titleAuto = v.trim() === '';
      autoBtn.hidden = !!form.titleAuto;
      changed({ soon: true, keepTitle: true });
    },
  });
  titleInp.addEventListener('change', () => { if (form.titleAuto !== false) titleInp.value = autoT(); });
  const autoBtn = h('button.btn.btn-ghost.goal-title-auto', {
    type: 'button',
    hidden: form.titleAuto !== false,
    onClick: () => { form.titleAuto = true; form.title = ''; titleInp.value = autoT(); autoBtn.hidden = true; changed(); },
  }, icon('refresh', 18), 'Usar el título automático');
  function paintTitle() {
    if (form.titleAuto !== false && document.activeElement !== titleInp) titleInp.value = autoT();
  }
  content.appendChild(h('section.card',
    h('label.field', h('span.field-label', 'Título'), titleInp,
      h('span.field-hint', 'Se genera con los datos del objetivo; puedes cambiarlo.')),
    autoBtn));

  // ---------- vista previa con tus datos ----------
  const preview = h('section.card.goal-preview', { dataset: { preview: '1' } });
  content.appendChild(preview);
  let prevTimer = null;
  function paintPreview() {
    clearTimeout(prevTimer);
    prevTimer = null;
    const ex = exOf();
    const errs = G.validateGoal(form, ex);
    const head = h('div.goal-preview-head', h('span.goal-preview-title', 'Con tus datos'), h('span.goal-preview-sub', isNew ? 'cómo irías si lo creas hoy' : 'se recalcula con cada registro'));
    if (Object.keys(errs).length) {
      preview.replaceChildren(head, h('p.muted.goal-preview-empty', 'Completa los datos del objetivo para ver tu progreso y la estimación.'));
      return;
    }
    const g = tmpGoal(ex);
    const p = G.goalProgress(data, g);
    preview.dataset.status = statusKey(p);
    preview.replaceChildren(head, ...goalBody(g, p, today));
  }
  const schedulePreview = () => { clearTimeout(prevTimer); prevTimer = setTimeout(paintPreview, 180); };
  function tmpGoal(ex) {
    const dir = form.kind === 'bodyweight' && !form.direction ? autoDirection() : form.direction;
    const g = G.goalRecord({ ...(saved || {}), ...form, direction: form.kind === 'bodyweight' ? dir : form.direction, createdAt }, ex, { id: saved ? saved.id : 'nuevo' });
    return g;
  }

  // ---------- acciones ----------
  if (isNew) {
    content.appendChild(h('button.btn.btn-primary.btn-lg.btn-block.goal-create', { type: 'button', onClick: () => create() }, icon('check', 22), 'Crear objetivo'));
  } else {
    const archBtn = h('button.btn.btn-secondary.goal-archive', { type: 'button', onClick: toggleArchive }, saved.archived ? 'Desarchivar' : 'Archivar');
    content.appendChild(h('div.goal-actions',
      h('p.field-hint', 'Archivar lo quita de la lista de activos y de Hoy sin borrarlo; puedes desarchivarlo cuando quieras.'),
      h('div.btn-row',
        archBtn,
        h('button.btn.btn-danger-ghost.goal-delete', { type: 'button', onClick: onDelete }, icon('trash', 20), 'Borrar'))));
    async function toggleArchive() {
      saved.archived = !saved.archived;
      form.archived = saved.archived;
      archBtn.textContent = saved.archived ? 'Desarchivar' : 'Archivar';
      await store.save('goals', saved);
      toast(saved.archived ? 'Archivado: ya no aparece entre los activos ni en Hoy. Se conserva en «Archivados».' : 'Desarchivado: vuelve a la lista de objetivos.', { kind: 'success', duration: 4500 });
    }
    async function onDelete() {
      const title = saved.title || 'Objetivo';
      const ok = await confirmDialog({
        title: `¿Borrar «${title}»?`,
        message: 'Se borra el objetivo, no tus sesiones ni tus pesajes. Podrás deshacerlo justo después.',
        confirmText: 'Borrar objetivo', danger: true,
      });
      if (!ok) return;
      const removed = await store.remove('goals', saved.id);
      back('#/goals');
      undoToast(`Objetivo «${title}» borrado`, () => { if (removed) store.restore('goals', removed); });
    }
  }

  // ---------- guardar ----------
  function changed({ soon = false, keepTitle = false, dirty = true } = {}) {
    if (!keepTitle) paintTitle();
    const ex = exOf();
    const errs = G.validateGoal(form, ex);
    paintErrors(errs);
    if (isNew) {
      if (dirty) form.dirty = true;
      saveDraft(form);
      schedulePreview();
      return;
    }
    if (!Object.keys(errs).length) {
      const rec = tmpGoal(ex);
      const p = G.goalProgress(data, rec);
      if (!p.invalid) rec.achievedAt = p.achievedOn || null;
      rec.archived = !!saved.archived;
      saved = rec;
      if (soon) store.saveSoon('goals', rec);
      else store.save('goals', rec).catch(() => {});
    }
    schedulePreview();
  }

  let creating = false;
  async function create() {
    if (creating) return; // doble toque (botón de la cabecera y el de abajo)
    const ex = exOf();
    const errs = G.validateGoal(form, ex);
    showErrs = true;
    paintErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      const el = errEls[first];
      if (el) el.scrollIntoView({ block: 'center' });
      toast('Revisa los datos marcados.', { kind: 'error' });
      return;
    }
    creating = true;
    if (form.kind === 'bodyweight' && !form.direction) form.direction = autoDirection();
    const rec = G.goalRecord(form, ex, { id: uid('goal_'), now: Date.now() });
    const p = G.goalProgress(dataFromStore(todayStr()), rec);
    rec.achievedAt = p.invalid ? null : p.achievedOn || null;
    await store.save('goals', rec);
    clearDraft();
    back('#/goals');
    toast(rec.achievedAt ? `Objetivo «${rec.title}» creado: ya lo tienes conseguido (${G.fmtDay(rec.achievedAt)}).` : `Objetivo «${rec.title}» creado`, { kind: 'success', duration: 4500 });
  }

  // ---------- secciones por tipo ----------
  function autoDirection() {
    const s = bwStats(store.bodyweightList(), today);
    if (!s.count || !(form.targetKg > 0)) return 'up';
    return form.targetKg < s.ma7 ? 'down' : 'up';
  }

  function paintKind() {
    for (const k of Object.keys(errEls)) delete errEls[k];
    if (form.kind === 'strength') kindBox.replaceChildren(...strengthSection());
    else if (form.kind === 'endurance') kindBox.replaceChildren(...enduranceSection());
    else kindBox.replaceChildren(...bodyweightSection());
    paintErrors(G.validateGoal(form, exOf()));
  }

  function strengthSection() {
    const ex = exOf();
    const isBw = !!ex && ex.logType === 'bodyweight';
    const pickBtn = h('button.goal-pick', { type: 'button', onClick: choose, dataset: { pick: 'exercise' } },
      h('span.goal-pick-main',
        h('span.goal-pick-label', 'Ejercicio'),
        h('span.goal-pick-name', ex ? ex.name : 'Elegir ejercicio')),
      icon('chevron-right', 20));
    async function choose() {
      const id = await pickExercise({
        title: 'Ejercicio del objetivo',
        filter: (e) => G.STRENGTH_LOG_TYPES.includes(e.logType),
        allowCreate: false,
      });
      if (!id || !kindBox.isConnected) return;
      const ex2 = store.exercise(id);
      const typeChanged = !ex || ex.logType !== ex2.logType;
      form.exerciseId = id;
      if (form.weight == null || typeChanged) form.weight = suggestWeight(data, ex2);
      paintKind();
      changed();
    }
    const equiv = h('p.field-hint.goal-equiv');
    const paintEquiv = () => {
      const e = exOf();
      if (!e) { equiv.textContent = 'Solo ejercicios de peso × repeticiones, unilaterales o de peso corporal.'; return; }
      const R = form.reps;
      if (e.logType === 'bodyweight' && e.pattern === 'core') {
        equiv.textContent = 'En core con peso corporal no se estima el 1RM: se sigue el máximo de repeticiones con ese lastre.';
      } else if (R > 12) {
        equiv.textContent = 'Con más de 12 repeticiones no se estima el 1RM: se sigue el máximo de repeticiones con ese peso o más.';
      } else if (e.logType === 'bodyweight') {
        equiv.textContent = 'Lastre: 0 = sin lastre; negativo = asistencia. El 1RM estimado incluye tu peso corporal.';
      } else {
        const v = form.weight > 0 && R >= 1 ? e1rm(form.weight, R, 0) : null;
        equiv.textContent = v ? `Equivale a un 1RM estimado de ${kg(v)} (Epley). Se compara con el mejor 1RM estimado de tus sesiones.` : 'Indica el peso y las repeticiones.';
      }
    };
    const wSt = stepper({
      value: form.weight, step: 2.5, decimals: 2, min: isBw ? -200 : 0, max: isBw ? 300 : 1000, showStep: true, suffix: 'kg',
      size: 'lg', label: isBw ? 'Lastre' : 'Peso', ariaLabel: isBw ? 'Lastre (kg; negativo = asistencia)' : 'Peso (kg)',
      onChange: (v, { final }) => { form.weight = v; paintEquiv(); changed({ soon: !final }); },
    });
    wSt.dataset.field = 'weight';
    const rSt = stepper({
      value: form.reps, step: 1, decimals: 0, min: 1, max: 100, inputmode: 'numeric', size: 'lg', label: 'Repeticiones', ariaLabel: 'Repeticiones',
      onChange: (v, { final }) => { form.reps = v == null ? null : Math.round(v); paintEquiv(); changed({ soon: !final }); },
    });
    rSt.dataset.field = 'reps';
    paintEquiv();
    return [
      h('section.card',
        h('div.field', pickBtn, errEl('exerciseId')),
        h('div.field', wSt, errEl('weight')),
        h('div.field', rSt, errEl('reps')),
        equiv,
        h('p.field-hint', `Se da por conseguido con una serie de trabajo con ese peso y esas repeticiones o más, registrada desde ${isNew ? 'hoy' : `que lo creaste (${G.fmtDay(G.createdDateOf(saved), today)})`}.`)),
    ];
  }

  function enduranceSection() {
    const sport = G.GOAL_SPORTS.some((s) => s.value === form.sport) ? form.sport : 'run';
    form.sport = sport;
    const swim = sport === 'swim';
    const toInput = (km) => (km == null ? null : swim ? round(km * 1000, 1) : km);
    const matchPreset = () => G.DISTANCE_PRESETS[sport].find((km) => form.distanceKm != null && Math.abs(km - form.distanceKm) < 1e-6) ?? null;
    const sportSeg = segmented({
      options: G.GOAL_SPORTS, value: sport, ariaLabel: 'Deporte',
      onChange: (v) => { if (v === form.sport) return; form.sport = v; form.distanceKm = DEFAULT_DIST[v]; paintKind(); changed(); },
    });
    const dist = numInput({
      value: toInput(form.distanceKm), decimals: swim ? 0 : 3, inputmode: swim ? 'numeric' : 'decimal', suffix: swim ? 'm' : 'km',
      placeholder: swim ? '1500' : '10', ariaLabel: `Distancia (${swim ? 'm' : 'km'})`,
      onInput: (v) => { form.distanceKm = v == null ? null : swim ? v / 1000 : v; presets.setValue(matchPreset()); paintPace(); changed({ soon: true }); },
    });
    const presets = chips({
      options: G.DISTANCE_PRESETS[sport].map((km) => ({ value: km, label: presetLabel(sport, km) })),
      value: matchPreset(),
      className: 'goal-presets',
      onChange: (km) => { form.distanceKm = km; dist.input.value = numToInput(toInput(km), swim ? 0 : 3); paintPace(); changed(); },
    });
    const durSlot = h('div.goal-dur');
    const clearBtn = h('button.btn.btn-ghost.goal-dur-clear', {
      type: 'button', hidden: !(form.timeSec > 0),
      onClick: () => { form.timeSec = null; paintDur(); clearBtn.hidden = true; paintPace(); changed(); },
    }, icon('x', 18), 'Quitar tiempo');
    function paintDur() {
      durSlot.replaceChildren(durationInput({
        seconds: form.timeSec > 0 ? form.timeSec : null, showHours: true, showSeconds: true, ariaLabel: 'Tiempo objetivo',
        onChange: (sec) => { form.timeSec = sec > 0 ? sec : null; clearBtn.hidden = !form.timeSec; paintPace(); changed({ soon: true }); },
      }));
    }
    paintDur();
    const pace = h('p.field-hint.goal-pace');
    const how = h('p.field-hint.goal-how');
    function paintPace() {
      const D = form.distanceKm;
      const T = form.timeSec;
      if (D > 0 && T > 0) {
        pace.hidden = false;
        pace.textContent = sport === 'bike' ? `Velocidad objetivo: más de ${fmtNum(D / (T / 3600), 1)} km/h`
          : sport === 'swim' ? `Ritmo objetivo: menos de ${fmtPace(T / (D * 10), '/100 m')}`
            : `Ritmo objetivo: menos de ${fmtPace(T / D)}`;
      } else pace.hidden = true;
      how.textContent = T > 0
        ? sport === 'run'
          ? `Se estima con la fórmula de Riegel a partir de tus carreras de ${G.fmtDistance('run', Math.min(G.MIN_KM.run, D || G.MIN_KM.run))} o más.`
          : `Se estima con la fórmula de Riegel, pensada para carrera: en ${sport === 'bike' ? 'bici' : 'natación'} es menos fiable.`
        : 'Sin tiempo, el objetivo es completar la distancia en una sesión.';
      how.classList.toggle('goal-how-warn', T > 0 && sport !== 'run');
    }
    paintPace();
    return [
      h('section.card',
        h('div.field', h('span.field-label', 'Deporte'), sportSeg, errEl('sport')),
        h('div.field', h('label.field', h('span.field-label', `Distancia (${swim ? 'm' : 'km'})`), dist), presets, errEl('distanceKm')),
        h('div.field',
          h('span.field-label', 'Tiempo (opcional)'),
          durSlot,
          errEl('timeSec'),
          pace,
          clearBtn),
        how),
    ];
  }

  function bodyweightSection() {
    const s = bwStats(store.bodyweightList(), today);
    if (form.targetKg == null) form.targetKg = s.count ? round(s.ma7, 0.5) + 1 : round(store.settings()?.bodyweightDefault ?? 75, 0.5);
    const info = s.count
      ? `Media de 7 días actual: ${kg(s.ma7)}${s.trend.ok ? ` · tendencia ${fmtSigned(s.trend.kgPerWeek, 2)} kg/sem` : ''}.`
      : 'Sin pesajes todavía: registra tu peso en Peso corporal para ver el progreso.';
    if (!form.direction) form.direction = autoDirection();
    const dirSeg = segmented({
      options: [{ value: 'up', label: 'Subir' }, { value: 'down', label: 'Bajar' }], value: form.direction, ariaLabel: 'Subir o bajar',
      onChange: (v) => { form.direction = v; dirManual = true; changed(); },
    });
    const st = stepper({
      value: form.targetKg, step: 0.5, decimals: 1, min: 20, max: 300, showStep: true, suffix: 'kg', size: 'lg',
      label: 'Peso objetivo', ariaLabel: 'Peso objetivo (kg)',
      onChange: (v, { final }) => {
        form.targetKg = v;
        if (!dirManual && s.count && v > 0) { form.direction = v < s.ma7 ? 'down' : 'up'; dirSeg.setValue(form.direction); }
        changed({ soon: !final });
      },
    });
    st.dataset.field = 'targetKg';
    return [
      h('section.card',
        h('p.goal-bw-info', info),
        h('div.field', st, errEl('targetKg')),
        h('div.field', h('span.field-label', 'Quiero'), dirSeg, errEl('direction')),
        h('p.field-hint', 'Se sigue la media móvil de 7 días (la de Peso corporal), no el pesaje de un día: una fluctuación aislada no cuenta como tendencia.')),
    ];
  }

  paintKind();
  paintTitle();
  paintPreview();
  if (!isNew) paintErrors(G.validateGoal(form, exOf()));
  return () => {
    clearTimeout(prevTimer);
    if (!isNew) store.flush();
  };
}

// ===========================================================================
// CONTRATO (lo usan Hoy y Progreso): tarjeta breve con los objetivos activos y su progreso.
// ===========================================================================
/** Qué mide la cifra «actual / objetivo» de la fila resumen (sin la ficha al lado, «107,7 kg / 105 kg» no se entiende). */
const SUM_METRIC = { e1rm: '1RM est. ', time: 'Predicción ', bodyweight: 'Media 7 días ' };
function sumValues(p) {
  const pre = p.currentLabel && p.currentLabel !== '—' ? SUM_METRIC[p.metric] || '' : '';
  return `${pre}${p.currentLabel} / ${p.targetLabel}`;
}

/**
 * Tarjeta con los objetivos activos (máx. `max`, los más nuevos primero) y, si queda hueco, los conseguidos en
 * los últimos 7 días: título, barra de progreso y rango de fechas o estado. Cada fila y «Ver todos» abren #/goals.
 * Devuelve null si no hay objetivos que mostrar.
 * @param {{data?:object, max?:number}} [opts] data = el de progress-ui.dataFromStore() si la vista ya lo tiene
 * @returns {HTMLElement|null}
 */
export function goalsSummaryCard({ data = null, max = 3 } = {}) {
  const goals = store.all('goals');
  if (!goals.length) return null;
  const today = (data && data.today) || todayStr();
  const d = data || dataFromStore(today);
  const prog = progressAll(d, goals);
  syncAchieved(goals, prog);
  const { active, achieved } = G.splitGoals(goals);
  const recent = achieved.filter((g) => g.achievedAt && diffDays(g.achievedAt, today) <= 7);
  const list = [...active, ...recent];
  if (!list.length) return null;
  const shown = list.slice(0, Math.max(1, max));
  const more = active.length - shown.filter((g) => !g.achievedAt).length;
  const rows = shown.map((g) => {
    const p = prog.get(g.id);
    const k = statusKey(p);
    const pct = p.progressPct == null ? 0 : Math.max(0, Math.min(100, p.progressPct));
    return h('button.goal-sum-row', { type: 'button', dataset: { goal: g.id, status: k }, onClick: () => navigate('#/goals') },
      h('span.goal-sum-top',
        h('span.goal-sum-name', `${G.goalEmoji(g)} ${keep(g.title)}`),
        h('span.goal-sum-pct', p.progressPct == null ? '—' : `${fmtNum(Math.floor(p.progressPct), 0)} %`)),
      h('span.goal-bar.goal-bar-sm', { 'aria-hidden': 'true' }, h('span.goal-bar-fill', { style: { width: `${pct.toFixed(1)}%` } })),
      h('span.goal-sum-eta', keep(`${etaLine(p, today)} · ${sumValues(p)}`)));
  });
  return h('section.card.goal-sum', { dataset: { goalsSummary: '1' } },
    h('div.card-head',
      h('div.card-title', '🎯 Objetivos'),
      h('button.goal-sum-link', { type: 'button', onClick: () => navigate('#/goals') }, 'Ver todos', icon('chevron-right', 18))),
    h('div.goal-sum-list', rows),
    more > 0 ? h('p.goal-sum-more', `${more === 1 ? 'Otro objetivo activo' : `Otros ${more} objetivos activos`} en Objetivos.`) : null);
}
