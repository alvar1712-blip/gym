// predictions.js — vista provisional (en construcción).
import { screen, emptyState } from '../ui.js';

export function mountPredictions(root) {
  const c = screen(root, { title: 'Tiempos previstos', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción' }));
}
