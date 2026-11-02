// session-history.js — hoja «Historial» de un ejercicio dentro de la sesión activa (Fase 7): las últimas sesiones
// (fecha y series de trabajo) y la evolución del peso máximo. Solo lee lo que ya calcula stats.exerciseHistory
// (ctx.historyFor: terminadas y de la misma configuración); no guarda nada y se cierra sin tocar el entrenamiento.
import { h, sheet } from './ui.js';
import { fmtDate, fmtNum } from './util.js';
import { formatSet } from './session-logic.js';
import { sparkline } from './charts.js';
import { navigate } from './router.js';

const SHOWN = 5;

/** Peso máximo de una sesión de un ejercicio (null si no hay pesos). */
const topWeight = (e) => {
  const w = e.sets.map((s) => s.weight).filter((v) => typeof v === 'number' && Number.isFinite(v));
  return w.length ? Math.max(...w) : null;
};

/** Abre el historial de `ex` (lista de stats.exerciseHistory, de la más antigua a la más reciente). */
export function openHistory({ ex, logType, entries }) {
  const list = [...entries].reverse();
  sheet({
    title: `Historial · ${ex.name}`,
    body: (close) => {
      if (!list.length) return h('p.sheet-msg', 'Aún no hay sesiones terminadas de este ejercicio.');
      const tops = [...entries].slice(-8).map(topWeight).filter((v) => v != null);
      return h('div.stack.ses-hist',
        tops.length >= 2
          ? h('div.ses-hist-evo',
            h('span.ses-hist-evo-label', 'Peso máximo'),
            sparkline(tops, { width: 110, height: 40, label: `Peso máximo de las últimas ${tops.length} sesiones` }),
            h('span.ses-hist-evo-val.tnum', `${fmtNum(tops[0], 2)} → ${fmtNum(tops[tops.length - 1], 2)} kg`))
          : null,
        h('ul.ses-hist-list', list.slice(0, SHOWN).map((e) => h('li.ses-hist-row',
          h('span.ses-hist-date', fmtDate(e.date, 'day')),
          h('span.ses-hist-sets.tnum', e.sets.map((s) => formatSet(s, logType)).join(' · ')),
          e.setup ? h('span.ses-hist-setup', e.setup) : null))),
        h('button.btn.btn-secondary.btn-block.ses-hist-more', { type: 'button', onClick: () => { close(); navigate(`#/progress/exercise/${encodeURIComponent(ex.id)}`); } }, 'Ver progreso completo'));
    },
  });
}
