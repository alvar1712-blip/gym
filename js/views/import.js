// import.js — vista provisional (en construcción).
import { screen, emptyState } from '../ui.js';

export function mountImport(root) {
  const c = screen(root, { title: 'Importar actividades', back: '#/today' });
  c.appendChild(emptyState({ emoji: '🚧', title: 'Pantalla en construcción' }));
}
