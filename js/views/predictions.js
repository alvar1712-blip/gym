// predictions.js — tiempos previstos (#/predictions): por cada distancia (5 km, 10 km, media y maratón) la estimación
// actual en grande, el rango probable y el ritmo debajo, la confianza, un aviso si procede y «¿Por qué?»; si la
// predicción todavía no es útil (poco volumen para media/maratón, carreras que se contradicen) lo dice en vez de
// enseñar cifras (la estimación orientativa, a un toque). Comprobador «¿Puedo hacerlo?» (distancia + tiempo objetivo →
// veredicto), carreras que no cuentan por un ritmo imposible (para revisarlas) y la base del cálculo (esfuerzos usados,
// km por semana, tirada más larga). Estado vacío si no hay datos suficientes. Tiempos y ritmos SOLO con los
// formateadores estrictos de util.js (fmtRaceTime, fmtPaceKm, fmtRaceRange): nunca negativos ni «h:mm:ss/km».
// PROPIETARIO: módulo de predicciones. Los cálculos salen de js/race-predict.js (puro); aquí solo DOM.
// Tono prudente: siempre estimación, nunca promesa.
import { navigate } from '../router.js';
import { h, icon, screen, segmented, durationInput, numInput, field, emptyState, whyBox, stateTag, kpiValue } from '../ui.js';
import { fmtDate, fmtNum, fmtRaceTime, fmtPaceKm, fmtRaceRange } from '../util.js';
import { dataFromStore } from '../progress-ui.js';
import { racesLink } from './races.js';
import {
  predictRaces, checkTarget, predictFor, predictionDataset, raceFor, rangeText, paceRangeText, fmtGap, fmtGapPerKm,
  RACES, MIN_KM, MIN_VALID, WINDOW_WEEKS, VOLUME_WEEKS, TOP_N, VOLUME, MAX_PACE, MIN_PACE,
} from '../race-predict.js';

/** Límites de «Otra» distancia (km). */
const CUSTOM_MIN = 1;
const CUSTOM_MAX = 100;
const CONF_LEVEL = { alta: 'high', media: 'medium', baja: 'low' };
const VERDICT_ICON = { probable: 'check', ajustado: 'target', hoy_no: 'clock', insuficiente: 'info' };
/** Lo último elegido en el comprobador (se conserva mientras la app está abierta). */
const mem = { dist: '10k', customKm: null, target: null };

const NB = '\u00a0';
const WJ = '\u2060'; // unión sin espacio: no se parte «23:40–24:50»
/** Evita cortes feos: «12 km», «4:54 /km», «20 sep», «23:40–24:50» quedan juntos. */
const keep = (s) => String(s ?? '')
  .replace(/(\d)–(\d)/g, `$1${WJ}–${WJ}$2`)
  .replace(/(\d) (km|m|s|min|h|%)(?=[\s.,;)·/]|$)/g, `$1${NB}$2`)
  .replace(/(\d) \/km/g, `$1${NB}/km`)
  .replace(/(\d{1,2}) (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/g, `$1${NB}$2`);
const km1 = (v) => `${fmtNum(v, 1)}${NB}km`;
const dayTxt = (d) => fmtDate(d, 'day');
/** Tiempo «29:37» / «1:42:16»; '—' si no vale (nunca basura). */
const timeTxt = (s) => fmtRaceTime(s) ?? '—';
/** Ritmo «5:55/km»; '—' si no vale. */
const paceTxt = (s) => fmtPaceKm(s) ?? '—';

export function mountPredictions(root) {
  const c = screen(root, { title: 'Tiempos previstos', subtitle: 'Estimación con tus carreras', back: '#/progress' });
  c.classList.add('prd');
  const data = dataFromStore();
  const r = predictRaces(data);
  c.dataset.ok = r.ok ? '1' : '0';

  if (!r.ok) {
    c.appendChild(emptyView(r));
    return undefined;
  }

  c.appendChild(h('p.prd-intro', icon('info', 16),
    h('span', 'Estimación a partir de tus mejores carreras recientes. No es una promesa: el recorrido, el calor, el descanso y cómo repartas el esfuerzo cuentan.')));
  if (r.suspect.length) c.appendChild(suspectView(r.suspect));
  c.appendChild(h('section.prd-races', { 'aria-labelledby': 'prd-races-title' },
    h('h2.section-title', { id: 'prd-races-title' }, 'Por distancia'),
    RACES.map((race) => raceCard(r.predictions[race.id]))));
  c.appendChild(checker(data, r));
  c.appendChild(h('div.list.prd-races-link', racesLink()));
  c.appendChild(basisView(r));
  return undefined;
}

// ===========================================================================
// Estado vacío
// ===========================================================================

function emptyView(r) {
  const have = r.valid === 1
    ? 'Llevas 1: te falta otra.'
    : 'Aún no hay ninguna que cuente.';
  return h('section.card.prd-empty',
    emptyState({
      emoji: '⏱️',
      title: 'Aún no hay datos suficientes',
      text: `Para estimar tus tiempos en 5 km, 10 km, media y maratón hacen falta al menos ${MIN_VALID} carreras de ${MIN_KM} km o más en las últimas ${WINDOW_WEEKS} semanas, con distancia y tiempo. ${have}`,
      action: { label: 'Registrar una carrera', onClick: () => navigate('#/activity/new?kind=run') },
    }),
    h('button.btn.btn-secondary.btn-block.prd-add-result', { type: 'button', onClick: () => navigate('#/context/new?kind=event&type=race_result') },
      '🏁 Apuntar un resultado anterior'),
    h('p.prd-note.prd-add-result-why', '¿Corriste una carrera antes de usar Entreno? Apúntala en tu contexto (vale con el mes): cuenta como referencia, con menos peso cuanto más antigua.'),
    h('div.prd-empty-count', { 'aria-label': `${r.valid} de ${MIN_VALID} carreras válidas` },
      Array.from({ length: MIN_VALID }, (_, i) => h('span.prd-dot', { class: i < r.valid ? 'on' : '' })),
      h('span', `${r.valid} de ${MIN_VALID} carreras válidas`)),
    r.notCounted ? h('p.prd-empty-msg', keep(r.notCounted)) : null,
    r.suspect.length ? suspectList(r.suspect) : null,
    whyBox(whyContent(r.why), '¿Qué cuenta?'),
    h('p.prd-note', 'Solo cuenta la carrera: el senderismo y otros deportes no. Si importas o registras tus carreras con su tiempo en movimiento, la estimación es más fiel.'));
}

// ===========================================================================
// Carreras que no cuentan por un ritmo imposible (para revisarlas)
// ===========================================================================

/** Ficha de un esfuerzo: la actividad registrada o el resultado de tu contexto. */
const effortHref = (x) => (x.source === 'context' ? `#/context/${encodeURIComponent(x.entryId)}` : `#/activity/${x.sessionId}`);

function suspectList(list) {
  return h('div.list.prd-suspect-list', list.map((x) => h('button.list-item.prd-suspect-item', {
    type: 'button', dataset: { session: x.sessionId ?? '', entry: x.entryId ?? '', source: x.source, why: x.why }, 'aria-label': `Revisar ${x.label.replace(/\s+/g, ' ')}`,
    onClick: () => navigate(effortHref(x)),
  },
    h('span.prd-effort-emoji', { 'aria-hidden': 'true' }, x.source === 'context' ? '🏁' : '🏃'),
    h('span.list-item-main',
      h('span.list-item-title', keep(x.label)),
      h('span.list-item-sub', keep(`${dayTxt(x.date)} · ${x.why === 'slow' ? `más lenta de ${paceTxt(MAX_PACE)}` : `más rápida de ${paceTxt(MIN_PACE)}`}`))),
    icon('chevron-right', 20, 'chev'))));
}

function suspectView(list) {
  const n = list.length;
  const slow = list.some((x) => x.why === 'slow');
  return h('section.card.prd-suspect', { 'aria-labelledby': 'prd-suspect-title' },
    h('h2.prd-suspect-title', { id: 'prd-suspect-title' }, icon('alert', 16),
      h('span', n === 1 ? '1 carrera no cuenta por su ritmo' : `${n} carreras no cuentan por su ritmo`)),
    h('p.prd-suspect-text', slow
      ? 'Un ritmo así no es de carrera: suele ser un tiempo mal apuntado (por ejemplo, minutos escritos en la casilla de las horas). Si lo corriges, contará.'
      : 'Un ritmo así no es creíble para una carrera: revisa la distancia y el tiempo. Si lo corriges, contará.'),
    suspectList(list));
}

// ===========================================================================
// Tarjeta de una distancia
// ===========================================================================

/** Confianza con el mismo componente que el analista (ui.stateTag, contorno): «Confianza baja». */
function confBadge(p) {
  return stateTag(`conf-${CONF_LEVEL[p.confidence] || 'medium'}`, `Confianza ${p.confidence}`, { className: `prd-conf prd-conf-${p.confidence}` });
}

/** Estimación actual en grande, y debajo el rango probable y el ritmo. null si algún número no vale. */
function estimateView(p, { tentative = false } = {}) {
  const time = fmtRaceTime(p.mid);
  const range = fmtRaceRange(p.low, p.high);
  const pace = fmtPaceKm(p.pace);
  if (!time || !range || !pace) return null;
  return h(`div.prd-est${tentative ? '.prd-est-tentative' : ''}`,
    h('div.prd-race-main',
      h('span.prd-race-time', { 'aria-label': `Estimación ${tentative ? 'orientativa' : 'actual'}: ${time}` }, time),
      h('span.prd-race-caption', tentative ? 'estimación orientativa' : 'estimación actual')),
    h('dl.prd-race-facts',
      h('div.prd-fact', h('dt', 'Rango probable'), h('dd.prd-race-range', { 'aria-label': `Entre ${range.replace('–', ' y ')}` }, keep(range))),
      h('div.prd-fact', h('dt', 'Ritmo estimado'), h('dd.prd-race-pace', pace))));
}

/** «🏁 Incluye tu marca de may 2026 (10 km · 1:00:00), con poco peso (8 %).» si se usan referencias históricas. */
function historyLine(p) {
  const olds = p.efforts.filter((e) => e.old);
  if (!olds.length) return null;
  const share = fmtNum(olds.reduce((t, e) => t + e.share, 0) * 100, 0);
  const text = olds.length === 1
    ? `Incluye tu marca de ${olds[0].when} (${fmtNum(olds[0].km, 2)} km · ${timeTxt(olds[0].sec)}), con poco peso (${share} %).`
    : `Incluye ${olds.length} marcas anteriores, con poco peso (${share} % entre las dos).`;
  return h('p.prd-race-history', h('span', { 'aria-hidden': 'true' }, '🏁'), h('span', keep(text)));
}

function noteView(text) {
  return text ? h('p.prd-race-note', icon('alert', 14), h('span', keep(text))) : null;
}

/** Lo que falta de volumen (media/maratón): minitabla «Ahora · Referencia» con los criterios que no se cumplen. */
function volumeFacts(p) {
  const v = p.volume;
  if (!v) return null;
  const rows = [];
  if (!v.longOk) rows.push(['Tirada más larga', km1(v.longKm), `≥${NB}${v.longTarget}${NB}km`]);
  if (!v.weeklyOk) rows.push(['Km por semana', km1(v.weeklyKm), `≥${NB}${v.weeklyTarget}${NB}km`]);
  if (!rows.length) return null;
  return h('table.prd-vol',
    h('thead', h('tr', h('td'), h('th', { scope: 'col' }, 'Ahora'), h('th', { scope: 'col' }, 'Referencia'))),
    h('tbody', rows.map(([label, now, ref]) => h('tr.prd-vol-row', h('th', { scope: 'row' }, label), h('td.prd-vol-now', now), h('td.prd-vol-ref', ref)))));
}

function raceCard(p) {
  const el = h('article.card.prd-race', { dataset: { race: p.id, confidence: p.confidence, status: p.status, ...predictionDataset(p) } },
    h('div.prd-race-head',
      h('h3.prd-race-name', p.label),
      confBadge(p)));
  const est = p.usable ? estimateView(p, { tentative: p.status === 'tentative' }) : null;
  if (p.status === 'ok' && est) {
    el.append(est);
    const hist = historyLine(p);
    if (hist) el.append(hist);
    const note = noteView(p.advice.note);
    if (note) el.append(note);
  } else if (p.status === 'tentative' && est) {
    // «La fórmula puede calcularlo» ≠ «hay datos para una predicción útil»: primero lo que falta; la cifra, a un toque.
    est.hidden = true;
    est.id = `prd-est-${p.id}`;
    const btn = h('button.prd-reveal', {
      type: 'button', 'aria-expanded': 'false', 'aria-controls': est.id,
      onClick: () => {
        est.hidden = !est.hidden;
        btn.setAttribute('aria-expanded', String(!est.hidden));
        btn.lastChild.textContent = est.hidden ? 'Ver estimación orientativa' : 'Ocultar estimación orientativa';
      },
    }, icon('chevron-down', 16), h('span', 'Ver estimación orientativa'));
    el.append(...[
      h('p.prd-race-state', 'Predicción todavía poco fiable'),
      h('p.prd-race-explain', keep(p.advice.note)),
      volumeFacts(p),
      btn,
      est,
    ].filter(Boolean));
  } else {
    el.append(
      h('p.prd-race-state', p.status === 'incoherent' ? 'Predicción todavía poco fiable' : 'Datos insuficientes'),
      h('p.prd-race-explain', keep(p.advice.note || 'Aún no hay datos para estimar esta distancia.')));
  }
  el.append(whyBox(whyContent(p.why)));
  return el;
}

// ===========================================================================
// «¿Por qué?»: regla + datos (dos columnas; apiladas si alguna fila es larga)
// ===========================================================================

const isLong = (label, value) => String(label).length + String(value).length > 38;

/** La regla, frase a frase (se lee mejor que un párrafo largo). */
const sentences = (t) => String(t).split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¿])/).filter(Boolean);

function whyContent(why) {
  const stack = why.data.some((d) => isLong(d.label, d.value));
  const [first, ...rest] = sentences(why.rule);
  return h('div.prd-why',
    h('div.prd-why-rule',
      h('p', h('b', 'Regla. '), keep(first)),
      rest.map((t) => h('p', keep(t)))),
    why.data.length ? h('p.prd-why-head', 'Datos') : null,
    why.data.length
      ? h(`ul.prd-why-data${stack ? '.prd-why-stacked' : ''}`, why.data.map((d) => h('li.prd-why-row',
        h('span.prd-why-label', keep(d.label)),
        h('span.prd-why-value', keep(d.value)))))
      : null);
}

// ===========================================================================
// ¿Puedo hacerlo?
// ===========================================================================

function checker(data, r) {
  const customCache = new Map();
  const predictionFor = (km) => {
    const race = raceFor(km);
    if (race && r.predictions[race.id]) return r.predictions[race.id];
    const key = km.toFixed(3);
    // La misma entrada única que Objetivos y Eventos (race-predict.predictFor)
    if (!customCache.has(key)) customCache.set(key, predictFor(data, km).prediction);
    return customCache.get(key);
  };

  const hint = h('span.prd-check-hint');
  const result = h('div.prd-verdict-slot', { 'aria-live': 'polite' });
  const customInput = numInput({
    value: mem.customKm, placeholder: 'p. ej. 15', decimals: 2, suffix: 'km', ariaLabel: 'Otra distancia en km',
    onInput: (v) => { mem.customKm = v; update(); },
  });
  const customField = h('div.prd-check-custom', { hidden: mem.dist !== 'custom' },
    field('Otra distancia', customInput, `Entre ${CUSTOM_MIN} y ${CUSTOM_MAX} km`));
  const seg = segmented({
    options: [...RACES.map((x) => ({ value: x.id, label: x.short })), { value: 'custom', label: 'Otra' }],
    value: mem.dist,
    ariaLabel: 'Distancia',
    onChange: (v) => {
      mem.dist = v;
      customField.hidden = v !== 'custom';
      update();
      if (v === 'custom' && mem.customKm == null) setTimeout(() => (customInput.input || customInput).focus(), 0);
    },
  });
  seg.classList.add('prd-seg');
  const dur = durationInput({
    seconds: mem.target, showHours: true, showSeconds: true, ariaLabel: 'Tiempo objetivo',
    onChange: (sec) => { mem.target = sec; update(); },
  });

  function distanceKm() {
    if (mem.dist === 'custom') return mem.customKm;
    return RACES.find((x) => x.id === mem.dist)?.km ?? null;
  }

  function update() {
    const km = distanceKm();
    const customBad = mem.dist === 'custom' && km != null && !(km >= CUSTOM_MIN && km <= CUSTOM_MAX);
    if (km == null || customBad) {
      hint.textContent = '';
      result.replaceChildren(h('p.prd-verdict-empty', customBad
        ? `Escribe una distancia entre ${CUSTOM_MIN} y ${CUSTOM_MAX} km.`
        : 'Escribe la distancia en km.'));
      return;
    }
    const p = predictionFor(km);
    hint.textContent = !p.usable
      ? `Sin una previsión útil ${p.phrase}.`
      : keep(`${p.status === 'tentative' ? 'Orientativo' : 'Previsto'} ${p.phrase}: ${rangeText(p)} (${paceRangeText(p)})`);
    if (!(mem.target > 0)) {
      result.replaceChildren(h('p.prd-verdict-empty', 'Escribe tu tiempo objetivo para ver si es probable, ajustado o si hoy aún no.'));
      return;
    }
    result.replaceChildren(verdictView(checkTarget(data, km, mem.target)));
  }

  const el = h('section.card.prd-check', { 'aria-labelledby': 'prd-check-title' },
    h('div.prd-check-head',
      h('h2.prd-check-title', { id: 'prd-check-title' }, '¿Puedo hacerlo?'),
      h('p.prd-check-sub', 'Elige la distancia y escribe tu tiempo objetivo.')),
    h('div.field', h('span.field-label', 'Distancia'), seg),
    customField,
    h('div.field', h('span.field-label', 'Tiempo objetivo'), dur, hint),
    result);
  update();
  return el;
}

function verdictView(res) {
  const v = res.verdict;
  let gap = null;
  if (res.prediction && res.gapSec != null) {
    const g = res.gapSec;
    const per = fmtGapPerKm(res.gapPerKmSec);
    if (v === 'hoy_no') gap = { label: 'Te faltan', value: `≈${NB}${fmtGap(g)}`, sub: `≈ ${per} más rápido que tu tiempo previsto` };
    else if (v === 'probable') gap = { label: 'Margen', value: `≈${NB}${fmtGap(g)}`, sub: `≈ ${per} sobre tu tiempo previsto` };
    else if (Math.abs(g) < 2.5) gap = { label: 'Diferencia', value: 'ninguna', sub: 'igual que tu tiempo previsto' };
    else if (g > 0) gap = { label: 'Te pide', value: `≈${NB}${fmtGap(g)}`, sub: `≈ ${per} más rápido que tu tiempo previsto` };
    else gap = { label: 'Margen', value: `≈${NB}${fmtGap(g)}`, sub: `≈ ${per} sobre tu tiempo previsto` };
  }
  const p = res.prediction;
  return h(`div.prd-verdict.prd-v-${v}`, { dataset: { verdict: v, ...predictionDataset(p) } },
    h('div.prd-v-head',
      h('span.prd-v-icon', { 'aria-hidden': 'true' }, icon(VERDICT_ICON[v] || 'info', 20)),
      h('div.prd-v-titles',
        h('div.prd-v-line',
          h('span.prd-v-label', res.label),
          p ? confBadge(p) : null),
        h('span.prd-v-sub', keep(`${res.distanceLabel} en ${timeTxt(res.targetSec)}${p ? ` · ${paceTxt(res.targetSec / p.km)}` : ''}`)))),
    gap ? h('div.prd-v-gap',
      h('span.prd-v-gap-label', gap.label),
      h('span.prd-v-gap-value', gap.value),
      h('span.prd-v-gap-sub', keep(gap.sub))) : null,
    h('p.prd-v-text', keep(res.text)),
    res.why && res.why.rule ? whyBox(whyContent(res.why)) : null);
}

// ===========================================================================
// Base del cálculo
// ===========================================================================

/** Referencias históricas listadas en «Con qué se calcula», como mucho. */
const MAX_HISTORY_SHOWN = 5;

/** Un esfuerzo de la base o una referencia histórica: abre la carrera registrada o el resultado de tu contexto. */
function effortItem(e) {
  const ctx = e.source === 'context';
  const tags = [e.old ? 'referencia histórica' : ctx ? 'de tu contexto' : null, e.interrupted ? 'antes de un parón' : null].filter(Boolean);
  return h('button.list-item.prd-effort', {
    type: 'button', dataset: { session: e.sessionId ?? '', entry: e.entryId ?? '', source: e.source }, onClick: () => navigate(effortHref(e)),
  },
    h('span.prd-effort-emoji', { 'aria-hidden': 'true' }, ctx ? '🏁' : '🏃'),
    h('span.list-item-main',
      h('span.list-item-title.lines-2', keep(`${e.name ? `${e.name} · ` : ''}${fmtNum(e.km, 2)} km en ${timeTxt(e.sec)}`)),
      h('span.list-item-sub.wrap', keep([e.when, paceTxt(e.pace), ...tags].join(' · ')))),
    icon('chevron-right', 20, 'chev'));
}

function basisView(r) {
  const longest = r.longest;
  const kpi = (label, value, sub) => h('div.kpi', h('div.kpi-label', label), kpiValue(value), h('div.kpi-sub', sub));
  return h('section.card.prd-basis', { 'aria-labelledby': 'prd-basis-title' },
    h('h2.prd-basis-title', { id: 'prd-basis-title' }, 'Con qué se calcula'),
    h('div.kpis.prd-kpis',
      kpi('Km por semana', km1(r.weeklyKm), `media ${VOLUME_WEEKS} sem.`),
      kpi('Tirada larga', longest ? km1(longest.km) : '—', longest ? dayTxt(longest.date) : `${VOLUME_WEEKS} sem.`),
      kpi('Carreras', String(r.valid), `≥${NB}${MIN_KM}${NB}km · ${WINDOW_WEEKS}${NB}sem.`)),
    r.basis.length ? h('h3.prd-basis-sub', r.basis.length === 1 ? 'Esfuerzo usado' : `Los ${r.basis.length} esfuerzos usados`) : null,
    r.basis.length ? h('div.list.prd-efforts', r.basis.map((e) => effortItem(e))) : h('p.prd-note.prd-no-recent', 'Ninguna carrera reciente válida: la estimación sale de tus referencias históricas.'),
    r.history.length ? h('h3.prd-basis-sub', 'Referencias históricas') : null,
    r.history.length ? h('div.list.prd-efforts.prd-history', r.history.slice(0, MAX_HISTORY_SHOWN).map((e) => effortItem(e))) : null,
    r.duplicates.length ? h('p.prd-note.prd-dup', keep(`No se cuenta dos veces: ${r.duplicates.map((x) => `${x.label} (${x.when}) de tu contexto es la misma carrera que la registrada el ${x.runWhen}`).join('; ')}.`)) : null,
    h('p.prd-note', `Se usan tus ${TOP_N} mejores carreras de ${MIN_KM} km o más de las últimas ${WINDOW_WEEKS} semanas, con su tiempo en movimiento; las más recientes y de distancia más parecida pesan más. Solo cuenta la carrera: el senderismo y otros deportes no.`),
    h('p.prd-note', 'Los resultados de carrera de tu contexto también cuentan: los recientes, como una carrera más; los anteriores, como referencia histórica con menos peso cuanto más antiguos y la mitad si después hubo un parón. Tu historial importa, pero tu estado reciente importa más.'),
    h('p.prd-note', `Media y maratón dependen también del volumen: con menos de ${VOLUME.half.weeklyKm} km/sem o una tirada de menos de ${VOLUME.half.longKm} km (media), o de ${VOLUME.marathon.weeklyKm} km/sem y ${VOLUME.marathon.longKm} km (maratón), la estimación sale más lenta y con menos confianza.`));
}
