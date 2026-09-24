// goals — vista provisional (se implementa en su fase).
import { screen, emptyState } from '../ui.js';

export function mountGoals(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountGoals' }));
}

export function mountGoalEdit(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountGoalEdit' }));
}

/**
 * CONTRATO (lo usan Hoy y Progreso): tarjeta breve con los objetivos activos y su progreso.
 * Devuelve null si no hay objetivos que mostrar. (Provisional: la implementa el módulo de objetivos.)
 * @returns {HTMLElement|null}
 */
export function goalsSummaryCard() {
  return null;
}
