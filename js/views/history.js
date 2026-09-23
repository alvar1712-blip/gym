// history.js — Historial: todas las sesiones (fuerza y actividades), de la más reciente a la más
// antigua, agrupadas por mes y filtrables por tipo.
// PROPIETARIO: módulo de calendario. Lógica pura en ../history-logic.js.
import * as store from '../store.js';
import { h, screen, chips, emptyState } from '../ui.js';
import { fmtMinutes, todayStr } from '../util.js';
import { navigate } from '../router.js';
import { HISTORY_FILTERS, isHistoryFilter, filterSessions, groupByMonth } from '../history-logic.js';
import { sessionRow, summaryOpts, activityHref } from '../plan-ui.js';

const PAGE = 60; // filas por tanda (el resto con «Mostrar más»)

export function mountHistory(root, params = {}) {
  let filter = isHistoryFilter(params.f) ? params.f : 'all';
  let shown = PAGE;
  const content = screen(root, { title: 'Historial', back: '#/calendar' });
  content.classList.add('hist');
  const opts = summaryOpts();
  const count = h('p.small.muted.hist-count');
  const listEl = h('div.hist-list');

  content.append(
    chips({
      options: HISTORY_FILTERS,
      value: filter,
      className: 'chips-scroll hist-filters',
      onChange: (v) => {
        filter = v || 'all';
        shown = PAGE;
        // El filtro queda en la URL para volver a él al regresar de una sesión.
        history.replaceState(history.state, '', filter === 'all' ? '#/history' : `#/history?f=${filter}`);
        paint();
      },
    }),
    count,
    listEl);

  function paint() {
    const list = filterSessions(store.all('sessions'), filter);
    count.textContent = list.length === 1 ? '1 sesión' : `${list.length} sesiones`;
    count.hidden = !list.length;
    if (!list.length) {
      listEl.replaceChildren(emptyState({
        emoji: '🗂️',
        title: filter === 'all' ? 'Aún no hay sesiones' : 'Nada con este filtro',
        text: filter === 'all' ? 'Cuando registres entrenamientos o actividades aparecerán aquí.' : 'Prueba con otro tipo de sesión.',
        action: filter === 'all' ? { label: 'Ir a Hoy', onClick: () => navigate('#/today') }
          : filter !== 'strength' ? { label: 'Registrar una', onClick: () => navigate(activityHref(filter, todayStr(), null)) } : null,
      }));
      return;
    }
    let left = shown;
    const out = [];
    for (const g of groupByMonth(list)) {
      if (left <= 0) break;
      const rows = g.sessions.slice(0, left);
      left -= rows.length;
      out.push(h('section.hist-month', { dataset: { month: g.key } },
        h('div.hist-month-head',
          h('h2.section-title', g.label),
          h('span.small.muted.tnum', `${g.count === 1 ? '1 sesión' : `${g.count} sesiones`}${g.minutes ? ` · ${fmtMinutes(g.minutes)}` : ''}`)),
        h('div.list', rows.map((s) => sessionRow(s, opts, {
          showDate: true,
          note: s.parentId ? 'Dentro de una sesión de fuerza' : '',
        })))));
    }
    if (list.length > shown) {
      out.push(h('button.btn.btn-secondary.btn-block.hist-more', {
        type: 'button',
        onClick: () => { shown += PAGE; paint(); },
      }, `Mostrar más (${list.length - shown})`));
    }
    listEl.replaceChildren(...out);
  }
  paint();
}
