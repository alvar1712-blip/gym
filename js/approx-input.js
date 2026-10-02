// approx-input.js — campo de fecha aproximada (ronda 6, docs/MEJORAS6.md): precisión día · mes · estación · año y sus
// campos. Lo usan «Tu contexto» (views/context.js) y las marcas históricas (views/past-records.js). Estilos en
// css/context.css (.ctx-approx…). La lógica de fechas aproximadas está en ./context-logic.js.
import { h, segmented } from './ui.js';
import { MONTH_LONG } from './util.js';
import * as C from './context-logic.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Fecha aproximada: precisión (día · mes · estación · año) y sus campos. onChange(Approx|null) en cada cambio.
 * Mes, estación y año usan desplegables (la rueda de iOS), igual en todos los navegadores.
 */
export function approxInput({ label, value, today, key, onChange }) {
  const parts = C.approxParts(value, today);
  const thisYear = Number(today.slice(0, 4));
  const fields = h('div.ctx-approx-fields');
  const emit = () => onChange(C.makeApprox(parts.precision, parts));
  const select = (name, options, cur, set) => {
    const el = h('select.input.ctx-select', { 'aria-label': `${label}: ${name}`, dataset: { part: name } },
      options.map((o) => h('option', { value: String(o.value), selected: o.value === cur }, o.label)));
    el.addEventListener('change', () => { set(el.value); emit(); });
    return el;
  };
  const years = () => {
    const from = Math.min(thisYear - 15, parts.year); const to = Math.max(thisYear + 2, parts.year);
    const out = [];
    for (let y = to; y >= from; y--) out.push({ value: y, label: String(y) });
    return out;
  };
  const yearSel = () => select('año', years(), parts.year, (v) => { parts.year = Number(v); });
  function paintFields() {
    if (parts.precision === 'day') {
      const inp = h('input.input.ctx-date', { type: 'date', value: parts.date, 'aria-label': `${label}: día` });
      inp.addEventListener('change', () => {
        parts.date = inp.value;
        if (inp.value) { parts.year = Number(inp.value.slice(0, 4)); parts.month = Number(inp.value.slice(5, 7)); }
        emit();
      });
      fields.replaceChildren(inp);
    } else if (parts.precision === 'month') {
      fields.replaceChildren(h('div.grid-2',
        select('mes', MONTH_LONG.map((m, i) => ({ value: i + 1, label: cap(m) })), parts.month, (v) => { parts.month = Number(v); }),
        yearSel()));
    } else if (parts.precision === 'season') {
      fields.replaceChildren(h('div.grid-2',
        select('estación', C.SEASONS.map((s) => ({ value: s.id, label: cap(s.label) })), parts.season, (v) => { parts.season = v; }),
        yearSel()));
    } else {
      fields.replaceChildren(yearSel());
    }
  }
  const seg = segmented({
    options: C.PRECISIONS.map((p) => ({ value: p.id, label: p.label })), value: parts.precision, size: 'sm', ariaLabel: `${label}: precisión`,
    onChange: (v) => {
      if (v === 'day' && parts.precision !== 'day') {
        const mm = String(parts.month).padStart(2, '0');
        parts.date = `${parts.year}-${mm}-01`;
      }
      parts.precision = v;
      paintFields();
      emit();
    },
  });
  paintFields();
  return h('div.field.ctx-approx', { dataset: { approx: key } }, h('span.field-label', label), seg, fields);
}
