// settings — vista provisional (se implementa en su fase).
import { screen, emptyState } from '../ui.js';

export function mountSettings(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountSettings' }));
}

export function mountWeekPattern(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountWeekPattern' }));
}

export function mountThresholds(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountThresholds' }));
}

export function mountData(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountData' }));
}
