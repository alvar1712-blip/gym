// bodyweight.js — peso corporal (vista provisional; la implementa el módulo de actividad).
import { screen, emptyState, h, stepper, toast } from '../ui.js';
import * as store from '../store.js';
import { todayStr } from '../util.js';

/**
 * CONTRATO (lo usa la pantalla Hoy): tarjeta de registro rápido de peso corporal.
 * @param {{onSaved?:(entry)=>void}} opts
 * @returns {HTMLElement}
 */
export function bodyweightQuickEntry({ onSaved } = {}) {
  const last = store.bodyweightList().at(-1);
  let val = last ? last.kg : store.settings().bodyweightDefault;
  const st = stepper({ value: val, step: 0.1, decimals: 1, suffix: 'kg', size: 'md', onChange: (v) => { val = v; } });
  return h('div.card',
    h('div.card-title', 'Peso corporal'),
    st,
    h('button.btn.btn-secondary.btn-block', {
      type: 'button',
      onClick: async () => {
        if (!(val > 0)) return;
        const entry = { id: todayStr(), kg: val };
        await store.save('bodyweight', entry);
        toast('Peso guardado');
        onSaved && onSaved(entry);
      },
    }, 'Guardar peso de hoy'));
}

export function mountBodyweight(root) {
  const c = screen(root, { title: 'Peso corporal', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción' }));
}
