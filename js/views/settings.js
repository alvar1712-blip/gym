// settings.js — Ajustes: índice, semana tipo, umbrales y reglas, copias y datos.
// PROPIETARIO: módulo de ajustes. La lógica pura vive en ../backup.js (copias JSON, CSV)
// y ../settings-logic.js (umbrales, textos de la semana tipo). Todo se guarda al instante.
import * as store from '../store.js';
import { estimate } from '../db.js';
import { navigate, refresh } from '../router.js';
import { h, icon, screen, stepper, segmented, toast, undoToast, confirmDialog, sheet, shareFile, pickFile, isStandalone } from '../ui.js';
import { todayStr, fmtDate, dateFromTs, hhmm, relDay, plural, DAY_LONG, DAY_LETTER, dow, deepClone, round, clamp } from '../util.js';
import { defaultSettings, MUSCLES } from '../seed.js';
import { currentPattern, setWeekPattern } from '../plan.js';
import { pickTemplate } from '../pickers.js';
import {
  buildBackupObject, backupFileName, csvFileName, parseBackupText, strengthCsv, cardioCsv, csvCounts, dataCounts, formatBytes,
  localKeysToClear,
} from '../backup.js';
import {
  thresholdDefaults, getPath, setPath, fixPair, planLabel, shortPlanLabel, weekSummaryText, patternFromDate,
} from '../settings-logic.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const templatesMap = () => new Map(store.all('templates').map((t) => [t.id, t]));
const fmtStamp = (ts) => `${fmtDate(dateFromTs(ts), 'full')}, ${hhmm(ts)}`;

/** Recuento actual de lo que hay en el store (sin copiar los datos). */
const currentCounts = () => dataCounts(Object.fromEntries(store.STORES.map((s) => [s, store.all(s)])));

/** «12 sesiones de fuerza, 3 actividades…» (solo lo que hay; `all` incluye también los ceros principales). */
function countsText(c, { all = false, sep = ', ' } = {}) {
  const parts = [
    [c.strength, 'sesión de fuerza', 'sesiones de fuerza', true],
    [c.activities, 'actividad', 'actividades', true],
    [c.templates, 'plantilla', 'plantillas', true],
    [c.exercises, 'ejercicio', 'ejercicios', true],
    [c.bodyweight, 'pesaje', 'pesajes', true],
    [c.plan, 'día modificado en el calendario', 'días modificados en el calendario', false],
    [c.checkins, 'check-in', 'check-ins', false],
    [c.goals, 'objetivo', 'objetivos', false],
  ];
  return parts.filter(([n, , , main]) => n > 0 || (all && main)).map(([n, one, many]) => plural(n, one, many)).join(sep);
}

/**
 * Fila de lista que navega. La insignia va junto al título, dentro del bloque de texto (pasa debajo
 * si no cabe): al lado de la fila le quitaría el ancho al título y al subtítulo en pantallas de 375 px.
 */
function navRow({ ico, title, sub = null, href, warn = false, extra = null, badge = null, aria = null, className = '' }) {
  const titleEl = h('span.list-item-title', title);
  return h(`button.list-item.cfg-item${warn ? '.cfg-item-warn' : ''}`, {
    type: 'button',
    class: className || null,
    'aria-label': aria,
    onClick: () => navigate(href),
  },
  h(`span.cfg-ico${warn ? '.cfg-ico-warn' : ''}`, icon(ico, 20)),
  h('span.list-item-main',
    badge ? h('span.cfg-title-line', titleEl, badge) : titleEl,
    sub ? h('span.list-item-sub.wrap', sub) : null,
    extra),
  icon('chevron-right', 20, 'chev'));
}

/** «Última copia: 20 sep 2026 (hace 3 días)» o «Última copia: hoy, 10:32». */
function lastBackupShort(s = store.settings()) {
  if (!s.lastBackupAt) return 'Todavía no has hecho ninguna copia';
  const d = dateFromTs(s.lastBackupAt);
  const rel = relDay(d, todayStr());
  if (rel === 'hoy' || rel === 'ayer') return `Última copia: ${rel}, ${hhmm(s.lastBackupAt)}`;
  return `Última copia: ${fmtDate(d, 'full')} (${rel})`;
}

/**
 * Tras borrar todo o importar: quita de localStorage los borradores y el estado de pantallas de la app
 * (una actividad o un ejercicio a medias de los datos anteriores no debe reaparecer como «Borrador recuperado»).
 */
function clearLocalDrafts() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of localKeysToClear(keys)) localStorage.removeItem(k);
  } catch { /* sin almacenamiento */ }
}

/**
 * Anota la copia recién guardada. Si los ajustes no han cambiado desde que se generó el archivo, se guardan
 * tal cual van en él (mismo updatedAt): así exportar → borrar → importar deja los ajustes idénticos a los del
 * disco. Se anota DESPUÉS de compartir, nunca antes: si la app se cierra con la hoja abierta, la copia no consta.
 */
function markBackup(fileSettings, now) {
  const cur = store.settings();
  const same = !!fileSettings
    && JSON.stringify({ ...cur, lastBackupAt: now, updatedAt: null }) === JSON.stringify({ ...fileSettings, updatedAt: null });
  if (!same) return store.saveSettings({ lastBackupAt: now });
  // Mismo objeto (no un clon): un saveSoon pendiente de los ajustes escribiría este mismo contenido.
  cur.lastBackupAt = now;
  cur.updatedAt = fileSettings.updatedAt;
  return store.restore('meta', cur);
}

function overdueTitle(s = store.settings()) {
  return s.lastBackupAt
    ? `Hace más de ${plural(s.backupReminderDays ?? 7, 'día', 'días')} de tu última copia`
    : 'Aún no has hecho ninguna copia';
}

// ===========================================================================
// #/settings — índice
// ===========================================================================
export function mountSettings(root) {
  const c = screen(root, { title: 'Ajustes' });
  const s = store.settings();
  const overdue = store.backupOverdue();
  const tpls = templatesMap();
  const days = currentPattern();
  const exercises = store.exercisesList();
  const custom = exercises.filter((e) => e.custom).length;

  if (overdue) {
    c.appendChild(h('button.banner.banner-warn.cfg-banner', { type: 'button', onClick: () => navigate('#/settings/data') },
      icon('alert', 22),
      h('span.banner-main',
        h('span.banner-title', overdueTitle(s)),
        h('span.banner-text', 'Exporta una copia y guárdala en Archivos o Google Drive.')),
      icon('chevron-right', 20)));
  }

  c.append(
    h('div.section-title', 'Plan'),
    h('div.list',
      navRow({ ico: 'calendar', title: 'Semana tipo', href: '#/settings/week', extra: weekMini(days, tpls), aria: `Semana tipo: ${weekSummaryText(days, tpls)}`, className: 'cfg-week-row' }),
      navRow({ ico: 'sliders', title: 'Umbrales y reglas', sub: 'Series por músculo, progresión, avisos de carga, descarga', href: '#/settings/thresholds' })),
    h('div.section-title', 'Rutinas y ejercicios'),
    h('div.list',
      navRow({ ico: 'list', title: 'Rutinas', sub: plural(store.templatesList().length, 'rutina', 'rutinas'), href: '#/exercises?seg=templates' }),
      navRow({
        ico: 'dumbbell', title: 'Biblioteca de ejercicios',
        sub: `${plural(exercises.length, 'ejercicio', 'ejercicios')}${custom ? ` · ${plural(custom, 'propio', 'propios')}` : ''}`,
        href: '#/exercises?seg=library',
      })),
    h('div.section-title', 'Datos'),
    h('div.list',
      navRow({
        ico: 'download', title: 'Copias y datos', href: '#/settings/data', warn: overdue, className: 'cfg-data-row',
        sub: `${lastBackupShort(s)} · exportar, importar, CSV, borrar`,
        badge: overdue ? h('span.badge.badge-warn.cfg-badge', 'Copia pendiente') : null,
      })),
    h('div.section-title', 'Instalación'),
    installCard(),
    h('div.section-title', 'Acerca de'),
    h('div.card.cfg-about',
      h('div.row-between', h('div.card-title', 'Entreno'), h('span.badge.cfg-version', `versión ${store.APP_VERSION}`)),
      h('p.cfg-why', 'Sin servidor, sin cuentas: tus datos están solo en este iPhone; haz copias.'),
      h('p.cfg-hint', 'Funciona sin conexión y no envía nada a internet.')),
  );
}

/** Mini semana L–D con la etiqueta corta de cada día. */
function weekMini(days, tpls) {
  const t = dow(todayStr());
  return h('span.cfg-week-mini', { 'aria-hidden': 'true' }, DAY_LETTER.map((l, i) => {
    const p = planLabel(days[i], tpls);
    return h(`span.cfg-wm-day.cfg-wm-${p.kind}${i === t ? '.cfg-wm-today' : ''}${p.missing ? '.cfg-wm-missing' : ''}`,
      h('span.cfg-wm-letter', l),
      h('span.cfg-wm-label', shortPlanLabel(days[i], tpls)));
  }));
}

function installCard() {
  if (isStandalone()) {
    // Sin conexión solo funciona cuando el service worker ya controla la app (unos segundos tras la primera apertura).
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    const why = h('p.cfg-why');
    const paint = () => {
      why.textContent = sw && sw.controller
        ? 'Se abre a pantalla completa desde tu pantalla de inicio y funciona sin conexión.'
        : 'Se abre a pantalla completa desde tu pantalla de inicio. Aún no está lista sin conexión: mantén la app abierta con internet unos segundos.';
    };
    paint();
    if (sw && !sw.controller) sw.addEventListener('controllerchange', paint, { once: true });
    return h('div.card.cfg-install', { dataset: { installed: 'yes' } },
      h('div.row', h('span.cfg-check', icon('check', 18)), h('div.card-title', 'Instalada ✓')),
      why);
  }
  return h('div.card.cfg-install', { dataset: { installed: 'no' } },
    h('div.card-title', 'Añadir a la pantalla de inicio'),
    h('p.cfg-why', 'Instalada, la app se abre a pantalla completa, funciona sin conexión y iOS conserva mejor sus datos.'),
    h('ol.cfg-steps',
      h('li', 'Abre esta página en ', h('b', 'Safari'), '.'),
      h('li', 'Toca ', h('b', 'Compartir'), h('span.cfg-inline-ico', icon('share', 17)), ' (abajo en la barra de Safari).'),
      h('li', 'Elige ', h('b', 'Añadir a pantalla de inicio'), '. Si no aparece, desliza la lista hacia arriba.'),
      h('li', 'Pulsa ', h('b', 'Añadir'), ' y abre Entreno desde su icono.')),
    h('p.cfg-note', 'Safari y la app instalada guardan los datos por separado: si ya has registrado algo aquí, exporta una copia e impórtala desde la app instalada.'));
}

// ===========================================================================
// #/settings/week — semana tipo
// ===========================================================================
export function mountWeekPattern(root) {
  const c = screen(root, { title: 'Semana tipo', back: '#/settings' });
  const today = todayStr();
  const list = h('div.list.cfg-days');
  const info = h('p.cfg-hint.cfg-week-info');

  const rowFor = (i, days, tpls) => {
    const p = planLabel(days[i], tpls);
    const sub = p.kind === 'rest' ? 'Sin entrenamiento planificado'
      : p.kind === 'free' ? 'Sesión libre'
        : p.missing ? 'Toca para elegir otra rutina'
          : plural(p.items, 'ejercicio', 'ejercicios');
    return h('button.list-item.cfg-day', { type: 'button', dataset: { day: String(i), kind: p.kind }, onClick: () => edit(i) },
      h('span.cfg-day-name', cap(DAY_LONG[i]), i === dow(today) ? h('span.badge.badge-accent', 'Hoy') : null),
      h('span.list-item-main',
        h('span.list-item-title', { class: p.missing || p.archived ? 'warn' : null }, p.emoji ? `${p.emoji} ${p.text}` : p.text),
        h('span.list-item-sub', sub)),
      icon('chevron-right', 20, 'chev'));
  };

  function paintInfo() {
    const from = patternFromDate(store.settings(), today);
    info.textContent = from && from > '2000-01-01'
      ? `Vigente desde el ${fmtDate(from, 'full')}. Las semanas anteriores conservan la semana tipo que tenían.`
      : 'Es la semana tipo inicial.';
  }
  function paintAll() {
    const days = currentPattern();
    const tpls = templatesMap();
    list.replaceChildren(...DAY_LONG.map((_, i) => rowFor(i, days, tpls)));
    paintInfo();
  }
  function paintRow(i) {
    const old = list.children[i];
    const row = rowFor(i, currentPattern(), templatesMap());
    if (old) old.replaceWith(row); else list.appendChild(row);
    paintInfo();
  }
  /** Deshacer: vuelve a la lista de vigencias anterior tal cual. */
  const offerUndo = (msg, prev) => undoToast(msg, async () => {
    await store.saveSettings({ weekPatterns: prev });
    paintAll();
  });

  async function edit(i) {
    const choice = await pickTemplate({ title: `${cap(DAY_LONG[i])} · semana tipo`, includeRest: true, includeFree: true });
    if (!choice) return;
    const days = deepClone(currentPattern());
    if (JSON.stringify(days[i]) === JSON.stringify(choice)) return;
    const prev = deepClone(store.settings().weekPatterns);
    days[i] = choice;
    await setWeekPattern(days);
    paintRow(i);
    const p = planLabel(choice, templatesMap());
    offerUndo(`${cap(DAY_LONG[i])}: ${p.text}. Se aplica desde esta semana.`, prev);
  }

  async function restoreDefault() {
    const def = defaultSettings().weekPatterns[0].days;
    const ok = await confirmDialog({
      title: '¿Restaurar la semana por defecto?',
      message: `${weekSummaryText(def, templatesMap())}\n\nSe aplica desde esta semana; las semanas anteriores no cambian.`,
      confirmText: 'Restaurar',
    });
    if (!ok) return;
    const prev = deepClone(store.settings().weekPatterns);
    await setWeekPattern(def);
    paintAll();
    offerUndo('Semana tipo por defecto restaurada.', prev);
  }

  c.append(
    h('div.card.card-info.cfg-intro',
      h('p', 'Se aplica desde esta semana. Para cambiar solo una semana concreta usa el Calendario.'),
      h('button.btn.btn-ghost.btn-sm.cfg-intro-btn', { type: 'button', onClick: () => navigate('#/calendar') }, icon('calendar', 18), 'Abrir calendario')),
    list,
    info,
    h('button.btn.btn-secondary.btn-block.cfg-restore', { type: 'button', onClick: restoreDefault }, icon('refresh', 20), 'Restaurar semana por defecto'));
  paintAll();
}

// ===========================================================================
// #/settings/thresholds — umbrales y reglas
// ===========================================================================
const INT = { decimals: 0 };
const KG = { decimals: 2, suffix: 'kg' };

/**
 * Bloques de la pantalla. Cada campo: path (en settings), label, hint?, step, min, max, decimals, suffix?,
 * pair? + role ('lo'|'hi'): pareja mín ≤ máx que se corrige al terminar de escribir.
 */
const BLOCKS = [
  {
    id: 'muscles',
    title: 'Series semanales por músculo',
    why: 'Rango objetivo de series efectivas por semana. El panel semanal indica qué músculos quedan por debajo o por encima.',
    muscles: true,
  },
  {
    id: 'factors',
    title: 'Valor de cada serie',
    why: 'Cuánto suma una serie efectiva a las series semanales del músculo principal del ejercicio y de cada secundario.',
    fields: [
      { path: ['primaryFactor'], label: 'Músculo principal', step: 0.25, min: 0, max: 2, decimals: 2 },
      { path: ['secondaryFactor'], label: 'Músculo secundario', step: 0.25, min: 0, max: 2, decimals: 2 },
    ],
  },
  {
    id: 'progression',
    title: 'Doble progresión',
    why: 'Si en la última sesión completas todas las series efectivas en el tope del rango con al menos el RIR mínimo, se sugiere subir este peso; si no, mantenerlo y buscar más repeticiones.',
    fields: [
      { path: ['increments', 'upperCompound'], label: 'Compuesto tren superior', step: 0.5, min: 0, max: 20, ...KG },
      { path: ['increments', 'lowerCompound'], label: 'Compuesto tren inferior', step: 0.5, min: 0, max: 20, ...KG },
      { path: ['increments', 'isolation'], label: 'Aislamiento', step: 0.5, min: 0, max: 20, ...KG },
      { path: ['progression', 'minRir'], label: 'RIR mínimo para subir', step: 1, min: 0, max: 5, ...INT },
    ],
  },
  {
    id: 'load',
    title: 'Aviso de carga semanal',
    why: 'Compara la carga de la semana (minutos × esfuerzo) con la media de las 4 semanas previas. Al superar el umbral bajo aparece un aviso prudente y al superar el alto, uno más marcado. No es una predicción de lesión.',
    fields: [
      { path: ['loadWarn', 'low'], label: 'Umbral bajo', hint: 'subida sobre la media', step: 5, min: 0, max: 200, suffix: '%', ...INT, pair: ['loadWarn', 'high'], role: 'lo' },
      { path: ['loadWarn', 'high'], label: 'Umbral alto', step: 5, min: 0, max: 200, suffix: '%', ...INT, pair: ['loadWarn', 'low'], role: 'hi' },
    ],
  },
  {
    id: 'runkm',
    title: 'Aviso de km de carrera',
    why: 'Igual que el anterior, con los kilómetros semanales de carrera: aviso si suben más de este porcentaje.',
    fields: [
      { path: ['runKmWarn', 'low'], label: 'Umbral bajo', step: 1, min: 0, max: 100, suffix: '%', ...INT, pair: ['runKmWarn', 'high'], role: 'lo' },
      { path: ['runKmWarn', 'high'], label: 'Umbral alto', step: 1, min: 0, max: 100, suffix: '%', ...INT, pair: ['runKmWarn', 'low'], role: 'hi' },
    ],
  },
  {
    id: 'stall',
    title: 'Estancamiento',
    why: 'Un ejercicio se considera estancado si su 1RM estimado no mejora en este número de sesiones o de semanas.',
    fields: [
      { path: ['stall', 'sessions'], label: 'Sesiones sin mejora', step: 1, min: 2, max: 20, ...INT },
      { path: ['stall', 'weeks'], label: 'Semanas sin mejora', step: 1, min: 1, max: 26, ...INT },
    ],
  },
  {
    id: 'deload',
    title: 'Sugerencia de descarga',
    why: 'Se sugiere una semana de descarga si coinciden varios ejercicios estancados, esfuerzo percibido alto sostenido y, si lo registras, check-in bajo.',
    fields: [
      { path: ['deload', 'minStalled'], label: 'Ejercicios estancados', hint: 'como mínimo', step: 1, min: 1, max: 20, ...INT },
      { path: ['deload', 'rpeHigh'], label: 'Esfuerzo alto', hint: 'RPE medio desde', step: 0.5, min: 1, max: 10, decimals: 1 },
      { path: ['deload', 'weeks'], label: 'Semanas seguidas', step: 1, min: 1, max: 8, ...INT },
    ],
  },
  {
    id: 'goals',
    title: 'Estimación de objetivos',
    why: 'La fecha estimada de un objetivo solo se calcula con datos suficientes; si no, se indica «datos insuficientes».',
    fields: [
      { path: ['goals', 'minRecords'], label: 'Registros mínimos', step: 1, min: 2, max: 50, ...INT },
      { path: ['goals', 'minWeeks'], label: 'Semanas mínimas', step: 1, min: 1, max: 52, ...INT },
    ],
  },
  {
    id: 'backup',
    title: 'Recordatorio de copia',
    why: 'Aviso en Hoy y en Ajustes cuando pasan más de estos días desde la última copia de seguridad.',
    fields: [{ path: ['backupReminderDays'], label: 'Días sin copia', step: 1, min: 1, max: 90, ...INT }],
  },
  {
    id: 'bodyweight',
    title: 'Peso corporal por defecto',
    why: 'Se usa para la carga y el 1RM de los ejercicios de peso corporal (dominadas, fondos…) mientras no registres tu peso.',
    fields: [{ path: ['bodyweightDefault'], label: 'Peso', step: 0.5, min: 30, max: 250, decimals: 1, suffix: 'kg' }],
  },
];

export function mountThresholds(root) {
  const c = screen(root, { title: 'Umbrales y reglas', back: '#/settings' });
  const steppers = new Map(); // 'a.b.c' → stepper (para corregir la pareja)
  const key = (path) => path.join('.');

  /** Guarda un valor: saveSoon mientras se teclea, save al terminar (botón o salir del campo). */
  function onValue(f, st, v, final) {
    const s = store.settings();
    const dec = f.decimals ?? 0;
    if (v == null) {
      if (final) st.setValue(getPath(s, f.path) ?? null); // campo vaciado: vuelve al valor guardado
      return;
    }
    v = round(v, 10 ** -dec);
    if (!final) {
      if (v < f.min || v > f.max) return; // se corrige al salir del campo
      const other = f.pair ? getPath(s, f.pair) : null;
      if (other != null && (f.role === 'lo' ? v > other : v < other)) return; // pareja incoherente: esperar al final
    } else {
      v = clamp(v, f.min, f.max);
      st.setValue(v);
    }
    setPath(s, f.path, v);
    if (final && f.pair) {
      const other = getPath(s, f.pair);
      const fixed = f.role === 'lo' ? fixPair(v, other, 'lo') : fixPair(other, v, 'hi');
      const next = f.role === 'lo' ? fixed.hi : fixed.lo;
      if (next !== other) {
        setPath(s, f.pair, next);
        steppers.get(key(f.pair))?.setValue(next);
      }
    }
    if (final) store.save('meta', s);
    else store.saveSoon('meta', s);
  }

  function numStepper(f, ariaLabel) {
    const dec = f.decimals ?? 0;
    const st = stepper({
      value: getPath(store.settings(), f.path) ?? null,
      step: f.step, min: f.min, max: f.max, decimals: dec,
      inputmode: dec > 0 ? 'decimal' : 'numeric',
      suffix: f.suffix || '', size: 'sm', ariaLabel,
      onChange: (v, { final }) => onValue(f, st, v, final),
    });
    st.classList.add('cfg-stepper');
    st.dataset.path = key(f.path);
    steppers.set(key(f.path), st);
    return st;
  }

  const numRow = (f) => h('div.cfg-num',
    h('div.cfg-num-text', h('span.cfg-num-label', f.label), f.hint ? h('span.cfg-num-hint', f.hint) : null),
    numStepper(f, f.label));

  function musclesRows() {
    return MUSCLES.map((m) => {
      const base = { step: 1, min: 0, max: 40, ...INT };
      const lo = { ...base, path: ['muscleTargets', m.id, 0], pair: ['muscleTargets', m.id, 1], role: 'lo' };
      const hi = { ...base, path: ['muscleTargets', m.id, 1], pair: ['muscleTargets', m.id, 0], role: 'hi' };
      return h('div.cfg-range', { dataset: { muscle: m.id } },
        h('div.cfg-range-label', m.label),
        h('div.cfg-range-row',
          numStepper(lo, `${m.label}: mínimo de series`),
          h('span.cfg-range-sep', 'a'),
          numStepper(hi, `${m.label}: máximo de series`)));
    });
  }

  async function restoreDefaults() {
    const ok = await confirmDialog({
      title: '¿Restaurar los valores por defecto?',
      message: 'Se restauran todos los umbrales de esta pantalla. No cambia la semana tipo ni tus datos.',
      confirmText: 'Restaurar',
    });
    if (!ok) return;
    await store.saveSettings(thresholdDefaults());
    await refresh();
    toast('Umbrales restaurados a los valores por defecto.', { kind: 'success' });
  }

  c.append(
    h('p.cfg-hint.cfg-top-hint', 'Los cambios se guardan al instante. Puedes escribir decimales con coma.'),
    ...BLOCKS.map((b) => h('section.card.cfg-block', { dataset: { block: b.id } },
      h('h2.card-title', b.title),
      h('p.cfg-why', b.why),
      b.muscles ? h('div.cfg-ranges', musclesRows()) : b.fields.map(numRow))),
    h('button.btn.btn-secondary.btn-block.cfg-restore', { type: 'button', onClick: restoreDefaults }, icon('refresh', 20), 'Restaurar valores por defecto'));
}

// ===========================================================================
// #/settings/data — copias, CSV, almacenamiento y borrado
// ===========================================================================
export function mountData(root) {
  const c = screen(root, { title: 'Copias y datos', back: '#/settings' });
  const lastBox = h('div.cfg-last');
  const warnBox = h('div.cfg-warnbox');

  function paintLast() {
    const s = store.settings();
    const ts = s.lastBackupAt;
    lastBox.replaceChildren(
      h('span.cfg-last-label', 'Última copia'),
      h('span.cfg-last-value', ts ? fmtStamp(ts) : 'Nunca'),
      h('span.cfg-last-ago', ts ? cap(relDay(dateFromTs(ts), todayStr())) : 'Exporta la primera ahora.'));
    warnBox.replaceChildren(...(store.backupOverdue()
      ? [h('div.banner.banner-warn.cfg-overdue', icon('alert', 22),
        h('div.banner-main',
          h('div.banner-title', overdueTitle(s)),
          h('div.banner-text', 'Si pierdes el iPhone o se borran los datos del navegador, solo podrás recuperarlos con una copia.')))]
      : []));
    warnBox.hidden = !warnBox.childElementCount;
  }

  // ---------- exportar / importar ----------
  async function onExport() {
    // Sin await antes de compartir: iOS exige que la hoja de compartir salga del propio toque.
    const now = Date.now();
    const obj = buildBackupObject(store.exportData(), now);
    const fileSettings = obj.data?.meta?.find((m) => m && m.id === 'settings');
    const file = new File([JSON.stringify(obj)], backupFileName(new Date(now)), { type: 'application/json' });
    const res = await shareFile(file, { title: 'Copia de Entreno' });
    if (res === 'cancelled') return;
    await markBackup(fileSettings, now);
    paintLast();
    toast(res === 'shared' ? 'Copia exportada.' : 'Copia descargada.', { kind: 'success' });
  }

  function importError(msg) {
    sheet({ title: 'No se puede importar', className: 'cfg-import-error', body: h('p.sheet-msg', msg), actions: [{ label: 'Entendido' }] });
  }

  async function onImport() {
    const file = await pickFile({ accept: 'application/json,.json' });
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch {
      importError('No se pudo leer el archivo.');
      return;
    }
    const res = parseBackupText(text, store.validateBackup);
    if (!res.ok) { importError(res.error); return; }
    const sum = res.summary;
    const when = sum.exportedAt ? `del ${fmtStamp(sum.exportedAt)}` : 'sin fecha';
    // Lo que se perdería ahora (solo registros del usuario; plantillas y ejercicios vienen en la copia).
    const cur = currentCounts();
    const curText = cur.strength + cur.activities + cur.bodyweight > 0
      ? ` (ahora hay ${plural(cur.strength, 'sesión de fuerza', 'sesiones de fuerza')}, ${plural(cur.activities, 'actividad', 'actividades')} y ${plural(cur.bodyweight, 'pesaje', 'pesajes')})`
      : '';
    const ok = await confirmDialog({
      title: '¿Importar esta copia?',
      message: `Copia ${when}: ${countsText(sum, { all: true, sep: ' · ' })}.\n\n`
        + `SUSTITUYE todos los datos de este iPhone${curText}. `
        + 'No se puede deshacer: si no tienes copia de lo actual, cancela y exporta antes.',
      confirmText: 'Sustituir todo',
      danger: true,
    });
    if (!ok) return;
    try {
      await store.importData(res.backup);
    } catch (err) {
      importError(`No se pudo importar: ${err?.message || err}. Tus datos actuales no se han tocado.`);
      return;
    }
    clearLocalDrafts();
    toast(`Copia importada: ${plural(sum.strength, 'sesión de fuerza', 'sesiones de fuerza')} y ${plural(sum.activities, 'actividad', 'actividades')}.`, { kind: 'success', duration: 5000 });
  }

  // ---------- CSV ----------
  function csvCard() {
    const counts = csvCounts(store.all('sessions'));
    const hint = h('p.cfg-hint.cfg-csv-hint');
    const paintHint = (excel) => {
      hint.textContent = excel
        ? 'Separador «;», coma decimal y UTF-8 con BOM: se abre directamente en Excel en español.'
        : 'Separador «,» y punto decimal: para Numbers, Google Sheets, programas de análisis o Claude.';
    };
    const excelNow = store.settings().csv?.excel !== false;
    const seg = segmented({
      options: [{ value: true, label: 'Excel (español)' }, { value: false, label: 'Estándar' }],
      value: excelNow,
      ariaLabel: 'Formato del CSV',
      onChange: (v) => {
        store.saveSettings({ csv: { ...(store.settings().csv || {}), excel: v } });
        paintHint(v);
      },
    });
    seg.classList.add('cfg-csv-format');
    paintHint(excelNow);

    function exportCsv(kind) {
      const s = store.settings();
      const excel = s.csv?.excel !== false;
      const sessions = store.all('sessions');
      const n = kind === 'fuerza' ? csvCounts(sessions).sets : csvCounts(sessions).activities;
      if (!n) { toast(kind === 'fuerza' ? 'Todavía no hay series registradas.' : 'Todavía no hay actividades registradas.'); return; }
      const csv = kind === 'fuerza'
        ? strengthCsv(sessions, new Map(store.all('exercises').map((e) => [e.id, e])), s, { excel, bodyweight: store.bodyweightList() })
        : cardioCsv(sessions, { excel });
      const file = new File([csv], csvFileName(kind), { type: 'text/csv' });
      shareFile(file, { title: kind === 'fuerza' ? 'Entreno: fuerza (CSV)' : 'Entreno: cardio (CSV)' }).then((res) => {
        if (res !== 'cancelled') toast(`CSV de ${kind} ${res === 'shared' ? 'exportado' : 'descargado'}.`, { kind: 'success' });
      });
    }

    const csvBtn = (kind, label, count) => h(`button.btn.btn-secondary.btn-block.cfg-csv-btn.cfg-csv-${kind}`, { type: 'button', onClick: () => exportCsv(kind) },
      icon('download', 20), h('span.cfg-csv-label', label), h('span.cfg-csv-count', count));

    return h('section.card.cfg-block', { dataset: { block: 'csv' } },
      h('h2.card-title', 'Exportar CSV'),
      h('p.cfg-why', 'Para analizar en una hoja de cálculo o con Claude. Fuerza: una fila por serie hecha. Cardio: una fila por actividad.'),
      h('div.field', h('span.field-label', 'Formato'), seg, hint),
      csvBtn('fuerza', 'CSV de fuerza', plural(counts.sets, 'serie', 'series')),
      csvBtn('cardio', 'CSV de cardio', plural(counts.activities, 'actividad', 'actividades')));
  }

  // ---------- almacenamiento ----------
  const persistVal = h('span.cfg-kv-value.cfg-persist');
  const persistHint = h('p.cfg-hint');
  const persistBtn = h('button.btn.btn-ghost.btn-sm.cfg-persist-btn', {
    type: 'button',
    onClick: async () => {
      persistBtn.disabled = true;
      const r = await store.requestPersist();
      persistBtn.disabled = false;
      paintPersist(r);
      toast(r.persisted ? 'Almacenamiento persistente concedido.' : 'El sistema no lo ha concedido. Instalar la app en la pantalla de inicio suele ayudar.');
    },
  }, icon('refresh', 18), 'Volver a pedirlo');

  function paintPersist(info = store.persistStatus()) {
    const yes = !!info?.persisted;
    persistVal.replaceChildren(h(`span.badge.${yes ? 'badge-ok' : 'badge-warn'}`, yes ? 'Sí' : info?.supported ? 'No' : 'No disponible'));
    persistHint.textContent = yes
      ? 'El sistema no borrará los datos aunque le falte espacio.'
      : 'El sistema podría borrar los datos si le falta espacio. Instalada en la pantalla de inicio es menos probable; aun así, haz copias.';
    persistBtn.hidden = yes || !info?.supported;
  }
  paintPersist();
  const offPersist = store.on('persist', paintPersist);

  const usageVal = h('span.cfg-kv-value.cfg-usage', 'Calculando…');
  estimate().then((e) => {
    usageVal.textContent = e && typeof e.usage === 'number'
      ? `≈ ${formatBytes(e.usage)}${e.quota ? ` de ${formatBytes(e.quota)}` : ''}`
      : 'No disponible';
  });

  const kv = (label, value, extra = {}) => h('div.cfg-kv', extra, h('span.cfg-kv-label', label), value);
  const counts = currentCounts();
  const countRows = [
    ['Sesiones de fuerza', counts.strength, 'strength'],
    ['Actividades (cardio y otras)', counts.activities, 'activities'],
    ['Pesajes', counts.bodyweight, 'bodyweight'],
    ['Plantillas', counts.templates, 'templates'],
    ['Ejercicios', `${counts.exercises}${counts.customExercises ? ` (${plural(counts.customExercises, 'propio', 'propios')})` : ''}`, 'exercises'],
    ['Días modificados en el calendario', counts.plan, 'plan'],
    ['Check-ins', counts.checkins, 'checkins'],
    ['Objetivos', counts.goals, 'goals'],
  ].map(([label, n, id]) => kv(label, h('span.cfg-kv-value.tnum', String(n)), { dataset: { count: id } }));

  // ---------- borrar todo ----------
  async function onWipe() {
    const ok1 = await confirmDialog({
      title: '¿Borrar todos los datos?',
      message: `Se borrará todo lo de este iPhone: ${countsText(currentCounts()) || 'tus registros'}, además de tus ajustes.\n\n`
        + 'Antes de seguir, exporta una copia si quieres conservarlos: sin copia no se pueden recuperar.',
      confirmText: 'Continuar',
      danger: true,
    });
    if (!ok1) return;
    const ok2 = await confirmDialog({
      title: 'Confirmación final',
      message: 'Esta acción no se puede deshacer. La app quedará como recién instalada, con las rutinas y ejercicios iniciales.',
      confirmText: 'Borrar todo',
      danger: true,
      requireText: 'BORRAR',
    });
    if (!ok2) return;
    try {
      await store.wipeAll();
    } catch (err) {
      toast(`No se pudo borrar: ${err?.message || err}`, { kind: 'error', duration: 6000 });
      return;
    }
    clearLocalDrafts();
    toast('Datos borrados. La app vuelve a estar como recién instalada.', { kind: 'success', duration: 5000 });
  }

  paintLast();
  c.append(
    h('section.card.cfg-block', { dataset: { block: 'backup' } },
      h('h2.card-title', 'Copia de seguridad'),
      lastBox,
      warnBox,
      h('button.btn.btn-primary.btn-lg.btn-block.cfg-export', { type: 'button', onClick: onExport }, icon('share', 22), 'Exportar copia'),
      h('p.cfg-hint', 'Se abre la hoja de compartir: elige «Guardar en Archivos» (o Google Drive) y guárdala en una carpeta que recuerdes.'),
      h('button.btn.btn-secondary.btn-block.cfg-import', { type: 'button', onClick: onImport }, icon('upload', 20), 'Importar copia'),
      h('p.cfg-hint', 'Restaura una copia exportada antes. Sustituye TODOS los datos actuales; se pide confirmación.')),
    csvCard(),
    h('section.card.cfg-block', { dataset: { block: 'storage' } },
      h('h2.card-title', 'Almacenamiento'),
      kv('Persistente', persistVal),
      persistHint,
      persistBtn,
      kv('Espacio usado', usageVal),
      h('div.cfg-counts', countRows)),
    h('section.card.card-danger.cfg-danger', { dataset: { block: 'wipe' } },
      h('h2.card-title', 'Borrar todos los datos'),
      h('p.cfg-why', 'Elimina sesiones, actividades, pesajes, check-ins, objetivos, plantillas, ejercicios propios y ajustes. Se pide confirmación dos veces.'),
      h('button.btn.btn-danger-ghost.btn-block.cfg-wipe', { type: 'button', onClick: onWipe }, icon('trash', 20), 'Borrar todos los datos')));

  return () => offPersist();
}
