// summary.js — vista provisional (en construcción).
import { screen, emptyState } from '../ui.js';

export function mountSummary(root) {
  const c = screen(root, { title: 'Resúmenes', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción' }));
}
