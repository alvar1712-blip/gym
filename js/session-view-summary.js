// session-view-summary.js — resumen de una sesión de fuerza (al terminar o al consultarla).
// PROPIETARIO: módulo de sesión.
import * as store from './store.js';
import { h, icon, screen, header, emptyState, kpiValue, RPE_HINTS } from './ui.js';
import { fmtDate, fmtMinutes, fmtNum, fmtKm, fmtDuration, sum, deltaTone } from './util.js';
import {
  sessionVolume, sessionMuscleSets, sessionPRs, sessionLoad, sessionDurationMin, bestSet, setMetrics,
  workSetCount, makeBodyweightFn,
} from './calc.js';
import { MUSCLE_LABEL, ACTIVITY_EMOJI, ACTIVITY_LABEL } from './seed.js';
import { navigate, back, parseHash } from './router.js';
import { formatSet, prLabel, linkedActivities, syncAutoDuration } from './session-logic.js';
import { previousEquivalent, compareSessions } from './session-compare.js';
import { checkinSummary } from './checkin.js';

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

  const kpi = (label, value, subTxt = null, cls = '') => h(`div.kpi${cls}`, h('div.kpi-label', label), kpiValue(value), subTxt ? h('div.kpi-sub', subTxt) : null);

  // Con cardio enlazado (Día 3), la duración y la carga de la fuerza son solo una parte: también el total.
  // (La carga guardada no cambia: la de cada actividad cuenta por su lado y no se suma dos veces.)
  const actsMin = sum(acts, (a) => sessionDurationMin(a) || 0);
  const actsLoad = sum(acts, (a) => sessionLoad(a) || 0);

  // Pulido (docs/PULIDO.md §10): dos cifras protagonistas (duración y series de trabajo) y, en una línea aparte, el
  // esfuerzo, el volumen y la carga. Los récords van en su propia tarjeta, solo si los hay (ronda 8, A6).
  const meta = [
    session.rpe ? `Esfuerzo ${session.rpe}/10 · ${RPE_HINTS[session.rpe]}` : 'Esfuerzo sin indicar',
    vol > 0 ? `Volumen ${fmtNum(vol, 0)} kg` : null,
    acts.length ? `Carga total ${fmtNum((load || 0) + actsLoad, 0)} (fuerza ${load != null ? fmtNum(load, 0) : '—'})` : load != null ? `Carga ${fmtNum(load, 0)}` : null,
  ].filter(Boolean);
  c.appendChild(h('div.card.card-accent.ses-sum-hero',
    h('div.row-between',
      h('div.grow',
        h('h2', session.templateName || 'Sesión de fuerza'),
        h('div.card-sub', fmtDate(session.date, 'longy'))),
      session.status === 'active' ? h('span.badge.badge-warn', 'En curso') : h('span.badge.badge-ok', 'Terminada')),
    h('div.kpis.kpis-2.ses-sum-kpis',
      acts.length
        ? kpi('Duración total', fmtMinutes((dur || 0) + actsMin), `fuerza ${dur != null ? fmtMinutes(dur) : '—'}`, '.ses-kpi-total')
        : kpi('Duración', dur != null ? fmtMinutes(dur) : '—'),
      kpi('Series de trabajo', String(work))), // «de trabajo» = sin calentamientos (docs/PULIDO.md §9, términos)
    h('p.ses-sum-meta.tnum', meta.join(' · '))));

  // Récords (ronda 8, A6): sin récord no hay casilla «Récords 0»; con récord, tarjeta destacada justo debajo con
  // cuáles (nombre, serie y tipo de récord), antes de «Frente a la anterior».
  if (prs.size) c.appendChild(prCard(session, prs, exMap));

  // Frente a la anterior de la misma rutina: solo datos reales y solo si es comparable
  const prev = session.status === 'done' ? previousEquivalent(session, all) : null;
  const cmp = prev ? compareSessions(session, prev, exMap, bwFn) : null;
  if (cmp) c.appendChild(compareCard(cmp, dur));

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

  // Check-in del día (antes / después), si lo hay
  const checkin = checkinSummary({ date: session.date, sessionId: session.id });
  if (checkin) c.append(checkin);

  if (session.notes) c.append(h('h2.section-title', 'Nota'), h('div.card.ses-sum-notes', h('p', session.notes)));

  c.append(h('div.stack.ses-sum-actions',
    h('button.btn.btn-secondary.btn-lg.btn-block.ses-sum-edit', {
      type: 'button',
      // Abierto desde la propia sesión: se vuelve a ella (no se apilan dos entradas de la misma sesión, y borrarla
      // después vuelve a la pantalla de origen, no a una sesión que ya no existe).
      onClick: () => (parseHash().query.from === 'session' ? back(`#/session/${session.id}`) : navigate(`#/session/${session.id}`, { replace: true })),
    }, icon('edit', 20), 'Ver / editar sesión'),
    h('button.btn.btn-primary.btn-lg.btn-block.ses-sum-today', { type: 'button', onClick: () => navigate('#/today', { replace: true }) }, icon('home', 20), 'Ir a Hoy')));
  return undefined;
}

/** Tarjeta destacada de récords: «🏆 2 récords en esta sesión» y una fila por serie récord. */
function prCard(session, prs, exMap) {
  const rows = [];
  for (const se of session.exercises || []) {
    const ex = exMap.get(se.exerciseId);
    for (const set of se.sets || []) {
      const list = prs.get(set.id);
      if (!list) continue;
      // Nombre y serie en líneas separadas: el dato clave (peso × reps) nunca se corta.
      rows.push(h('li.ses-sum-pr',
        h('div.ses-sum-pr-name', ex?.name || se.exName),
        h('div.ses-sum-pr-set.tnum', formatSet(set, ex?.logType, { kg: true })),
        h('div.ses-sum-pr-kind', list.map((p) => prLabel(p, ex)).join(' · '))));
    }
  }
  const n = prs.size;
  return h('section.card.ses-sum-prs', { dataset: { count: n } },
    h('div.ses-sum-prs-head',
      h('span.ses-sum-prs-emoji', { 'aria-hidden': 'true' }, '🏆'),
      h('h2.ses-sum-prs-title', n === 1 ? '1 récord en esta sesión' : `${n} récords en esta sesión`)),
    h('ul.ses-sum-prs-list', rows));
}

const DIR_ICON = { up: 'arrow-up', down: 'arrow-down', same: 'minus' };
const DIR_LABEL = { up: 'Mejora', down: 'Baja', same: 'Igual' };

/** «Frente a la anterior» (la misma rutina): una fila por ejercicio con la serie más pesada, y los totales. */
function compareCard(cmp, dur) {
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0');
  const vp = pct(cmp.volume.cur, cmp.volume.prev);
  const totals = [
    `Series de trabajo ${cmp.sets.cur} (antes ${cmp.sets.prev})`,
    vp != null && cmp.volume.cur > 0 ? `volumen ${signed(vp)} %` : null,
    dur != null && cmp.duration.prev != null ? `duración ${fmtMinutes(dur)} (antes ${fmtMinutes(cmp.duration.prev)})` : null,
  ].filter(Boolean);
  return h('section.card.ses-sum-cmp', { dataset: { prev: cmp.prevId } },
    h('div.ses-cmp-head',
      h('h2.ses-cmp-title', 'Frente a la anterior'),
      h('p.ses-cmp-sub', `La misma rutina, el ${fmtDate(cmp.prevDate, 'day')} · serie más pesada de cada ejercicio`)),
    h('ul.ses-cmp-list', cmp.rows.map((r) => h('li.ses-cmp-row', { dataset: { dir: r.dir, tone: deltaTone(r.dir, { better: 'up' }), ex: r.exerciseId } },
      h('span.ses-cmp-icon', { 'aria-label': DIR_LABEL[r.dir], role: 'img' }, icon(DIR_ICON[r.dir], 16)),
      h('span.ses-cmp-name', r.name),
      h('span.ses-cmp-val.tnum', r.text)))),
    cmp.more ? h('p.ses-cmp-more', `y ${cmp.more} ${cmp.more === 1 ? 'ejercicio más' : 'ejercicios más'}`) : null,
    h('p.ses-cmp-totals.tnum', totals.join(' · ')));
}
