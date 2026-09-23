// activity — vista provisional (se implementa en su fase).
import { screen, emptyState } from '../ui.js';

export function mountActivity(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountActivity' }));
}
