// settings-logic.js — lógica PURA de Ajustes: umbrales (rutas de claves, parejas mín–máx,
// valores por defecto) y textos de la semana tipo. Sin DOM ni store: se prueba en Node.
// PROPIETARIO: módulo de ajustes.
import { defaultSettings, ACTIVITY_EMOJI, ACTIVITY_LABEL } from './seed.js';
import { deepClone, DAY_LETTER } from './util.js';

// ---------------------------------------------------------------------------
// Umbrales
// ---------------------------------------------------------------------------

/**
 * Claves de ajustes que son «umbrales y reglas» (lo que restaura «Restaurar valores por defecto»).
 * No incluye la semana tipo (weekPatterns), lastBackupAt ni el formato CSV.
 */
export const THRESHOLD_KEYS = [
  'muscleTargets', 'primaryFactor', 'secondaryFactor', 'increments', 'progression',
  'loadWarn', 'runKmWarn', 'stall', 'deload', 'goals', 'backupReminderDays', 'bodyweightDefault',
];

/** Parche con los umbrales por defecto (copia profunda), listo para saveSettings(). */
export function thresholdDefaults(defaults = defaultSettings()) {
  const out = {};
  for (const k of THRESHOLD_KEYS) out[k] = deepClone(defaults[k]);
  return out;
}

/** Lee obj[a][b][c] con path = ['a','b','c'] (índices numéricos para arrays). */
export function getPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Escribe obj[a][b][c] = value creando los objetos/arrays intermedios que falten. */
export function setPath(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = typeof path[i + 1] === 'number' ? [] : {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
  return obj;
}

/**
 * Mantiene una pareja mín ≤ máx tras cambiar uno de los dos: el otro se mueve hasta igualarlo.
 * @param {'lo'|'hi'} changed  el valor que acaba de editar el usuario
 */
export function fixPair(lo, hi, changed) {
  if (lo == null || hi == null || lo <= hi) return { lo, hi };
  return changed === 'lo' ? { lo, hi: lo } : { lo: hi, hi };
}

// ---------------------------------------------------------------------------
// Semana tipo
// ---------------------------------------------------------------------------

const toMap = (x) => {
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.filter(Boolean).map((o) => [o.id, o]));
  return new Map(Object.entries(x || {}));
};

/**
 * Descripción de un DayPlan para la interfaz.
 * @returns {{kind:'template'|'rest'|'free', text:string, emoji:string, items:number|null, missing:boolean, archived:boolean}}
 */
export function planLabel(day, templates) {
  if (!day || day.kind === 'rest' || !['template', 'free'].includes(day.kind)) {
    return { kind: 'rest', text: 'Descanso', emoji: '😴', items: null, missing: false, archived: false };
  }
  if (day.kind === 'free') {
    const emoji = ACTIVITY_EMOJI[day.activityKind] || '⚡';
    const text = day.label || ACTIVITY_LABEL[day.activityKind] || 'Sesión libre';
    return { kind: 'free', text, emoji, items: null, missing: false, archived: false };
  }
  const t = toMap(templates).get(day.templateId);
  if (!t) return { kind: 'template', text: 'Plantilla eliminada', emoji: '', items: null, missing: true, archived: false };
  return {
    kind: 'template',
    text: t.archived ? `${t.name} (archivada)` : t.name,
    emoji: '',
    items: (t.items || []).length,
    missing: false,
    archived: !!t.archived,
  };
}

/** Etiqueta muy corta para la mini semana: «D1», «Push», «—», «🚴», «?». */
export function shortPlanLabel(day, templates) {
  const p = planLabel(day, templates);
  if (p.kind === 'rest') return '—';
  if (p.kind === 'free') return p.emoji;
  if (p.missing) return '?';
  const name = toMap(templates).get(day.templateId).name || '';
  const m = /^d[ií]a\s*(\d+)/i.exec(name.trim());
  if (m) return `D${m[1]}`;
  const word = name.trim().split(/[\s—–-]+/)[0] || '?';
  return word.length > 5 ? word.slice(0, 4) + '.' : word;
}

/** «L D1 · M D2 · X D3 · J D4 · V — · S D6 · D —» */
export function weekSummaryText(days, templates) {
  return DAY_LETTER.map((l, i) => `${l} ${shortPlanLabel(days?.[i], templates)}`).join(' · ');
}

/** Fecha de inicio de la vigencia de la semana tipo aplicable a `date` (o null si no hay). */
export function patternFromDate(settings, date) {
  const list = [...(settings?.weekPatterns || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  let cur = null;
  for (const p of list) if (p.from <= date) cur = p.from;
  return cur ?? list[0]?.from ?? null;
}
