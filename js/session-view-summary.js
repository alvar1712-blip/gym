// session-view-summary.js — resumen de una sesión de fuerza (al terminar o al consultarla).
// PROPIETARIO: módulo de sesión.
import * as store from './store.js';
import { h, icon, screen, header, emptyState, RPE_HINTS } from './ui.js';
import { fmtDate, fmtMinutes, fmtNum, fmtKm, fmtDuration, sum } from './util.js';
import {
  sessionVolume, sessionMuscleSets, sessionPRs, sessionLoad, sessionDurationMin, bestSet, setMetrics,
  workSetCount, makeBodyweightFn,
} from './calc.js';
import { MUSCLE_LABEL, ACTIVITY_EMOJI, ACTIVITY_LABEL } from './seed.js';
import { navigate } from './router.js';
import { formatSet, prLabel, linkedActivities, syncAutoDuration } from './session-logic.js';

export function renderSummary(root, id) {
  const session = store.get('sessions', id);
  if (!session) {
    root.replaceChildren(header({ title: 'Resumen', back: '#/today' }), h('div.content', emptyState({
      emoji: '🤷', title: 'Esta sesión no existe', text: 'Puede que se haya borrado.',
      action: { label: 'Ir a Hoy', onClick: () => navigate('#/today', { replace: true }) },
    })));
    return;
  }
  if (session.kind !== 'strength') {
    navigate(`#/activity/${id}`, { replace: true });
    return;
  }

  const c = screen(root, { title: 'Resumen', subtitle: session.templateName || 'Sesión de fuerza', back: '#/today' });
  c.classList.add('ses-sum');
  const exMap = new Map(store.all('exercises').map((e) => [e.id, e]));
  const settings = store.settings();
  const bwFn = makeBodyweightFn(store.bodyweightList(), settings?.bodyweightDefault ?? 75);
  const all = store.all('sessions');
  const acts = linkedActivities(session, all);
  // Si las actividades enlazadas cambiaron después de terminar, la duración automática de la fuerza se recalcula.
  if (syncAutoDuration(session, acts)) store.save('sessions', session).catch(() => {});

  const dur = sessionDurationMin(session);
  const load = sessionLoad(session);
  const vol = sessionVolume(session, exMap, bwFn);
  const work = sum(session.exercises || [], (se) => workSetCount(se));
  const prs = sessionPRs(session, all, exMap, bwFn);
  const muscles = Object.entries(sessionMuscleSets(session, exMap, settings)).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  const kpi = (label, value, subTxt = null, cls = '') => h(`div.kpi${cls}`, h('div.kpi-label', label), h('div.kpi-value', value), subTxt ? h('div.kpi-sub', subTxt) : null);

  // Con cardio enlazado (Día 3), la duración y la carga de la fuerza son solo una parte: también el total.
  // (La carga guardada no cambia: la de cada actividad cuenta por su lado y no se suma dos veces.)
  const actsMin = sum(acts, (a) => sessionDurationMin(a) || 0);
  const actsLoad = sum(acts, (a) => sessionLoad(a) || 0);
  const totals = acts.length ? [
    kpi('Duración total', fmtMinutes((dur || 0) + actsMin), `fuerza ${dur != null ? fmtMinutes(dur) : '—'}`, '.ses-kpi-total'),
    kpi('Carga total', fmtNum((load || 0) + actsLoad, 0), `fuerza ${load != null ? fmtNum(load, 0) : '—'}`, '.ses-kpi-total'),
  ] : [];

  c.appendChild(h('div.card.card-accent.ses-sum-hero',
    h('div.row-between',
      h('div.grow',
        h('h2', session.templateName || 'Sesión de fuerza'),
        h('div.card-sub', fmtDate(session.date, 'longy'))),
      session.status === 'active' ? h('span.badge.badge-warn', 'En curso') : h('span.badge.badge-ok', 'Terminada')),
    h('div.kpis.kpis-2',
      totals,
      totals.length ? null : kpi('Duración', dur != null ? fmtMinutes(dur) : '—'),
      kpi('Esfuerzo', session.rpe ? `${session.rpe}/10` : '—', session.rpe ? RPE_HINTS[session.rpe] : 'sin indicar'),
      totals.length ? null : kpi('Carga', load != null ? fmtNum(load, 0) : '—', 'min × esfuerzo'),
      kpi('Volumen', vol > 0 ? `${fmtNum(vol, 0)} kg` : '—', 'sin calentamientos'),
      kpi('Series de trabajo', String(work), 'sin calentamientos'),
      kpi('Récords', String(prs.size), prs.size ? '🏆 en esta sesión' : 'ninguno esta vez', prs.size ? '.ses-kpi-pr' : ''))));

  // Récords
  if (prs.size) {
    const rows = [];
    for (const se of session.exercises || []) {
      const ex = exMap.get(se.exerciseId);
      for (const set of se.sets || []) {
        const list = prs.get(set.id);
        if (!list) continue;
        // Nombre y serie en líneas separadas: el dato clave (peso × reps) nunca se corta.
        rows.push(h('div.list-item.ses-sum-pr',
          h('span.ses-sum-emoji', { 'aria-hidden': 'true' }, '🏆'),
          h('div.list-item-main',
            h('div.list-item-title.ses-sum-pr-name', ex?.name || se.exName),
            h('div.ses-sum-pr-set.tnum', formatSet(set, ex?.logType, { kg: true })),
            h('div.list-item-sub.wrap', list.map((p) => prLabel(p, ex)).join(' · ')))));
      }
    }
    c.append(h('h2.section-title', 'Récords batidos'), h('div.list', rows));
  }

  // Series por músculo
  if (muscles.length) {
    const max = Math.max(...muscles.map(([, n]) => n));
    c.append(h('h2.section-title', 'Series por músculo'),
      h('div.card.ses-sum-muscles',
        muscles.map(([m, n]) => h('div.ses-bar-row',
          h('span.ses-bar-label', MUSCLE_LABEL[m] || m),
          h('span.ses-bar', h('span.ses-bar-fill', { style: { width: `${Math.round((n / max) * 100)}%` } })),
          h('span.ses-bar-val.tnum', fmtNum(n, 1)))),
        h('p.field-hint', `Series de trabajo: ${fmtNum(settings?.primaryFactor ?? 1, 1)} por músculo principal y ${fmtNum(settings?.secondaryFactor ?? 0.5, 1)} por secundario.`)));
  }

  // Mejor serie por ejercicio (solo los hechos; los demás, en una línea)
  const bestRows = [];
  const skipped = [];
  for (const se of session.exercises || []) {
    const ex = exMap.get(se.exerciseId);
    if (!ex || ex.logType === 'cardio') continue;
    const n = workSetCount(se);
    if (!n) { skipped.push(ex.name); continue; }
    const best = bestSet(se.sets, ex, bwFn(session.date));
    const m = best ? setMetrics(best, ex, bwFn(session.date)) : null;
    const e1 = m?.e1rm ? ` · 1RM est. ${fmtNum(m.e1rm, 1)} kg${ex.logType === 'bodyweight' ? ' (con peso corporal)' : ''}` : '';
    bestRows.push(h('div.list-item.ses-sum-best',
      h('div.list-item-main',
        h('div.list-item-title', ex.name),
        h('div.list-item-sub.wrap', best ? `${formatSet(best, ex.logType, { kg: true })}${e1}` : '—')),
      h('span.badge', `${n} ${n === 1 ? 'serie' : 'series'}`)));
  }
  if (bestRows.length) c.append(h('h2.section-title', 'Mejor serie por ejercicio'), h('div.list', bestRows));
  if (skipped.length) c.append(h('p.small.muted.ses-sum-skipped', `Sin series de trabajo: ${skipped.join(', ')}.`));

  // Actividades enlazadas
  if (acts.length) {
    c.append(h('h2.section-title', 'Actividades de la sesión'), h('div.list', acts.map((a) => h('button.list-item', {
      type: 'button', onClick: () => navigate(`#/activity/${a.id}`),
    },
    h('span.ses-sum-emoji', { 'aria-hidden': 'true' }, ACTIVITY_EMOJI[a.kind] || '⚡'),
    h('div.list-item-main',
      h('div.list-item-title', ACTIVITY_LABEL[a.kind] || 'Actividad'),
      h('div.list-item-sub', [a.distanceKm ? fmtKm(a.distanceKm) : null, a.movingSec ? fmtDuration(a.movingSec) : (sessionDurationMin(a) ? fmtMinutes(sessionDurationMin(a)) : null)].filter(Boolean).join(' · ') || '—')),
    icon('chevron-right', 20, 'chev')))));
  }

  if (session.notes) c.append(h('h2.section-title', 'Nota'), h('div.card.ses-sum-notes', h('p', session.notes)));

  c.append(h('div.stack.ses-sum-actions',
    h('button.btn.btn-secondary.btn-lg.btn-block.ses-sum-edit', { type: 'button', onClick: () => navigate(`#/session/${session.id}`, { replace: true }) }, icon('edit', 20), 'Ver / editar sesión'),
    h('button.btn.btn-primary.btn-lg.btn-block.ses-sum-today', { type: 'button', onClick: () => navigate('#/today', { replace: true }) }, icon('home', 20), 'Ir a Hoy')));
  return undefined;
}
