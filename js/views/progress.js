// progress — vista provisional (se implementa en su fase).
import { screen, emptyState } from '../ui.js';

export function mountProgress(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountProgress' }));
}

export function mountExerciseProgress(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountExerciseProgress' }));
}

export function mountRecords(root) {
  const c = screen(root, { title: 'En construcción', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción', text: 'mountRecords' }));
}
