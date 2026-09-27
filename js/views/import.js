// import.js — #/import: importar actividades desde archivos GPX, TCX o FIT (también .gz y .zip).
// Flujo: elegir uno o varios archivos → vista previa editable (tipo, fecha, datos, esfuerzo) con duplicados
// desmarcados → «Guardar» crea actividades normales (misma forma que el formulario de actividad).
// La lectura y los cálculos son puros: ../import-parse.js, ../import-zip.js y ../import-logic.js.
import * as store from '../store.js';
import { navigate } from '../router.js';
import {
  h, icon, screen, sheet, segmented, chips, rpePicker, durationInput, field, numInput, textInput, toast, confirmDialog,
} from '../ui.js';
import { todayStr, fmtDate, uid, plural, isDateStr, hhmm } from '../util.js';
import { ACTIVITY_EMOJI } from '../seed.js';
import { ACTIVITY_KINDS, KIND_UI, activityTitle } from '../activity-logic.js';
import { readActivityFile } from '../import-parse.js';
import * as IL from '../import-logic.js';

const KIND_COLOR = { run: 'var(--act-run)', bike: 'var(--act-bike)', swim: 'var(--act-swim)', hike: 'var(--act-hike)', other: 'var(--act-other)' };
const FORMAT_LABEL = { gpx: 'GPX', tcx: 'TCX', fit: 'FIT' };

export function mountImport(root) {
  const c = screen(root, { title: 'Importar actividades', back: '#/today' });
  c.classList.add('imp-screen');
  const state = { items: [], errors: [], busy: null, result: null };
  let seq = 0;
  let alive = true;

  // Sin `accept`: en iPhone, extensiones que el sistema no conoce (.fit, .tcx) dejan los archivos en gris.
  // El formato se detecta por el contenido.
  const input = h('input.imp-file', { type: 'file', multiple: true, tabindex: '-1', 'aria-hidden': 'true' });
  input.addEventListener('change', onFiles);
  const body = h('div.imp-body');
  const footer = h('div.imp-footer');
  c.append(input, body, footer);
  paint();

  function pick() {
    if (state.busy) return;
    input.value = '';
    input.click();
  }

  // ---------- lectura de archivos ----------
  async function onFiles() {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length || state.busy) return;
    state.result = null;
    state.busy = { done: 0, total: files.length };
    paint();
    const today = todayStr();
    for (const f of files) {
      let entries;
      try {
        entries = await readActivityFile(f.name, await f.arrayBuffer());
      } catch {
        entries = [{ label: f.name, fileName: f.name, error: 'No se pudo leer el archivo.' }];
      }
      if (!alive) return;
      for (const e of entries) {
        if (e.error) state.errors.push({ key: `e${++seq}`, label: e.label, error: e.error });
        else state.items.push(IL.itemFromEntry(e, { key: `i${++seq}`, today }));
      }
      state.busy.done++;
      paintFooter();
    }
    state.busy = null;
    refreshDuplicates();
    paint();
  }

  function refreshDuplicates() {
    IL.updateDuplicates(state.items, store.all('sessions'), todayStr());
  }

  // ---------- pintado ----------
  function paint() {
    const parts = [];
    if (state.result) parts.push(resultCard());
    const hasList = state.items.length || state.errors.length;
    if (!hasList && !state.result) parts.push(introCard());
    if (hasList) {
      parts.push(listHead());
      for (const it of state.items) parts.push(itemCard(it));
      for (const e of state.errors) parts.push(errorCard(e));
    }
    parts.push(howToCard(!hasList && !state.result));
    body.replaceChildren(...parts);
    paintFooter();
  }

  function paintFooter() {
    const hasList = state.items.length || state.errors.length;
    if (state.busy) {
      footer.replaceChildren(h('button.btn.btn-primary.btn-lg.btn-block.imp-pick', { type: 'button', disabled: true },
        `Leyendo ${Math.min(state.busy.done + 1, state.busy.total)} de ${state.busy.total}…`));
      return;
    }
    if (!hasList) {
      footer.replaceChildren(h('button.btn.btn-primary.btn-lg.btn-block.imp-pick', { type: 'button', onClick: pick },
        icon('upload', 22), state.result ? 'Importar más archivos' : 'Elegir archivos'));
      return;
    }
    const n = IL.selectedItems(state.items, todayStr()).length;
    footer.replaceChildren(
      h('button.btn.btn-secondary.btn-lg.imp-add', { type: 'button', onClick: pick, 'aria-label': 'Añadir más archivos', title: 'Añadir más archivos' }, icon('plus', 26)),
      h('button.btn.btn-primary.btn-lg.imp-save', { type: 'button', disabled: !n, onClick: saveAll },
        n ? `Guardar ${n === 1 ? '1 actividad' : `${n} actividades`}` : 'Nada marcado'));
  }

  function introCard() {
    return h('section.card.imp-intro',
      h('div.imp-intro-icon', icon('upload', 26)),
      h('h2.imp-intro-title', 'Trae tus entrenamientos'),
      h('p.imp-intro-text', 'Archivos GPX, TCX o FIT de Garmin, Strava u otras apps, también dentro de un .gz o un .zip. Puedes elegir varios a la vez.'),
      h('p.imp-intro-note', 'Se leen en este iPhone, no se sube nada. Antes de guardar revisas cada actividad.'));
  }

  function howToCard(open) {
    const step = (title, text) => h('div.imp-howto-item', h('div.imp-howto-name', title), h('p.imp-howto-text', text));
    return h('details.card.imp-howto', { open: open || null },
      h('summary.imp-howto-sum', icon('info', 18), h('span', '¿Cómo exporto mis actividades?'), icon('chevron-down', 18, 'imp-howto-chev')),
      h('div.imp-howto-body',
        step('Strava', 'Desde la web (strava.com), abre la actividad y pulsa «⋯ → Exportar GPX». La app de Strava no exporta archivos.'),
        step('Garmin Connect', 'Desde la web (connect.garmin.com), abre la actividad y pulsa «⚙ → Exportar original» (un .zip con el .fit), «Exportar a GPX» o «Exportar a TCX».'),
        step('Apple Watch y Salud', 'Salud no exporta entrenamientos sueltos. Si el reloj se sincroniza con Strava, expórtalo desde la web de Strava; si no, apps como HealthFit o RunGap guardan cada entrenamiento como FIT o GPX.'),
        h('p.imp-howto-tip', 'Guarda el archivo en «Archivos» (o descárgalo con Safari) y elígelo aquí.')));
  }

  function listHead() {
    const today = todayStr();
    const n = state.items.length;
    const sel = IL.selectedItems(state.items, today).length;
    const dups = state.items.filter((it) => it.dup).length;
    const bits = [plural(n, 'actividad', 'actividades'), `${sel} para guardar`];
    if (dups) bits.push(dups === 1 ? '1 ya registrada' : `${dups} ya registradas`);
    return h('div.imp-head',
      h('div.imp-head-text', bits.join(' · ')),
      h('button.btn.btn-ghost.btn-sm.imp-clear', { type: 'button', onClick: clearList }, 'Vaciar'));
  }

  function clearList() {
    state.items = [];
    state.errors = [];
    paint();
  }

  function itemTitle(it) {
    return it.kind ? activityTitle({ kind: it.kind, subtype: it.subtype, poolType: it.poolType }) : 'Deporte sin identificar';
  }

  function whenText(it) {
    if (!isDateStr(it.date)) return 'Sin fecha';
    const d = fmtDate(it.date, 'short');
    return Number.isFinite(it.startedAt) ? `${d} · ${hhmm(it.startedAt)}` : `${d} · sin hora`;
  }

  function itemCard(it) {
    const today = todayStr();
    const problems = IL.itemProblems(it, today);
    const title = itemTitle(it);
    const facts = IL.itemFacts(it);
    const check = h('button.imp-check', {
      type: 'button',
      role: 'checkbox',
      'aria-checked': String(!!it.selected),
      'aria-label': `Importar ${title} del ${whenText(it)}`,
      disabled: problems.length > 0,
      onClick: () => { it.selected = !it.selected; paint(); },
    }, icon('check', 20));
    const badge = it.dup
      ? h('span.badge.badge-warn.imp-badge', it.dup.type === 'saved' ? 'Ya registrada' : 'Repetida')
      : null;
    const main = h('button.imp-item-main', { type: 'button', onClick: () => editItem(it), 'aria-label': `Revisar ${title}` },
      h('div.imp-item-top',
        h('span.imp-emoji', { 'aria-hidden': 'true' }, it.kind ? ACTIVITY_EMOJI[it.kind] : '❓'),
        h('span.imp-item-title', title),
        badge),
      h('div.imp-item-when', whenText(it)),
      facts.main.length ? h('div.imp-item-facts', factList(facts.main)) : null,
      facts.extra.length ? h('div.imp-item-extra', factList(facts.extra)) : null,
      h('div.imp-item-file', `${FORMAT_LABEL[it.format] || ''} · ${it.label}`));
    const card = h('article.card.imp-item', {
      dataset: { key: it.key, kind: it.kind || '' },
      class: [it.selected ? 'imp-on' : 'imp-off', it.dup ? 'imp-dup' : ''].filter(Boolean).join(' '),
      style: `--imp-c: ${KIND_COLOR[it.kind] || 'var(--border-strong)'}`,
    },
    h('div.imp-item-row', check, main, h('span.imp-chev', { 'aria-hidden': 'true' }, icon('chevron-right', 20))));
    if (it.dup) {
      const d = it.dup;
      const txt = d.type === 'saved'
        ? `Coincide con «${d.title}» del ${fmtDate(d.date, 'short')}${d.startedAt ? ` a las ${hhmm(d.startedAt)}` : ''}. No se importará salvo que la marques.`
        : `Está repetida en esta importación (${d.label}).`;
      card.appendChild(h('p.imp-note.imp-note-warn', txt));
    }
    if (problems.includes('kind')) card.appendChild(kindPicker(it));
    const rest = problems.filter((p) => p !== 'kind');
    if (rest.length) card.appendChild(h('p.imp-note.imp-note-error', `${IL.problemText(rest)}: toca la actividad para completarla.`));
    return card;
  }

  /** «5 km · 25:10 · 5:02 /km»: cada dato sin partir (el salto de línea solo entre datos). */
  function factList(list) {
    return list.flatMap((t, i) => (i ? [' · ', h('span.imp-fact', t)] : [h('span.imp-fact', t)]));
  }

  function kindPicker(it) {
    const hint = it.sport || it.sportName ? `El archivo dice «${it.sport || it.sportName}». ` : '';
    return h('div.imp-kind-pick',
      h('p.imp-note', `${hint}¿Qué deporte es?`),
      chips({
        options: ACTIVITY_KINDS.map((k) => ({ value: k, label: `${ACTIVITY_EMOJI[k]} ${KIND_UI[k].seg}` })),
        value: null,
        className: 'imp-kind-chips',
        onChange: (k) => {
          IL.setItemKind(it, k);
          refreshDuplicates();
          paint();
        },
      }));
  }

  function errorCard(e) {
    return h('div.card.imp-error', { dataset: { key: e.key } },
      h('span.imp-error-icon', icon('alert', 20)),
      h('div.imp-error-main', h('div.imp-error-name', e.label), h('div.imp-error-text', e.error)));
  }

  function resultCard() {
    const r = state.result;
    const n = r.ids.length;
    return h('section.card.card-accent.imp-done',
      h('div.imp-done-title', icon('check', 22), n === 1 ? '1 actividad importada' : `${n} actividades importadas`),
      h('p.imp-done-text', `Ya están en el historial con su fecha y hora.${r.skipped ? ` ${r.skipped === 1 ? '1 no se ha importado' : `${r.skipped} no se han importado`} (ya registradas, sin marcar o incompletas).` : ''}`),
      h('button.btn.btn-primary.btn-block.imp-history', { type: 'button', onClick: () => navigate('#/history') }, icon('history', 20), 'Ver historial'),
      n ? h('button.btn.btn-ghost.btn-block.imp-undo', { type: 'button', onClick: undoImport }, 'Deshacer importación') : null);
  }

  // ---------- revisar / editar ----------
  function editItem(it) {
    const box = h('div.stack.imp-edit');
    const build = () => box.replaceChildren(...editFields(it, build));
    build();
    sheet({
      title: 'Revisar actividad',
      tall: true,
      className: 'imp-sheet',
      body: box,
      actions: [{ label: 'Listo', kind: 'primary' }],
      onClose: () => {
        if (!alive) return;
        refreshDuplicates();
        paint();
      },
    });
  }

  function editFields(it, rebuild) {
    const k = it.kind;
    const out = [];
    const kindSeg = segmented({
      options: ACTIVITY_KINDS.map((x) => ({ value: x, label: KIND_UI[x].seg })),
      value: k,
      ariaLabel: 'Tipo de actividad',
      onChange: (x) => { IL.setItemKind(it, x); rebuild(); },
    });
    kindSeg.classList.add('act-kinds', 'imp-kinds');
    out.push(kindSeg);
    if (!k) {
      out.push(h('p.imp-note', 'Elige el deporte para ver y completar sus datos.'));
      return out;
    }
    if (k === 'other') {
      out.push(field('Tipo', textInput({
        value: it.subtype || '', placeholder: 'p. ej. Caminata, pádel…', maxlength: 60, ariaLabel: 'Tipo de actividad',
        onInput: (v) => IL.setItemField(it, 'subtype', v.trim() || null),
      })));
    }
    const dateInp = h('input.input.imp-date', { type: 'date', value: it.date || '', max: todayStr(), 'aria-label': 'Fecha' });
    dateInp.addEventListener('change', () => {
      const v = dateInp.value;
      if (isDateStr(v) && v > todayStr()) { dateInp.value = it.date || ''; toast('La fecha no puede ser futura.', { kind: 'error' }); return; }
      if (isDateStr(v)) IL.setItemDate(it, v);
    });
    const timeInp = h('input.input.imp-time', { type: 'time', value: IL.itemTime(it), 'aria-label': 'Hora de inicio' });
    timeInp.addEventListener('change', () => IL.setItemTime(it, timeInp.value));
    out.push(h('div.grid-2.imp-grid', field('Fecha', dateInp), field('Hora de inicio', timeInp)));
    out.push(h('div.field',
      h('span.field-label', KIND_UI[k].durLabel),
      durationInput({ seconds: it.movingSec, ariaLabel: KIND_UI[k].durLabel, onChange: (sec) => IL.setItemField(it, 'movingSec', sec) })));
    const moveKinds = k === 'run' || k === 'bike' || k === 'hike';
    if (moveKinds) {
      out.push(h('div.field',
        h('span.field-label', 'Tiempo total'),
        durationInput({ seconds: it.elapsedSec, ariaLabel: 'Tiempo total', onChange: (sec) => IL.setItemField(it, 'elapsedSec', sec) }),
        h('span.field-hint', 'Incluye paradas.')));
    }
    const num = (label, key, unit, { decimals = 0, inputmode = 'numeric', toView = (v) => v, fromView = (v) => v } = {}) => field(label, numInput({
      value: it[key] != null ? toView(it[key]) : null, decimals, inputmode, suffix: unit, ariaLabel: `${label} (${unit})`,
      onInput: (v) => IL.setItemField(it, key, v != null ? fromView(v) : null),
    }));
    if (k === 'swim') {
      out.push(num('Distancia', 'distanceKm', 'm', { toView: (v) => Math.round(v * 1000), fromView: (v) => (v > 0 ? v / 1000 : null) }));
    } else if (k !== 'other') {
      out.push(num('Distancia', 'distanceKm', 'km', { decimals: 2, inputmode: 'decimal' }));
    }
    if (moveKinds) {
      out.push(h('div.grid-2.imp-grid',
        num('Desnivel +', 'elevationM', 'm'),
        num('Desnivel −', 'elevationLossM', 'm'),
        num('Altitud máx.', 'altMaxM', 'm'),
        num('Cadencia', 'cadence', k === 'bike' ? 'rpm' : 'ppm'),
        num('FC media', 'hrAvg', 'lpm'),
        num('FC máxima', 'hrMax', 'lpm'),
        k === 'bike' || it.powerAvg ? num('Potencia media', 'powerAvg', 'W') : null,
        k === 'bike' && it.powerNp ? num('Potencia norm.', 'powerNp', 'W') : null));
    }
    out.push(h('div.field',
      h('span.field-label', 'Esfuerzo percibido (opcional)'),
      rpePicker({ value: it.rpe, onChange: (v) => { it.rpe = v; } })));
    const pts = it.gpsPoints ? ` · ${plural(it.gpsPoints, 'punto GPS', 'puntos GPS')} (no se guardan)` : '';
    out.push(h('p.imp-source', `${FORMAT_LABEL[it.format] || ''} · ${it.label}${pts}`));
    return out;
  }

  // ---------- guardar ----------
  async function saveAll() {
    const today = todayStr();
    const list = IL.selectedItems(state.items, today);
    if (!list.length) return;
    footer.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const now = Date.now();
    const ids = [];
    try {
      for (const it of list) {
        const rec = IL.itemRecord(it, { id: uid('a_'), now });
        await store.save('sessions', rec);
        ids.push(rec.id);
      }
    } catch (err) {
      toast(`No se pudo guardar todo: ${err?.message || err}`, { kind: 'error', duration: 6000 });
    }
    if (!alive) return;
    state.result = { ids, skipped: state.items.length - ids.length };
    state.items = [];
    state.errors = [];
    paint();
    window.scrollTo(0, 0);
    if (ids.length) {
      toast(ids.length === 1 ? 'Actividad importada.' : `${ids.length} actividades importadas.`, {
        kind: 'success', actionLabel: 'Ver historial', onAction: () => navigate('#/history'), duration: 6000,
      });
    }
  }

  async function undoImport() {
    const ids = state.result?.ids || [];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: '¿Deshacer la importación?',
      message: `Se quitarán del historial ${ids.length === 1 ? 'la actividad importada' : `las ${ids.length} actividades importadas`}.`,
      confirmText: 'Quitar',
      danger: true,
    });
    if (!ok || !alive) return;
    for (const id of ids) await store.remove('sessions', id);
    state.result = null;
    paint();
    toast('Importación deshecha.');
  }

  return () => { alive = false; };
}
